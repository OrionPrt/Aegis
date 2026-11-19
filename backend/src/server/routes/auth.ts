/**
 * ╔═══════════════════════════════════════════════════════╗
 * ║         AEGIS - Auth routes (avec audit + sessions)   ║
 * ║         src/server/routes/auth.ts                     ║
 * ╚═══════════════════════════════════════════════════════╝
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import bcrypt from "bcryptjs";
import { z } from "zod";
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
import { sendPasswordChangedEmail, sendNewIpLoginEmail, sendAccountLockedEmail } from "../lib/email.js";
import { VAULT_CONFLICT_MESSAGE, VaultVersionSchema } from "../lib/vault-version.js";

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
export const MAX_FAILED_ATTEMPTS = 3;
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

// Fallback base64 valide (32 octets) au cas où AEGIS_DUMMY_SALT ne serait pas
// configuré - un fallback invalide casserait la dérivation de clé côté
// client pour tout email inexistant, ce qui recrée exactement la fuite
// d'énumération que ce faux sel est censé éviter (voir /salt ci-dessous).
const FALLBACK_DUMMY_SALT = "Y7QRuESvdl/D1TFc/Cx1o91ji92diiRb+8PDhXcvozE=";

// Lue à CHAQUE requête plutôt que mise en cache dans une const au chargement
// du module : ce fichier est importé (via build-app.ts) avant que app.ts
// n'appelle dotenv.config(), donc une const évaluée au chargement du module
// capturerait toujours `undefined` et retomberait silencieusement sur le
// fallback, y compris quand AEGIS_DUMMY_SALT est bien défini dans .env.
function getDummySalt(): string {
    return process.env.AEGIS_DUMMY_SALT ?? FALLBACK_DUMMY_SALT;
}

const RegisterSchema = z.object({
    email:      z.string().email().max(254).toLowerCase().trim(),
    authKeyHex: z.string().length(64).regex(/^[0-9a-f]+$/),
    saltBase64: z.string().min(32).max(64),
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
            .max(10 * 1024 * 1024)
            .regex(/^[A-Za-z0-9+/=]+$/, "ciphertext must be base64"),
        iv: z
            .string()
            .length(16)
            .regex(/^[A-Za-z0-9+/=]+$/, "iv must be base64"),
    }),
    // Version du coffre rechiffré : refusée (409) si un autre appareil a
    // sauvegardé depuis, pour ne pas écraser ses changements.
    baseVersion: VaultVersionSchema,
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
        const email = (req.query as Record<string, string>).email?.toLowerCase().trim();

        if (!email || !z.string().email().safeParse(email).success) {
            return reply.status(400).send({ message: "Email invalide." });
        }

        const user = await prisma.user.findUnique({
            where:  { email },
            select: { saltBase64: true },
        });

        const saltBase64 = user?.saltBase64 ?? getDummySalt();
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

        if (user?.lockedUntil && user.lockedUntil > new Date()) {
            const retryAfter = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000);
            return reply
                .status(429)
                .header("Retry-After", String(retryAfter))
                .send({ message: `Compte bloqué. Réessayez dans ${retryAfter}s.` });
        }

        const dummyHash = "$2b$12$invaliddummyhashfortimingattackmitigation000000000000";
        const isValid   = await bcrypt.compare(authKeyHex, user?.authKeyHash ?? dummyHash);

        if (!user || !isValid) {
            if (user) {
                const failedAttempts = user.failedAttempts + 1;
                const justLocked     = failedAttempts >= MAX_FAILED_ATTEMPTS;
                await prisma.user.update({
                    where: { id: user.id },
                    data: {
                        failedAttempts,
                        ...(justLocked && {
                            lockedUntil: new Date(Date.now() + LOCKOUT_DURATION_MS),
                        }),
                    },
                });
                await logAudit(user.id, "LOGIN_FAILED", req, { failedAttempts });
                if (justLocked) {
                    await sendAccountLockedEmail(user.email, { ipAddress: getIp(req), userAgent: getUserAgent(req) });
                }
            }
            return reply.status(401).send({ message: "Identifiants incorrects." });
        }

        // Réinitialisation du compteur d'échecs
        await prisma.user.update({
            where: { id: user.id },
            data:  { failedAttempts: 0, lockedUntil: null },
        });

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
        { preHandler: [requireAuth] },
        async (req: FastifyRequest, reply: FastifyReply) => {
            const { sub: userId } = req.user as JwtPayload;

            const parsed = ChangePasswordSchema.safeParse(req.body);
            if (!parsed.success) {
                return reply.status(400).send({ message: "Données invalides." });
            }

            const { currentAuthKeyHex, newAuthKeyHex, vault, baseVersion } = parsed.data;

            const user = await prisma.user.findUnique({ where: { id: userId } });
            if (!user) {
                return reply.status(404).send({ message: "Utilisateur introuvable." });
            }

            if (user.lockedUntil && user.lockedUntil > new Date()) {
                const retryAfter = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000);
                return reply
                    .status(429)
                    .header("Retry-After", String(retryAfter))
                    .send({ message: `Compte bloqué. Réessayez dans ${retryAfter}s.` });
            }

            const isValid = await bcrypt.compare(currentAuthKeyHex, user.authKeyHash);
            if (!isValid) {
                const failedAttempts = user.failedAttempts + 1;
                const justLocked     = failedAttempts >= MAX_FAILED_ATTEMPTS;
                await prisma.user.update({
                    where: { id: userId },
                    data: {
                        failedAttempts,
                        ...(justLocked && {
                            lockedUntil: new Date(Date.now() + LOCKOUT_DURATION_MS),
                        }),
                    },
                });
                await logAudit(userId, "PASSWORD_CHANGE_ATTEMPT", req, { success: false });
                if (justLocked) {
                    await sendAccountLockedEmail(user.email, { ipAddress: getIp(req), userAgent: getUserAgent(req) });
                }
                return reply.status(401).send({ message: "Mot de passe actuel incorrect." });
            }

            const newAuthKeyHash = await bcrypt.hash(newAuthKeyHex, BCRYPT_ROUNDS);

            const { count } = await prisma.user.updateMany({
                where: { id: userId, vaultVersion: baseVersion },
                data: {
                    authKeyHash:    newAuthKeyHash,
                    vaultData:      vault.ciphertext,
                    vaultIv:        vault.iv,
                    vaultVersion:   { increment: 1 },
                    failedAttempts: 0,
                    lockedUntil:    null,
                },
            });
            if (count === 0) {
                return reply.status(409).send({ message: VAULT_CONFLICT_MESSAGE });
            }

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
