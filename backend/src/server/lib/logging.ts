/**
 * ╔═══════════════════════════════════════════════════════╗
 * ║         AEGIS - Journalisation des requêtes           ║
 * ║         src/server/lib/logging.ts                     ║
 * ╚═══════════════════════════════════════════════════════╝
 */
import type { FastifyRequest } from "fastify";

/**
 * Ce que le logger enregistre d'une requête. La query string est retirée :
 * elle peut contenir une adresse email (GET /api/auth/salt?email=...), qui
 * n'a rien à faire dans les logs de la plateforme.
 */
export function serializeRequest(req: FastifyRequest): { method: string; url: string; remoteAddress: string } {
    return {
        method:        req.method,
        url:           req.url.split("?")[0],
        remoteAddress: req.ip,
    };
}
