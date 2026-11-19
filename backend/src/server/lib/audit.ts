/**
 * ╔═══════════════════════════════════════════════════════╗
 * ║         AEGIS - Audit Log & Sessions                  ║
 * ║         src/server/lib/audit.ts                       ║
 * ╚═══════════════════════════════════════════════════════╝
 */

import type { AuditAction, Prisma } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma.js";

const BCRYPT_ROUNDS = 12;
const MAX_SESSIONS  = 5; // sessions simultanées max par utilisateur

// 1 jour - fenêtre courte : la clé de déchiffrement du vault ne survit de
// toute façon jamais à la fermeture de l'onglet (voir CookiesPage.tsx), donc
// ce cookie ne sert qu'au renouvellement en continu pendant une session
// active + à borner l'exposition en cas de vol du cookie. Réutilisé par
// routes/auth.ts pour aligner le maxAge du cookie sur cette même durée.
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

// Durée de vie maximale d'une session, rotations comprises : sans plafond,
// une session utilisée au moins une fois par jour ne s'éteindrait jamais.
export const SESSION_ABSOLUTE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// Délai pendant lequel l'ancien refresh token peut encore arriver sans être
// pris pour un vol : deux requêtes parties en même temps avec le même cookie.
export const REFRESH_REUSE_GRACE_MS = 30 * 1000;

/** Session valide retournée par validateRefreshToken / findActiveSession. */
export interface ActiveSession {
    sessionId:   string;
    userId:      string;
    email:       string;
    lookupToken: string;
    createdAt:   Date;
}

/** Une session n'est plus utilisable après son expiration glissante ou absolue. */
function isExpired(session: { expiresAt: Date; createdAt: Date }, now = Date.now()): boolean {
    return session.expiresAt.getTime() <= now || session.createdAt.getTime() + SESSION_ABSOLUTE_TTL_MS <= now;
}

// ─────────────────────────────────────────────────────────
// UTILITAIRES
// ─────────────────────────────────────────────────────────

/** Extrait l'IP réelle derrière un reverse proxy */
export function getIp(req: FastifyRequest): string {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string") return forwarded.split(",")[0].trim();
    return req.ip ?? "unknown";
}

/** Extrait un user-agent lisible */
export function getUserAgent(req: FastifyRequest): string {
    return req.headers["user-agent"]?.slice(0, 200) ?? "unknown";
}

/**
 * Génère un refresh token structuré : "lookupToken.secretToken"
 *
 * - lookupToken (16 bytes hex, 32 chars) : stocké en clair en BDD
 *   → permet un lookup O(1) via index UNIQUE, sans scan de table
 * - secretToken (48 bytes, base64url)    : bcrypt(secretToken) stocké en BDD
 *   → vérification cryptographique après le lookup
 *
 * Le format final envoyé au client est : "<lookupToken>.<secretToken>"
 */
export function generateRefreshToken(): { token: string; lookupToken: string; secretToken: string } {
    const lookupToken = crypto.randomBytes(16).toString("hex");       // 32 chars
    const secretToken = crypto.randomBytes(48).toString("base64url"); // ~64 chars
    return { token: `${lookupToken}.${secretToken}`, lookupToken, secretToken };
}

/**
 * Décompose un refresh token reçu du client en ses deux parties.
 * Retourne null si le format est invalide.
 */
function parseRefreshToken(token: string): { lookupToken: string; secretToken: string } | null {
    const dotIndex = token.indexOf(".");
    if (dotIndex !== 32) return null; // lookupToken fait toujours 32 chars hex

    const lookupToken = token.slice(0, dotIndex);
    const secretToken = token.slice(dotIndex + 1);

    if (!/^[0-9a-f]{32}$/.test(lookupToken) || secretToken.length < 10) return null;

    return { lookupToken, secretToken };
}

// ─────────────────────────────────────────────────────────
// AUDIT LOG
// ─────────────────────────────────────────────────────────

/**
 * Enregistre une action dans l'audit log.
 * Ne lève jamais d'exception - l'audit ne doit pas bloquer le flux.
 */
export async function logAudit(
    userId: string,
    action: AuditAction,
    req: FastifyRequest,
    metadata?: Record<string, unknown>
): Promise<void> {
    try {
        await prisma.auditLog.create({
            data: {
                userId,
                action,
                ipAddress: getIp(req),
                userAgent: getUserAgent(req),
                metadata:  (metadata ?? {}) as Prisma.InputJsonValue,
            },
        });
    } catch (err) {
        // Log silencieux - ne jamais faire échouer une requête à cause de l'audit
        console.error("[audit] Failed to write log:", err);
    }
}

// ─────────────────────────────────────────────────────────
// SESSIONS
// ─────────────────────────────────────────────────────────

/**
 * Crée une nouvelle session pour un utilisateur.
 * Supprime les sessions expirées et limite à MAX_SESSIONS actives.
 * Retourne le refresh token en clair (à envoyer dans le cookie httpOnly) et
 * l'id de la session, porté par l'access token (claim `sid`).
 */
export async function createSession(
    userId: string,
    req: FastifyRequest
): Promise<{ refreshToken: string; sessionId: string }> {
    const { token: refreshToken, lookupToken, secretToken } = generateRefreshToken();
    const refreshHash  = await bcrypt.hash(secretToken, BCRYPT_ROUNDS);
    const expiresAt    = new Date(Date.now() + SESSION_TTL_MS);

    // Nettoyage des sessions expirées
    await prisma.session.deleteMany({
        where: { userId, expiresAt: { lt: new Date() } },
    });

    // Limite du nombre de sessions actives - supprime les plus anciennes
    const sessions = await prisma.session.findMany({
        where:   { userId },
        orderBy: { createdAt: "asc" },
        select:  { id: true },
    });

    if (sessions.length >= MAX_SESSIONS) {
        const toDelete = sessions.slice(0, sessions.length - MAX_SESSIONS + 1);
        await prisma.session.deleteMany({
            where: { id: { in: toDelete.map((s) => s.id) } },
        });
    }

    const session = await prisma.session.create({
        data: {
            userId,
            lookupToken,
            refreshTokenHash: refreshHash,
            userAgent:        getUserAgent(req),
            ipAddress:        getIp(req),
            expiresAt,
        },
        select: { id: true },
    });

    return { refreshToken, sessionId: session.id };
}

/**
 * Valide un refresh token et retourne la session correspondante.
 * Retourne null si le token est invalide ou expiré.
 *
 * Complexité : O(1) - lookup par index UNIQUE sur lookupToken,
 * puis un seul bcrypt.compare sur la session trouvée.
 *
 * Un token qui correspond à l'AVANT-dernière rotation d'une session est un
 * token déjà échangé : passé REFRESH_REUSE_GRACE_MS, c'est un vol rejoué et
 * la session est révoquée (le voleur comme la victime doivent se reconnecter).
 */
export async function validateRefreshToken(rawToken: string): Promise<ActiveSession | null> {
    const parsed = parseRefreshToken(rawToken);
    if (!parsed) return null;

    const session = await prisma.session.findUnique({
        where:   { lookupToken: parsed.lookupToken },
        include: { user: { select: { id: true, email: true } } },
    });

    if (!session) {
        await revokeOnReplay(parsed.lookupToken);
        return null;
    }
    if (isExpired(session)) return null;

    // Vérification cryptographique du secret
    const match = await bcrypt.compare(parsed.secretToken, session.refreshTokenHash);
    if (!match) return null;

    await prisma.session.update({
        where: { id: session.id },
        data:  { lastUsedAt: new Date() },
    });

    return {
        sessionId:   session.id,
        userId:      session.user.id,
        email:       session.user.email,
        lookupToken: session.lookupToken,
        createdAt:   session.createdAt,
    };
}

/** Révoque la session dont `lookupToken` était le token précédent, hors délai de grâce. */
async function revokeOnReplay(lookupToken: string): Promise<void> {
    const replayed = await prisma.session.findUnique({
        where:  { previousLookupToken: lookupToken },
        select: { id: true, rotatedAt: true },
    });
    if (!replayed?.rotatedAt) return;
    if (Date.now() - replayed.rotatedAt.getTime() < REFRESH_REUSE_GRACE_MS) return;
    await revokeSession(replayed.id);
}

/**
 * Indique si la session existe encore, appartient à cet utilisateur et n'a
 * pas expiré. Utilisée par requireAuth : un access token ne vaut que tant
 * que sa session existe.
 */
export async function findActiveSession(sessionId: string, userId: string): Promise<boolean> {
    const session = await prisma.session.findUnique({
        where:  { id: sessionId },
        select: { userId: true, expiresAt: true, createdAt: true },
    });
    return !!session && session.userId === userId && !isExpired(session);
}

/**
 * Rotation du refresh token - invalide l'ancien et crée un nouveau.
 * Appelé à chaque rafraîchissement de l'access token.
 *
 * Conditionnée au token présenté : de deux rafraîchissements simultanés avec
 * le même cookie, un seul tourne la session, l'autre reçoit null.
 */
export async function rotateRefreshToken(session: ActiveSession): Promise<string | null> {
    const { token: newToken, lookupToken: newLookupToken, secretToken: newSecretToken } = generateRefreshToken();
    const newHash = await bcrypt.hash(newSecretToken, BCRYPT_ROUNDS);
    const now     = Date.now();
    const absoluteEnd = session.createdAt.getTime() + SESSION_ABSOLUTE_TTL_MS;

    const { count } = await prisma.session.updateMany({
        where: { id: session.sessionId, lookupToken: session.lookupToken },
        data:  {
            lookupToken:         newLookupToken,
            refreshTokenHash:    newHash,
            previousLookupToken: session.lookupToken,
            rotatedAt:           new Date(now),
            lastUsedAt:          new Date(now),
            expiresAt:           new Date(Math.min(now + SESSION_TTL_MS, absoluteEnd)),
        },
    });

    return count === 1 ? newToken : null;
}

/**
 * Révoque une session spécifique (déconnexion d'un appareil).
 */
export async function revokeSession(sessionId: string): Promise<void> {
    await prisma.session.delete({ where: { id: sessionId } }).catch(() => {});
}

/**
 * Révoque toutes les sessions d'un utilisateur (déconnexion globale).
 */
export async function revokeAllSessions(userId: string): Promise<void> {
    await prisma.session.deleteMany({ where: { userId } });
}

/**
 * Retourne toutes les sessions actives d'un utilisateur
 * (sans les refresh tokens - données de présentation uniquement).
 */
export async function getUserSessions(userId: string) {
    return prisma.session.findMany({
        where:   { userId, expiresAt: { gt: new Date() } },
        orderBy: { lastUsedAt: "desc" },
        select: {
            id:          true,
            userAgent:   true,
            ipAddress:   true,
            lastUsedAt:  true,
            createdAt:   true,
            expiresAt:   true,
        },
    });
}
