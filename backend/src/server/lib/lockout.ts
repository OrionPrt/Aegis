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
 * Le compteur est indexé par une empreinte de l'adresse email (table
 * AuthThrottle), qu'elle ait un compte ou non : une adresse inconnue se
 * verrouille exactement comme une adresse inscrite, et le 429 ne révèle
 * plus qu'un compte existe.
 *
 * Une preuve correcte remet le compteur à zéro ; un blocage expiré aussi.
 */
import type { FastifyReply, FastifyRequest } from "fastify";
import type { AuditAction } from "@prisma/client";
import { prisma } from "./prisma.js";
import { getIp, getUserAgent, logAudit } from "./audit.js";
import { sendAccountLockedEmail } from "./email.js";
import { emailHmac } from "./email-hmac.js";

export const MAX_FAILED_ATTEMPTS = 3;
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000;

/** Clé AuthThrottle d'une adresse (email normalisé). */
export function throttleKey(email: string): string {
    return emailHmac("throttle", email).toString("hex");
}

/**
 * Réserve une tentative de preuve pour cette adresse.
 * Retourne null si elle est autorisée, sinon le délai (en secondes) avant
 * la fin du blocage.
 */
export async function reserveAttempt(email: string): Promise<number | null> {
    const key = throttleKey(email);
    const now = new Date();

    // Un blocage expiré repart de zéro : sans ça, une seule erreur après le
    // déblocage reverrouillerait aussitôt l'adresse.
    await prisma.authThrottle.updateMany({
        where: { key, lockedUntil: { lte: now } },
        data:  { failedAttempts: 0, lockedUntil: null },
    });
    // Insertion sans erreur si la ligne existe déjà (requêtes simultanées).
    await prisma.authThrottle.createMany({ data: [{ key }], skipDuplicates: true });

    const { count } = await prisma.authThrottle.updateMany({
        where: { key, lockedUntil: null, failedAttempts: { lt: MAX_FAILED_ATTEMPTS } },
        data:  { failedAttempts: { increment: 1 } },
    });
    if (count === 1) return null;

    const row = await prisma.authThrottle.findUnique({ where: { key }, select: { lockedUntil: true } });
    const lockedUntil = row?.lockedUntil?.getTime() ?? now.getTime() + LOCKOUT_DURATION_MS;
    return Math.max(1, Math.ceil((lockedUntil - now.getTime()) / 1000));
}

/** Preuve correcte : le compteur de l'adresse repart de zéro. */
export async function clearAttempts(email: string): Promise<void> {
    await prisma.authThrottle.deleteMany({ where: { key: throttleKey(email) } });
}

/** Trace d'un échec sur un compte existant (journal d'audit + email de blocage). */
export interface FailedAttemptAudit {
    userId: string;
    action: AuditAction;
    metadata?: Record<string, unknown>;
}

/**
 * Preuve incorrecte : la tentative réservée reste comptée. Si le seuil est
 * atteint, pose le blocage (une seule requête y parvient). Pour un compte
 * existant (`audit` non null), trace l'échec et, au blocage, prévient le
 * titulaire par email ; pour une adresse inconnue, ne fait rien d'autre.
 */
export async function recordFailedAttempt(
    email: string,
    req: FastifyRequest,
    audit: FailedAttemptAudit | null,
): Promise<void> {
    const key = throttleKey(email);
    const { count: justLocked } = await prisma.authThrottle.updateMany({
        where: { key, lockedUntil: null, failedAttempts: { gte: MAX_FAILED_ATTEMPTS } },
        data:  { lockedUntil: new Date(Date.now() + LOCKOUT_DURATION_MS) },
    });
    if (!audit) return;

    const row = await prisma.authThrottle.findUnique({ where: { key }, select: { failedAttempts: true } });
    await logAudit(audit.userId, audit.action, req, {
        ...audit.metadata,
        failedAttempts: row?.failedAttempts ?? MAX_FAILED_ATTEMPTS,
    });

    if (justLocked === 1) {
        await sendAccountLockedEmail(email, { ipAddress: getIp(req), userAgent: getUserAgent(req) });
    }
}

/** Réponse 429 d'une adresse bloquée. */
export function sendLocked(reply: FastifyReply, retryAfterSeconds: number): FastifyReply {
    return reply
        .status(429)
        .header("Retry-After", String(retryAfterSeconds))
        .send({ message: `Compte bloqué. Réessayez dans ${retryAfterSeconds}s.` });
}
