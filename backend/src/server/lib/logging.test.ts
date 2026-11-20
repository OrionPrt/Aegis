import { describe, it, expect } from "vitest";
import type { FastifyRequest } from "fastify";
import { serializeRequest } from "./logging.js";

describe("serializeRequest", () => {
    it("drops the query string, which can hold an email address (/auth/salt?email=...)", () => {
        const req = { method: "GET", url: "/api/auth/salt?email=alice%40example.com", ip: "203.0.113.9" } as FastifyRequest;
        const logged = serializeRequest(req);
        expect(logged).toEqual({ method: "GET", url: "/api/auth/salt", remoteAddress: "203.0.113.9" });
        expect(JSON.stringify(logged)).not.toContain("alice");
    });
});
