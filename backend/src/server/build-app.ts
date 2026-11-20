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

import Fastify, { type FastifyError, type FastifyInstance } from "fastify";
import fastifyJwt from "@fastify/jwt";
import fastifyCookie from "@fastify/cookie";
import fastifyHelmet from "@fastify/helmet";
import { createRateLimiters, registerRateLimiting } from "./lib/rate-limit.js";
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
    // Voir lib/rate-limit.ts : limite globale + limite stricte sur les routes
    // d'authentification ; refuse de démarrer en production sans Upstash.
    registerRateLimiting(app, createRateLimiters());

    // ─── Gestion des erreurs globales ─────────────────────────
    // Déclaré AVANT l'enregistrement des routes : un plugin enregistré via
    // `await app.register()` est chargé aussitôt et ne voit que le
    // gestionnaire d'erreurs déjà en place à ce moment-là.
    app.setErrorHandler((error: FastifyError, _req, reply) => {
        app.log.error(error);
        const statusCode = error.statusCode ?? 500;
        reply.status(statusCode).send({ message: publicErrorMessage(error, statusCode) });
    });

    // ─── Health check ─────────────────────────────────────────
    app.get("/api/health", async (_req, reply) => {
        return reply.send({ status: "ok" });
    });

    // ─── Routes ───────────────────────────────────────────────
    await app.register(authRoutes,  { prefix: "/api/auth" });
    await app.register(vaultRoutes, { prefix: "/api/vault" });
    await app.register(sessionRoutes, { prefix: "/api/sessions" });

    return app;
}

/**
 * Message renvoyé au client pour une erreur non gérée par les routes.
 * En production, jamais le message brut (il peut décrire l'implémentation) ;
 * un corps trop volumineux garde un message explicite, l'utilisateur
 * pouvant y remédier (coffre trop gros).
 */
export function publicErrorMessage(error: FastifyError, statusCode: number): string {
    if (statusCode === 413) return "Le coffre est trop volumineux pour être sauvegardé.";
    if (process.env.NODE_ENV !== "production") return error.message;
    return statusCode < 500 ? "Requête invalide." : "Une erreur interne est survenue.";
}
