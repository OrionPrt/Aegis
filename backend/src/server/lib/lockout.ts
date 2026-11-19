/**
 * ╔═══════════════════════════════════════════════════════╗
 * ║         AEGIS - Verrouillage anti-brute-force         ║
 * ║         src/server/lib/lockout.ts                     ║
 * ╚═══════════════════════════════════════════════════════╝
 *
 * Toute preuve du mot de passe maître (login, changement de mot de passe,
 * suppression de compte) consomme une tentative AVANT la vérification :
 * le compteur est incrémenté de façon atomique en base, et seules
 * MAX_FAILED_ATTEMPTS tentatives peuvent être en cours ou échouées à la
 * fois. Des requêtes envoyées en parallèle ne peuvent donc pas tester
 * plus de mots de passe que le seuil.
 *
 * Une preuve correcte remet le compteur à zéro ; un blocage expiré aussi.
 */
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AuditAction } from "@prisma/client";
import { prisma } from "./prisma.js";
import { getIp, getUserAgent, logAudit } from "./audit.js";
import { sendAccountLockedEmail } from "./email.js";

export const MAX_FAILED_ATTEMPTS = 3;
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

/**
 * Réserve une tentative de preuve pour ce compte.
 * Retourne null si elle est autorisée, sinon le délai (en secondes) avant
 * la fin du blocage.
 */
export async function reserveAttempt(userId: string): Promise<number | null> {
    const now = new Date();

    // Un blocage expiré repart de zéro : sans ça, une seule erreur après le
    // déblocage reverrouillerait aussitôt le compte.
    await prisma.user.updateMany({
        where: { id: userId, lockedUntil: { lte: now } },
        data:  { failedAttempts: 0, lockedUntil: null },
    });

    const { count } = await prisma.user.updateMany({
        where: { id: userId, lockedUntil: null, failedAttempts: { lt: MAX_FAILED_ATTEMPTS } },
        data:  { failedAttempts: { increment: 1 } },
    });
    if (count === 1) return null;

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { lockedUntil: true } });
    const lockedUntil = user?.lockedUntil?.getTime() ?? now.getTime() + LOCKOUT_DURATION_MS;
    return Math.max(1, Math.ceil((lockedUntil - now.getTime()) / 1000));
}

/** Preuve correcte : le compteur repart de zéro. */
export async function clearAttempts(userId: string): Promise<void> {
    await prisma.user.update({
        where: { id: userId },
        data:  { failedAttempts: 0, lockedUntil: null },
    });
}

/**
 * Preuve incorrecte : la tentative réservée reste comptée. Si le seuil est
 * atteint, pose le blocage (une seule requête y parvient, qui envoie l'email).
 * Trace l'échec dans le journal d'audit sous `action` (avec `metadata`).
 */
export async function recordFailedAttempt(
    userId: string,
    email: string,
    req: FastifyRequest,
    action: AuditAction,
    metadata: Record<string, unknown> = {},
): Promise<void> {
    const { count: justLocked } = await prisma.user.updateMany({
        where: { id: userId, lockedUntil: null, failedAttempts: { gte: MAX_FAILED_ATTEMPTS } },
        data:  { lockedUntil: new Date(Date.now() + LOCKOUT_DURATION_MS) },
    });

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { failedAttempts: true } });
    await logAudit(userId, action, req, { ...metadata, failedAttempts: user?.failedAttempts ?? MAX_FAILED_ATTEMPTS });

    if (justLocked === 1) {
        await sendAccountLockedEmail(email, { ipAddress: getIp(req), userAgent: getUserAgent(req) });
    }
}

/** Réponse 429 d'un compte bloqué. */
export function sendLocked(reply: FastifyReply, retryAfterSeconds: number): FastifyReply {
    return reply
        .status(429)
        .header("Retry-After", String(retryAfterSeconds))
        .send({ message: `Compte bloqué. Réessayez dans ${retryAfterSeconds}s.` });
}
