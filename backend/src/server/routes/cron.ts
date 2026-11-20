/**
 * ╔═══════════════════════════════════════════════════════╗
 * ║         AEGIS - Tâches planifiées (Vercel Cron)       ║
 * ║         src/server/routes/cron.ts                     ║
 * ╚═══════════════════════════════════════════════════════╝
 *
 * GET /api/cron/purge - appelée chaque nuit par Vercel Cron (vercel.json),
 * qui envoie « Authorization: Bearer <CRON_SECRET> ». Supprime les données
 * dont la durée de conservation est passée (voir la politique de
 * confidentialité, PrivacyPage.tsx).
 */
import crypto from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../lib/prisma.js";
import { SESSION_ABSOLUTE_TTL_MS } from "../lib/audit.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Journal d'audit : 1 an. */
export const AUDIT_LOG_RETENTION_MS = 365 * DAY_MS;
/** Inscriptions jamais confirmées : 7 jours (le lien expire au bout de 24 h). */
export const UNVERIFIED_ACCOUNT_RETENTION_MS = 7 * DAY_MS;
/** Compteurs de tentatives sans blocage en cours : 1 jour. */
export const THROTTLE_RETENTION_MS = DAY_MS;

export interface PurgeResult {
    auditLogs: number;
    unverifiedAccounts: number;
    sessions: number;
    throttles: number;
}

export async function purgeExpiredData(now = new Date()): Promise<PurgeResult> {
    const before = (ms: number) => new Date(now.getTime() - ms);

    const auditLogs = await prisma.auditLog.deleteMany({
        where: { createdAt: { lt: before(AUDIT_LOG_RETENTION_MS) } },
    });
    const unverifiedAccounts = await prisma.user.deleteMany({
        where: { emailVerifiedAt: null, createdAt: { lt: before(UNVERIFIED_ACCOUNT_RETENTION_MS) } },
    });
    const sessions = await prisma.session.deleteMany({
        where: { OR: [{ expiresAt: { lt: now } }, { createdAt: { lt: before(SESSION_ABSOLUTE_TTL_MS) } }] },
    });
    const throttles = await prisma.authThrottle.deleteMany({
        where: {
            updatedAt: { lt: before(THROTTLE_RETENTION_MS) },
            OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }],
        },
    });

    return {
        auditLogs:          auditLogs.count,
        unverifiedAccounts: unverifiedAccounts.count,
        sessions:           sessions.count,
        throttles:          throttles.count,
    };
}

function hasCronSecret(req: FastifyRequest, secret: string): boolean {
    const expected = Buffer.from(`Bearer ${secret}`);
    const received = Buffer.from(req.headers.authorization ?? "");
    return received.length === expected.length && crypto.timingSafeEqual(received, expected);
}

export async function cronRoutes(app: FastifyInstance) {
    app.get("/purge", async (req: FastifyRequest, reply: FastifyReply) => {
        const secret = process.env.CRON_SECRET;
        if (!secret) {
            return reply.status(503).send({ message: "CRON_SECRET n'est pas configuré." });
        }
        if (!hasCronSecret(req, secret)) {
            return reply.status(401).send({ message: "Non autorisé." });
        }

        const result = await purgeExpiredData();
        req.log.info({ purge: result }, "purge des données expirées");
        return reply.send(result);
    });
}
