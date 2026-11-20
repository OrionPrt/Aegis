import { describe, it, expect, afterEach } from "vitest";
import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import { createRateLimiters, registerRateLimiting } from "./rate-limit.js";
import type { RateLimiter } from "./rate-limit.js";

function limiter(behaviour: "allow" | "deny" | "fail"): RateLimiter & { keys: string[] } {
    const keys: string[] = [];
    return {
        keys,
        async limit(key: string) {
            keys.push(key);
            if (behaviour === "fail") throw new Error("redis down");
            return { success: behaviour === "allow", reset: Date.now() + 30_000 };
        },
    };
}

async function appWith(global: RateLimiter, auth: RateLimiter): Promise<FastifyInstance> {
    const app = Fastify();
    registerRateLimiting(app, { global, auth });
    app.post("/api/auth/login", async () => ({ ok: true }));
    app.get("/api/vault", async () => ({ ok: true }));
    await app.ready();
    return app;
}

describe("createRateLimiters", () => {
    it("refuses to start in production without Upstash credentials", () => {
        expect(() => createRateLimiters({ NODE_ENV: "production" })).toThrow(/UPSTASH_REDIS_REST_URL/);
    });

    it("disables rate limiting outside production when Upstash is not configured", () => {
        expect(createRateLimiters({ NODE_ENV: "development" })).toBeNull();
    });
});

describe("registerRateLimiting", () => {
    let app: FastifyInstance;
    afterEach(async () => { await app.close(); });

    it("applies the strict limit to authentication routes only", async () => {
        const auth = limiter("deny");
        app = await appWith(limiter("allow"), auth);

        const login = await app.inject({ method: "POST", url: "/api/auth/login" });
        const vault = await app.inject({ method: "GET", url: "/api/vault" });

        expect(login.statusCode).toBe(429);
        expect(login.headers["retry-after"]).toBeDefined();
        expect(vault.statusCode).toBe(200);
        expect(auth.keys).toHaveLength(1);
    });

    it("applies the global limit to every route", async () => {
        app = await appWith(limiter("deny"), limiter("allow"));
        const vault = await app.inject({ method: "GET", url: "/api/vault" });
        expect(vault.statusCode).toBe(429);
    });

    it("fails closed on authentication routes and open elsewhere when Redis is unreachable", async () => {
        app = await appWith(limiter("fail"), limiter("fail"));

        const login = await app.inject({ method: "POST", url: "/api/auth/login" });
        const vault = await app.inject({ method: "GET", url: "/api/vault" });

        expect(login.statusCode).toBe(503);
        expect(vault.statusCode).toBe(200);
    });
});
