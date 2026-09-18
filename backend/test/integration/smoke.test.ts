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
});
