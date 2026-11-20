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
import { VAULT_CONFLICT_MESSAGE, VaultVersionSchema } from "../lib/vault-version.js";
import {
    createSession,
    validateRefreshToken,
    rotateRefreshToken,
    revokeSession,
    revokeAllSessions,
    findActiveSession,
    logAudit,
    getIp,
    getUserAgent,
    SESSION_TTL_MS,
} from "../lib/audit.js";
import { sendPasswordChangedEmail, sendNewIpLoginEmail, sendVerificationEmail } from "../lib/email.js";
import { hashVerificationToken, newVerificationToken, verificationLink } from "../lib/email-verification.js";
import { clearAttempts, recordFailedAttempt, reserveAttempt, sendLocked } from "../lib/lockout.js";
import { CURRENT_KDF_VERSION, KdfVersionSchema } from "../lib/kdf.js";

/** Contenu de l'access token : `sid` lie le jeton à sa session (voir requireAuth). */
export interface JwtPayload { sub: string; email: string; sid: string; }

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
    // Absente pour un client antérieur au versionnage : version actuelle.
    kdfVersion: KdfVersionSchema.default(CURRENT_KDF_VERSION),
});

const VerifyEmailSchema = z.object({
    token: z.string().min(20).max(100),
});

const ResendVerificationSchema = z.object({
    email: z.string().email().max(254).toLowerCase().trim(),
});

/** Réponse identique de l'inscription, que l'adresse soit libre ou non. */
const REGISTER_ACCEPTED_MESSAGE =
    "Si cette adresse peut être utilisée, un email de confirmation vient d'y être envoyé. Ouvrez le lien qu'il contient, puis connectez-vous.";

/** Délai aléatoire ajouté aux réponses qui ne doivent pas révéler si un compte existe. */
function uniformDelay(): Promise<void> {
    return new Promise((r) => setTimeout(r, 200 + Math.random() * 200));
}

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

    // Ne crée pas de session : le compte n'est utilisable qu'une fois
    // l'adresse confirmée. La réponse est la même que l'adresse soit libre,
    // déjà inscrite ou en attente de confirmation - elle ne révèle rien.
    app.post("/register", async (req: FastifyRequest, reply: FastifyReply) => {
        const parsed = RegisterSchema.safeParse(req.body);
        if (!parsed.success) {
            return reply.status(400).send({ message: "Données invalides.", errors: parsed.error.flatten() });
        }

        const { email, authKeyHex, saltBase64, kdfVersion } = parsed.data;
        const authKeyHash = await bcrypt.hash(authKeyHex, BCRYPT_ROUNDS);

        const existing = await prisma.user.findUnique({
            where:  { email },
            select: { id: true, emailVerifiedAt: true, emailVerificationExpiresAt: true },
        });
        const pendingStillValid = existing && !existing.emailVerifiedAt
            && existing.emailVerificationExpiresAt !== null && existing.emailVerificationExpiresAt > new Date();

        if (existing && (existing.emailVerifiedAt || pendingStillValid)) {
            // Compte actif, ou inscription en attente encore valable (la
            // remplacer laisserait un tiers évincer une inscription légitime) :
            // rien à faire. Le titulaire peut redemander le lien depuis
            // l'écran de connexion.
            await uniformDelay();
            return reply.status(202).send({ message: REGISTER_ACCEPTED_MESSAGE });
        }

        // Inscription jamais confirmée et expirée : elle ne contient rien, on
        // la remplace par celle-ci.
        if (existing) await prisma.user.delete({ where: { id: existing.id } });

        const { token, tokenHash, expiresAt } = newVerificationToken();
        const user = await prisma.user.create({
            data: {
                email, authKeyHash, saltBase64, kdfVersion,
                emailVerifiedAt:            null,
                emailVerificationTokenHash: tokenHash,
                emailVerificationExpiresAt: expiresAt,
            },
        });
        await logAudit(user.id, "REGISTER", req);
        await sendVerificationEmail(email, verificationLink(token));

        await uniformDelay();
        return reply.status(202).send({ message: REGISTER_ACCEPTED_MESSAGE });
    });

    // ── POST /api/auth/verify-email ─────────────────────────

    app.post("/verify-email", async (req: FastifyRequest, reply: FastifyReply) => {
        const parsed = VerifyEmailSchema.safeParse(req.body);
        if (!parsed.success) {
            return reply.status(400).send({ message: "Lien de confirmation invalide ou expiré." });
        }

        const user = await prisma.user.findUnique({
            where:  { emailVerificationTokenHash: hashVerificationToken(parsed.data.token) },
            select: { id: true, emailVerificationExpiresAt: true },
        });
        if (!user || !user.emailVerificationExpiresAt || user.emailVerificationExpiresAt <= new Date()) {
            return reply.status(400).send({ message: "Lien de confirmation invalide ou expiré." });
        }

        await prisma.user.update({
            where: { id: user.id },
            data:  { emailVerifiedAt: new Date(), emailVerificationTokenHash: null, emailVerificationExpiresAt: null },
        });
        await logAudit(user.id, "EMAIL_VERIFIED", req);

        return reply.send({ message: "Adresse confirmée. Vous pouvez vous connecter." });
    });

    // ── POST /api/auth/resend-verification ──────────────────

    // Même réponse dans tous les cas ; un nouveau lien n'est envoyé qu'à une
    // inscription en attente (l'ancien lien cesse de fonctionner).
    app.post("/resend-verification", async (req: FastifyRequest, reply: FastifyReply) => {
        const parsed = ResendVerificationSchema.safeParse(req.body);
        if (!parsed.success) {
            return reply.status(400).send({ message: "Email invalide." });
        }
        const { email } = parsed.data;

        const pending = await prisma.user.findFirst({
            where:  { email, emailVerifiedAt: null },
            select: { id: true },
        });
        if (pending) {
            const { token, tokenHash, expiresAt } = newVerificationToken();
            await prisma.user.update({
                where: { id: pending.id },
                data:  { emailVerificationTokenHash: tokenHash, emailVerificationExpiresAt: expiresAt },
            });
            await sendVerificationEmail(email, verificationLink(token));
        }

        await uniformDelay();
        return reply.status(202).send({ message: "Si une inscription attend d'être confirmée pour cette adresse, un nouveau lien vient d'y être envoyé." });
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
            select: { saltBase64: true, kdfVersion: true },
        });

        const saltBase64 = user?.saltBase64 ?? fakeSaltFor(email);
        await new Promise((r) => setTimeout(r, 200 + Math.random() * 100));

        // Un email inconnu reçoit la version actuelle, comme un compte neuf.
        return reply.send({ saltBase64, kdfVersion: user?.kdfVersion ?? CURRENT_KDF_VERSION });
    });

    // ── POST /api/auth/login ────────────────────────────────

    app.post("/login", async (req: FastifyRequest, reply: FastifyReply) => {
        const parsed = LoginSchema.safeParse(req.body);
        if (!parsed.success) {
            return reply.status(400).send({ message: "Données invalides." });
        }

        const { email, authKeyHex } = parsed.data;
        const user = await prisma.user.findUnique({ where: { email } });

        // Même compteur pour une adresse inscrite ou non : le 429 ne révèle pas
        // qu'un compte existe.
        const retryAfter = await reserveAttempt(email);
        if (retryAfter !== null) return sendLocked(reply, retryAfter);

        const dummyHash = "$2b$12$invaliddummyhashfortimingattackmitigation000000000000";
        const isValid   = await bcrypt.compare(authKeyHex, user?.authKeyHash ?? dummyHash);

        if (!user || !isValid) {
            await recordFailedAttempt(email, req, user ? { userId: user.id, action: "LOGIN_FAILED" } : null);
            return reply.status(401).send({ message: "Identifiants incorrects." });
        }

        await clearAttempts(email);

        // Seul qui connaît le mot de passe maître apprend que l'adresse attend
        // sa confirmation : ça ne révèle rien à un tiers.
        if (!user.emailVerifiedAt) {
            return reply.status(403).send({
                message: "Confirmez d'abord votre adresse email : ouvrez le lien reçu à l'inscription.",
                code:    "EMAIL_NOT_VERIFIED",
            });
        }

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

        const { refreshToken, sessionId } = await createSession(user.id, req);
        const accessToken = await signAccessToken(reply, { sub: user.id, email, sid: sessionId });

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

            const { currentAuthKeyHex, newAuthKeyHex, vault, baseVersion } = parsed.data;

            const user = await prisma.user.findUnique({ where: { id: userId } });
            if (!user) {
                return reply.status(404).send({ message: "Utilisateur introuvable." });
            }

            const retryAfter = await reserveAttempt(user.email);
            if (retryAfter !== null) return sendLocked(reply, retryAfter);

            const isValid = await bcrypt.compare(currentAuthKeyHex, user.authKeyHash);
            if (!isValid) {
                await recordFailedAttempt(user.email, req, {
                    userId, action: "PASSWORD_CHANGE_ATTEMPT", metadata: { success: false },
                });
                return reply.status(401).send({ message: "Mot de passe actuel incorrect." });
            }
            await clearAttempts(user.email);

            const newAuthKeyHash = await bcrypt.hash(newAuthKeyHex, BCRYPT_ROUNDS);

            const { count } = await prisma.user.updateMany({
                where: { id: userId, vaultVersion: baseVersion },
                data: {
                    authKeyHash:    newAuthKeyHash,
                    vaultData:      vault.ciphertext,
                    vaultIv:        vault.iv,
                    vaultVersion:   { increment: 1 },
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

        // null : un autre rafraîchissement avec le même cookie vient de
        // tourner la session. Pas de clearCookie ici - sa réponse pose déjà
        // le nouveau cookie, l'effacer déconnecterait le navigateur.
        const newRefreshToken = await rotateRefreshToken(result);
        if (!newRefreshToken) {
            return reply.status(401).send({ message: "Session invalide. Reconnectez-vous." });
        }
        const newAccessToken = await signAccessToken(reply, { sub: result.userId, email: result.email, sid: result.sessionId });

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

function signAccessToken(reply: FastifyReply, payload: JwtPayload): Promise<string> {
    return reply.jwtSign(payload, { expiresIn: "15m" });
}

/**
 * Exige un access token valide ET dont la session existe encore : une
 * déconnexion, une révocation depuis la page Sessions ou un changement de
 * mot de passe invalident aussitôt les jetons déjà émis, sans attendre
 * leurs 15 minutes d'expiration.
 */
export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
        await req.jwtVerify();
    } catch {
        reply.status(401).send({ message: "Non authentifié." });
        return;
    }

    const { sub, sid } = req.user as Partial<JwtPayload>;
    if (!sub || !sid || !(await findActiveSession(sid, sub))) {
        reply.status(401).send({ message: "Session expirée." });
    }
}
