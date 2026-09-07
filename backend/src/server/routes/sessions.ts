/**
 * ╔═══════════════════════════════════════════════════════╗
 * ║         AEGIS - Routes Sessions & Audit               ║
 * ║         src/server/routes/sessions.ts                 ║
 * ╚═══════════════════════════════════════════════════════╝
 *
 * GET  /api/sessions           → liste des sessions actives
 * DELETE /api/sessions/:id     → révoque une session
 * DELETE /api/sessions         → révoque toutes les sessions
 * GET  /api/audit              → historique des actions
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "./auth.js";
import {
    getUserSessions,
    revokeSession,
    revokeAllSessions,
    logAudit,
} from "../lib/audit.js";

interface JwtPayload { sub: string; email: string; }

// ─────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────

export async function sessionRoutes(app: FastifyInstance) {

    // ── GET /api/sessions ───────────────────────────────────

    app.get(
        "/",
        { preHandler: [requireAuth] },
        async (req: FastifyRequest, reply: FastifyReply) => {
            const { sub: userId } = req.user as JwtPayload;

            const sessions = await getUserSessions(userId);

            // Ajoute un flag "current" sur la session en cours
            // (identifiée par l'IP + user-agent de la requête)
            const currentIp = req.ip;
            const currentUa = req.headers["user-agent"] ?? "";

            const enriched = sessions.map((s) => ({
                ...s,
                isCurrent:
                    s.ipAddress === currentIp &&
                    s.userAgent === currentUa,
            }));

            return reply.send({ sessions: enriched });
        }
    );

    // ── DELETE /api/sessions/:id ────────────────────────────

    app.delete(
        "/:id",
        { preHandler: [requireAuth] },
        async (req: FastifyRequest, reply: FastifyReply) => {
            const { sub: userId } = req.user as JwtPayload;
            const { id } = req.params as { id: string };

            // Vérifie que la session appartient bien à cet utilisateur
            const session = await prisma.session.findFirst({
                where: { id, userId },
            });

            if (!session) {
                return reply.status(404).send({ message: "Session introuvable." });
            }

            await revokeSession(id);
            await logAudit(userId, "SESSION_REVOKED", req, { revokedSessionId: id });

            return reply.send({ message: "Session révoquée." });
        }
    );

    // ── DELETE /api/sessions ────────────────────────────────

    app.delete(
        "/",
        { preHandler: [requireAuth] },
        async (req: FastifyRequest, reply: FastifyReply) => {
            const { sub: userId } = req.user as JwtPayload;

            await revokeAllSessions(userId);
            await logAudit(userId, "SESSION_REVOKED", req, { scope: "all" });

            reply
                .clearCookie("aegis_rt", {
                    httpOnly: true,
                    secure:   process.env.NODE_ENV === "production",
                    sameSite: "strict",
                    path:     "/api/auth",
                })
                .send({ message: "Toutes les sessions révoquées." });
        }
    );

    // ── GET /api/audit ──────────────────────────────────────

    app.get(
        "/audit",
        { preHandler: [requireAuth] },
        async (req: FastifyRequest, reply: FastifyReply) => {
            const { sub: userId } = req.user as JwtPayload;

            const query  = req.query as Record<string, string>;
            const limit  = Math.min(parseInt(query.limit  ?? "50"), 100);
            const offset = parseInt(query.offset ?? "0");

            const [logs, total] = await Promise.all([
                prisma.auditLog.findMany({
                    where:   { userId },
                    orderBy: { createdAt: "desc" },
                    take:    limit,
                    skip:    offset,
                    select: {
                        id:        true,
                        action:    true,
                        ipAddress: true,
                        userAgent: true,
                        metadata:  true,
                        createdAt: true,
                    },
                }),
                prisma.auditLog.count({ where: { userId } }),
            ]);

            return reply.send({ logs, total, limit, offset });
        }
    );
}
