/**
 * ╔═══════════════════════════════════════════════════════╗
 * ║         AEGIS - Auth routes (avec audit + sessions)   ║
 * ║         src/server/routes/auth.ts                     ║
 * ╚═══════════════════════════════════════════════════════╝
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import bcrypt from "bcryptjs";
import crypto from "node:crypto";
import { z } from "zod";
import { MAX_VAULT_CIPHERTEXT_LENGTH, VAULT_BODY_LIMIT } from "../lib/limits.js";
import { prisma } from "../lib/prisma.js";
import {
    createSession,
    validateRefreshToken,
    rotateRefreshToken,
    revokeSession,
    revokeAllSessions,
    logAudit,
    getIp,
    getUserAgent,
    SESSION_TTL_MS,
} from "../lib/audit.js";
import { sendPasswordChangedEmail, sendNewIpLoginEmail } from "../lib/email.js";
import { clearAttempts, recordFailedAttempt, reserveAttempt, sendLocked } from "../lib/lockout.js";

interface JwtPayload { sub: string; email: string; }

interface CookieOptions {
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: "strict" | "lax" | "none";
    path?: string;
    maxAge?: number;
}

const BCRYPT_ROUNDS       = 12;
const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;
const SALT_BYTES = 32;

/**
 * Sel factice d'un email sans compte : HMAC de l'email par un secret serveur.
 * Stable pour une adresse donnée (deux requêtes renvoient le même sel, comme
 * pour un vrai compte) et différent d'une adresse à l'autre - un sel unique
 * partagé par tous les emails inconnus suffirait à les reconnaître.
 *
 * Secret lu à chaque appel : ce module est importé avant que app.ts n'appelle
 * dotenv.config().
 */
function fakeSaltFor(email: string): string {
    const secret = process.env.AEGIS_DUMMY_SALT || process.env.JWT_SECRET;
    if (!secret) throw new Error("AEGIS_DUMMY_SALT ou JWT_SECRET requis pour /auth/salt.");
    return crypto.createHmac("sha256", secret).update(email).digest().subarray(0, SALT_BYTES).toString("base64");
}

const EmailSchema = z.string().email().max(254);

/** Sel Argon2 de 32 octets en base64 (44 caractères, un "=" final). */
const SaltSchema = z.string().regex(/^[A-Za-z0-9+/]{43}=$/, "salt must be 32 bytes of base64");

const SaltQuerySchema = z.object({
    email: z.string().toLowerCase().trim().pipe(EmailSchema),
});

const RegisterSchema = z.object({
    email:      z.string().email().max(254).toLowerCase().trim(),
    authKeyHex: z.string().length(64).regex(/^[0-9a-f]+$/),
    saltBase64: SaltSchema,
});

const LoginSchema = z.object({
    email:      z.string().email().max(254).toLowerCase().trim(),
    authKeyHex: z.string().length(64).regex(/^[0-9a-f]+$/),
});

const ChangePasswordSchema = z.object({
    currentAuthKeyHex: z.string().length(64).regex(/^[0-9a-f]+$/),
    newAuthKeyHex:     z.string().length(64).regex(/^[0-9a-f]+$/),
    vault: z.object({
        ciphertext: z
            .string()
            .min(1)
            .max(MAX_VAULT_CIPHERTEXT_LENGTH)
            .regex(/^[A-Za-z0-9+/=]+$/, "ciphertext must be base64"),
        iv: z
            .string()
            .length(16)
            .regex(/^[A-Za-z0-9+/=]+$/, "iv must be base64"),
    }),
});

function cookieOpts(maxAge?: number): CookieOptions {
    return {
        httpOnly: true,
        secure:   process.env.NODE_ENV === "production",
        sameSite: "strict",
        path:     "/api/auth",
        // Aligné sur SESSION_TTL_MS (durée de vie réelle de la session côté
        // serveur) - un maxAge de cookie plus long que la session qu'il
        // référence n'apporte rien, le serveur rejette de toute façon le
        // refresh token une fois la session expirée en base.
        maxAge:   maxAge ?? SESSION_TTL_MS / 1000,
    };
}

function accessTokenExpiresAt(): number {
    return Date.now() + ACCESS_TOKEN_TTL_MS;
}

// ─────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────

export async function authRoutes(app: FastifyInstance) {

    // ── POST /api/auth/register ─────────────────────────────

    app.post("/register", async (req: FastifyRequest, reply: FastifyReply) => {
        const parsed = RegisterSchema.safeParse(req.body);
        if (!parsed.success) {
            return reply.status(400).send({ message: "Données invalides.", errors: parsed.error.flatten() });
        }

        const { email, authKeyHex, saltBase64 } = parsed.data;

        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing) {
            await bcrypt.hash(authKeyHex, BCRYPT_ROUNDS); // timing constant
            return reply.status(409).send({ message: "Impossible de créer ce compte." });
        }

        const authKeyHash = await bcrypt.hash(authKeyHex, BCRYPT_ROUNDS);
        const user = await prisma.user.create({
            data: { email, authKeyHash, saltBase64 },
        });

        const accessToken    = await reply.jwtSign({ sub: user.id, email }, { expiresIn: "15m" });
        const refreshToken   = await createSession(user.id, req);

        await logAudit(user.id, "REGISTER", req);

        return reply
            .setCookie("aegis_rt", refreshToken, cookieOpts())
            .status(201)
            .send({ accessToken, expiresAt: accessTokenExpiresAt() });
    });

    // ── GET /api/auth/salt ──────────────────────────────────

    app.get("/salt", async (req: FastifyRequest, reply: FastifyReply) => {
        const parsed = SaltQuerySchema.safeParse(req.query);
        if (!parsed.success) {
            return reply.status(400).send({ message: "Email invalide." });
        }
        const { email } = parsed.data;

        const user = await prisma.user.findUnique({
            where:  { email },
            select: { saltBase64: true },
        });

        const saltBase64 = user?.saltBase64 ?? fakeSaltFor(email);
        await new Promise((r) => setTimeout(r, 200 + Math.random() * 100));

        return reply.send({ saltBase64 });
    });

    // ── POST /api/auth/login ────────────────────────────────

    app.post("/login", async (req: FastifyRequest, reply: FastifyReply) => {
        const parsed = LoginSchema.safeParse(req.body);
        if (!parsed.success) {
            return reply.status(400).send({ message: "Données invalides." });
        }

        const { email, authKeyHex } = parsed.data;
        const user = await prisma.user.findUnique({ where: { email } });

        if (user) {
            const retryAfter = await reserveAttempt(user.id);
            if (retryAfter !== null) return sendLocked(reply, retryAfter);
        }

        const dummyHash = "$2b$12$invaliddummyhashfortimingattackmitigation000000000000";
        const isValid   = await bcrypt.compare(authKeyHex, user?.authKeyHash ?? dummyHash);

        if (!user || !isValid) {
            if (user) await recordFailedAttempt(user.id, user.email, req, "LOGIN_FAILED");
            return reply.status(401).send({ message: "Identifiants incorrects." });
        }

        await clearAttempts(user.id);

        // Détection "nouvelle IP" - avant d'enregistrer CE login, pour savoir
        // s'il y a déjà eu une connexion réussie depuis cette IP auparavant.
        // Aucune notification sur le tout premier login (juste après inscription).
        const ip               = getIp(req);
        const priorLoginCount  = await prisma.auditLog.count({
            where: { userId: user.id, action: "LOGIN_SUCCESS" },
        });
        let seenThisIpBefore = false;
        if (priorLoginCount > 0) {
            const match = await prisma.auditLog.findFirst({
                where:  { userId: user.id, action: "LOGIN_SUCCESS", ipAddress: ip },
                select: { id: true },
            });
            seenThisIpBefore = !!match;
        }

        // Si ce navigateur porte déjà un cookie de session valide pour ce même
        // compte (reconnexion après un simple rechargement de page, la clé de
        // déchiffrement en mémoire ayant disparu mais le cookie httpOnly ayant
        // survécu), on la révoque avant d'en recréer une - sinon chaque
        // reconnexion sur le même navigateur laisse une session fantôme dans
        // la liste "Sessions actives" jusqu'à son expiration naturelle.
        const existingRefreshToken = req.cookies["aegis_rt"];
        if (existingRefreshToken) {
            const existingSession = await validateRefreshToken(existingRefreshToken);
            if (existingSession && existingSession.userId === user.id) {
                await revokeSession(existingSession.sessionId);
            }
        }

        const accessToken  = await reply.jwtSign({ sub: user.id, email }, { expiresIn: "15m" });
        const refreshToken = await createSession(user.id, req);

        await logAudit(user.id, "LOGIN_SUCCESS", req);

        if (priorLoginCount > 0 && !seenThisIpBefore) {
            await sendNewIpLoginEmail(user.email, { ipAddress: ip, userAgent: getUserAgent(req) });
        }

        return reply
            .setCookie("aegis_rt", refreshToken, cookieOpts())
            .send({ accessToken, expiresAt: accessTokenExpiresAt() });
    });

    // ── POST /api/auth/change-password ──────────────────────
    // Change le mot de passe maître : vérifie l'ancien authKey, remplace
    // authKeyHash + vault (rechiffré côté client avec la nouvelle clé) en
    // une seule opération atomique, puis révoque toutes les sessions -
    // chaque appareil doit se reconnecter avec le nouveau mot de passe.

    app.post(
        "/change-password",
        { bodyLimit: VAULT_BODY_LIMIT, preHandler: [requireAuth] },
        async (req: FastifyRequest, reply: FastifyReply) => {
            const { sub: userId } = req.user as JwtPayload;

            const parsed = ChangePasswordSchema.safeParse(req.body);
            if (!parsed.success) {
                return reply.status(400).send({ message: "Données invalides." });
            }

            const { currentAuthKeyHex, newAuthKeyHex, vault } = parsed.data;

            const user = await prisma.user.findUnique({ where: { id: userId } });
            if (!user) {
                return reply.status(404).send({ message: "Utilisateur introuvable." });
            }

            const retryAfter = await reserveAttempt(userId);
            if (retryAfter !== null) return sendLocked(reply, retryAfter);

            const isValid = await bcrypt.compare(currentAuthKeyHex, user.authKeyHash);
            if (!isValid) {
                await recordFailedAttempt(userId, user.email, req, "PASSWORD_CHANGE_ATTEMPT", { success: false });
                return reply.status(401).send({ message: "Mot de passe actuel incorrect." });
            }

            const newAuthKeyHash = await bcrypt.hash(newAuthKeyHex, BCRYPT_ROUNDS);

            await prisma.user.update({
                where: { id: userId },
                data: {
                    authKeyHash:    newAuthKeyHash,
                    vaultData:      vault.ciphertext,
                    vaultIv:        vault.iv,
                    failedAttempts: 0,
                    lockedUntil:    null,
                },
            });

            await revokeAllSessions(userId);
            await logAudit(userId, "PASSWORD_CHANGE_ATTEMPT", req, { success: true });
            await sendPasswordChangedEmail(user.email, { ipAddress: getIp(req), userAgent: getUserAgent(req) });

            return reply
                .clearCookie("aegis_rt", cookieOpts(0))
                .send({ message: "Mot de passe maître changé. Reconnectez-vous." });
        }
    );

    // ── POST /api/auth/refresh ──────────────────────────────

    app.post("/refresh", async (req: FastifyRequest, reply: FastifyReply) => {
        const refreshToken = req.cookies["aegis_rt"];
        if (!refreshToken) {
            return reply.status(401).send({ message: "Session expirée." });
        }

        const result = await validateRefreshToken(refreshToken);
        if (!result) {
            reply.clearCookie("aegis_rt", cookieOpts(0));
            return reply.status(401).send({ message: "Session invalide. Reconnectez-vous." });
        }

        const newRefreshToken = await rotateRefreshToken(result.sessionId);
        const newAccessToken  = await reply.jwtSign(
            { sub: result.userId, email: result.email },
            { expiresIn: "15m" }
        );

        // `email` permet au client de vérifier que ce rafraîchissement
        // correspond bien au compte qu'il croit avoir en mémoire, avant de
        // remplacer l'accessToken - voir le commentaire dans
        // refreshAccessToken() côté frontend (auth-client.ts) pour le
        // scénario de mélange de comptes que ça empêche.
        return reply
            .setCookie("aegis_rt", newRefreshToken, cookieOpts())
            .send({ accessToken: newAccessToken, expiresAt: accessTokenExpiresAt(), email: result.email });
    });

    // ── POST /api/auth/logout ───────────────────────────────

    app.post("/logout", async (req: FastifyRequest, reply: FastifyReply) => {
        const refreshToken = req.cookies["aegis_rt"];

        if (refreshToken) {
            const result = await validateRefreshToken(refreshToken);
            if (result) {
                await revokeSession(result.sessionId);
                await logAudit(result.userId, "LOGOUT", req);
            }
        }

        return reply
            .clearCookie("aegis_rt", cookieOpts(0))
            .send({ message: "Déconnecté avec succès." });
    });
}

// ─────────────────────────────────────────────────────────
// MIDDLEWARE
// ─────────────────────────────────────────────────────────

export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
        await req.jwtVerify();
    } catch {
        reply.status(401).send({ message: "Non authentifié." });
    }
}
