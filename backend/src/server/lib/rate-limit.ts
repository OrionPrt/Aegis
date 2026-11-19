/**
 * ╔═══════════════════════════════════════════════════════╗
 * ║         AEGIS - Limitation de débit                   ║
 * ║         src/server/lib/rate-limit.ts                  ║
 * ╚═══════════════════════════════════════════════════════╝
 *
 * Compteurs centralisés dans Upstash Redis : un store en mémoire ne
 * fonctionne pas en serverless (chaque instance a sa propre mémoire).
 *
 * - une limite globale par IP sur toute l'API ;
 * - une limite plus stricte par IP sur les routes qui testent une preuve
 *   de mot de passe ou exposent un sel (login, inscription, /salt).
 *
 * Sans Upstash (local, CI), la limitation est désactivée - sauf en
 * production, où l'application refuse de démarrer.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

export interface RateLimiter {
    limit(key: string): Promise<{ success: boolean; reset: number }>;
}

export interface RateLimiters {
    global: RateLimiter;
    auth:   RateLimiter;
}

const GLOBAL_REQUESTS_PER_MINUTE = 100;
const AUTH_REQUESTS_PER_MINUTE   = 20;

/** Routes soumises à la limite stricte, au format "MÉTHODE url-de-route". */
export const AUTH_RATE_LIMITED_ROUTES = new Set([
    "POST /api/auth/login",
    "POST /api/auth/register",
    "GET /api/auth/salt",
]);

/**
 * Construit les limiteurs depuis l'environnement. Retourne null hors
 * production si Upstash n'est pas configuré ; lève une erreur en production.
 */
export function createRateLimiters(env: NodeJS.ProcessEnv = process.env): RateLimiters | null {
    const url   = env.UPSTASH_REDIS_REST_URL;
    const token = env.UPSTASH_REDIS_REST_TOKEN;
    if (!url || !token) {
        if (env.NODE_ENV === "production") {
            throw new Error(
                "UPSTASH_REDIS_REST_URL et UPSTASH_REDIS_REST_TOKEN sont requis en production : " +
                "sans eux, aucune limitation de débit ne protège l'authentification."
            );
        }
        return null;
    }

    const redis = new Redis({ url, token });
    return {
        global: new Ratelimit({ redis, prefix: "aegis:global", limiter: Ratelimit.slidingWindow(GLOBAL_REQUESTS_PER_MINUTE, "1 m") }),
        auth:   new Ratelimit({ redis, prefix: "aegis:auth",   limiter: Ratelimit.slidingWindow(AUTH_REQUESTS_PER_MINUTE, "1 m") }),
    };
}

function isAuthRoute(req: FastifyRequest): boolean {
    return AUTH_RATE_LIMITED_ROUTES.has(`${req.method} ${req.routeOptions.url}`);
}

function sendTooManyRequests(reply: FastifyReply, reset: number): FastifyReply {
    const retryAfter = Math.max(1, Math.ceil((reset - Date.now()) / 1000));
    return reply
        .status(429)
        .header("Retry-After", String(retryAfter))
        .send({ message: "Trop de requêtes. Réessayez plus tard." });
}

/**
 * Applique les limites à chaque requête. Si Redis ne répond pas, les routes
 * d'authentification sont refusées (503) plutôt que laissées sans limite ;
 * le reste de l'API continue de répondre.
 */
export function registerRateLimiting(app: FastifyInstance, limiters: RateLimiters | null): void {
    if (!limiters) {
        app.log.warn("UPSTASH_REDIS_REST_URL/TOKEN absents - rate limiting désactivé.");
        return;
    }

    app.addHook("preHandler", async (req, reply) => {
        const authRoute = isAuthRoute(req);
        try {
            const global = await limiters.global.limit(req.ip);
            if (!global.success) return sendTooManyRequests(reply, global.reset);

            if (authRoute) {
                const auth = await limiters.auth.limit(req.ip);
                if (!auth.success) return sendTooManyRequests(reply, auth.reset);
            }
        } catch (err) {
            req.log.error({ err }, "rate limiting indisponible");
            if (authRoute) {
                return reply.status(503).send({ message: "Service temporairement indisponible. Réessayez plus tard." });
            }
        }
    });
}
