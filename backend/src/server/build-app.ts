/**
 * ╔═══════════════════════════════════════════════════════╗
 * ║         AEGIS - Construction de l'app Fastify         ║
 * ║           src/server/build-app.ts  (Fastify v5)       ║
 * ╚═══════════════════════════════════════════════════════╝
 *
 * Séparé de app.ts pour pouvoir être réutilisé :
 *  - en local : app.ts appelle buildApp() puis app.listen()
 *  - sur Vercel : api/index.ts appelle buildApp() et sert chaque requête
 *    sans jamais écouter de port (le modèle serverless ne le permet pas)
 */

import Fastify, { type FastifyInstance } from "fastify";
import fastifyJwt from "@fastify/jwt";
import fastifyCookie from "@fastify/cookie";
import fastifyHelmet from "@fastify/helmet";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { authRoutes } from "./routes/auth.js";
import { vaultRoutes } from "./routes/vault.js";
import { sessionRoutes } from "./routes/sessions.js";

export async function buildApp(): Promise<FastifyInstance> {
    const app = Fastify({ logger: true, trustProxy: true });

    // ─── Sécurité HTTP ────────────────────────────────────────
    await app.register(fastifyHelmet, {
        contentSecurityPolicy: {
            directives: {
                defaultSrc:              ["'self'"],
                scriptSrc:               ["'self'"],
                styleSrc:                ["'self'"],
                imgSrc:                  ["'self'", "data:"],
                connectSrc:              ["'self'"],
                fontSrc:                 ["'self'"],
                objectSrc:               ["'none'"],
                upgradeInsecureRequests: [],
            },
        },
    });

    // ─── Cookies ──────────────────────────────────────────────
    await app.register(fastifyCookie, {
        secret: process.env.COOKIE_SECRET!,
    });

    // ─── JWT ──────────────────────────────────────────────────
    await app.register(fastifyJwt, {
        secret: process.env.JWT_SECRET!,
        sign: {
            algorithm: "HS256",
            expiresIn: "15m",
        },
        verify: {
            algorithms: ["HS256"],
        },
    });

    // ─── Rate Limiting (Upstash Redis) ─────────────────────────
    // Remplace @fastify/rate-limit : son store en mémoire ne fonctionne
    // pas correctement en serverless (chaque instance a sa propre mémoire,
    // isolée des autres). Upstash centralise le compteur côté Redis.
    const ratelimit = new Ratelimit({
        redis: Redis.fromEnv(), // lit UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
        limiter: Ratelimit.slidingWindow(100, "1 m"),
        analytics: false,
    });

    app.addHook("preHandler", async (req, reply) => {
        const { success, reset } = await ratelimit.limit(req.ip);
        if (!success) {
            const retryAfter = Math.ceil((reset - Date.now()) / 1000);
            return reply
                .status(429)
                .header("Retry-After", String(retryAfter))
                .send({ message: "Trop de requêtes. Réessayez plus tard." });
        }
    });

    // ─── Health check ─────────────────────────────────────────
    app.get("/api/health", async (_req, reply) => {
        return reply.send({ status: "ok" });
    });

    // ─── Routes ───────────────────────────────────────────────
    await app.register(authRoutes,  { prefix: "/api/auth" });
    await app.register(vaultRoutes, { prefix: "/api/vault" });
    await app.register(sessionRoutes, { prefix: "/api/sessions" });

    // ─── Gestion des erreurs globales ─────────────────────────
    app.setErrorHandler((error, _req, reply) => {
        app.log.error(error);
        const message =
            process.env.NODE_ENV === "production"
                ? "Une erreur interne est survenue."
                // @ts-ignore
                : error.message;
        // @ts-ignore
        reply.status(error.statusCode ?? 500).send({ message });
    });

    return app;
}
