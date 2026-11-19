import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp } from "../helpers.js";

describe("smoke", () => {
    let app: FastifyInstance;

    beforeAll(async () => {
        app = await buildTestApp();
    });

    afterAll(async () => {
        await app.close();
    });

    it("GET /api/health returns ok", async () => {
        const res = await app.inject({ method: "GET", url: "/api/health" });
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ status: "ok" });
    });

    it("marks every API response as not cacheable (vault ciphertext, tokens, salts)", async () => {
        const health = await app.inject({ method: "GET", url: "/api/health" });
        const salt = await app.inject({ method: "GET", url: "/api/auth/salt?email=someone%40example.com" });
        const denied = await app.inject({ method: "GET", url: "/api/vault" });

        for (const res of [health, salt, denied]) {
            expect(res.headers["cache-control"]).toBe("no-store");
        }
    });
});
