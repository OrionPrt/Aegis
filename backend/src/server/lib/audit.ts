/**
 * ╔═══════════════════════════════════════════════════════╗
 * ║         AEGIS — Audit Log & Sessions                  ║
 * ║         src/server/lib/audit.ts                       ║
 * ╚═══════════════════════════════════════════════════════╝
 */

import { PrismaClient, AuditAction } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const BCRYPT_ROUNDS       = 12;
const SESSION_TTL_MS      = 7 * 24 * 60 * 60 * 1000; // 7 jours
const MAX_SESSIONS        = 5; // sessions simultanées max par utilisateur

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
 * Ne lève jamais d'exception — l'audit ne doit pas bloquer le flux.
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
        // Log silencieux — ne jamais faire échouer une requête à cause de l'audit
        console.error("[audit] Failed to write log:", err);
    }
}

// ─────────────────────────────────────────────────────────
// SESSIONS
// ─────────────────────────────────────────────────────────

/**
 * Crée une nouvelle session pour un utilisateur.
 * Supprime les sessions expirées et limite à MAX_SESSIONS actives.
 * Retourne le refresh token en clair (à envoyer dans le cookie httpOnly).
 */
export async function createSession(
    userId: string,
    req: FastifyRequest
): Promise<string> {
    const { token: refreshToken, lookupToken, secretToken } = generateRefreshToken();
    const refreshHash  = await bcrypt.hash(secretToken, BCRYPT_ROUNDS);
    const expiresAt    = new Date(Date.now() + SESSION_TTL_MS);

    // Nettoyage des sessions expirées
    await prisma.session.deleteMany({
        where: { userId, expiresAt: { lt: new Date() } },
    });

    // Limite du nombre de sessions actives — supprime les plus anciennes
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

    await prisma.session.create({
        data: {
            userId,
            lookupToken,
            refreshTokenHash: refreshHash,
            userAgent:        getUserAgent(req),
            ipAddress:        getIp(req),
            expiresAt,
        },
    });

    return refreshToken;
}

/**
 * Valide un refresh token et retourne la session correspondante.
 * Retourne null si le token est invalide ou expiré.
 *
 * Complexité : O(1) — lookup par index UNIQUE sur lookupToken,
 * puis un seul bcrypt.compare sur la session trouvée.
 * (Avant : O(n) — scan de toutes les sessions actives)
 */
export async function validateRefreshToken(
    rawToken: string
): Promise<{ sessionId: string; userId: string; email: string } | null> {
    // 1. Parser le token — format : "lookupToken.secretToken"
    const parsed = parseRefreshToken(rawToken);
    if (!parsed) return null;

    // 2. Lookup O(1) via l'index UNIQUE — une seule session candidate
    const session = await prisma.session.findUnique({
        where:   { lookupToken: parsed.lookupToken },
        include: { user: { select: { id: true, email: true } } },
    });

    // 3. Session introuvable ou expirée
    if (!session || session.expiresAt <= new Date()) return null;

    // 4. Vérification cryptographique du secretToken
    const match = await bcrypt.compare(parsed.secretToken, session.refreshTokenHash);
    if (!match) return null;

    // 5. Mise à jour de lastUsedAt
    await prisma.session.update({
        where: { id: session.id },
        data:  { lastUsedAt: new Date() },
    });

    return {
        sessionId: session.id,
        userId:    session.user.id,
        email:     session.user.email,
    };
}

/**
 * Rotation du refresh token — invalide l'ancien et crée un nouveau.
 * Appelé à chaque rafraîchissement de l'access token.
 */
export async function rotateRefreshToken(
    sessionId: string,
): Promise<string> {
    const { token: newToken, lookupToken: newLookupToken, secretToken: newSecretToken } = generateRefreshToken();
    const newHash  = await bcrypt.hash(newSecretToken, BCRYPT_ROUNDS);

    await prisma.session.update({
        where: { id: sessionId },
        data:  {
            lookupToken:      newLookupToken,
            refreshTokenHash: newHash,
            lastUsedAt:       new Date(),
            expiresAt:        new Date(Date.now() + SESSION_TTL_MS),
        },
    });

    return newToken;
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
 * (sans les refresh tokens — données de présentation uniquement).
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
