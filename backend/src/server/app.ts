/**
 * ╔═══════════════════════════════════════════════════════╗
 * ║         AEGIS — Point d'entrée serveur                ║
 * ║           src/server/app.ts  (Fastify v5)             ║
 * ╚═══════════════════════════════════════════════════════╝
 */

import Fastify from "fastify";
import fastifyJwt from "@fastify/jwt";
import fastifyCookie from "@fastify/cookie";
import fastifyRateLimit from "@fastify/rate-limit";
import fastifyHelmet from "@fastify/helmet";
import { authRoutes } from "./routes/auth.js";
import { vaultRoutes } from "./routes/vault.js";
import { sessionRoutes } from "./routes/sessions.js";

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

// ─── Rate Limiting ────────────────────────────────────────
await app.register(fastifyRateLimit, {
    max: 100,
    timeWindow: "1 minute",
});

// ─── Health check ─────────────────────────────────────────
app.get("/api/health", async (_req, reply) => {
    return reply.send({ status: "ok" });
});

import fastifyCors from "@fastify/cors";

await app.register(fastifyCors, {
    origin: "https://aegis-n69mysusp-prietoorion-1818s-projects.vercel.app/",
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE"],
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

// ─── Démarrage ────────────────────────────────────────────
try {
    await app.listen({ port: parseInt(process.env.PORT ?? "3000"), host: "0.0.0.0" });
    console.log("🛡️  Aegis server running on port 3000");
} catch (err) {
    app.log.error(err);
    process.exit(1);
}
