import { describe, it, expect } from "vitest";
import type { FastifyRequest } from "fastify";
import { generateRefreshToken, getIp, getUserAgent } from "./audit.js";

function mockRequest(overrides: Partial<{ headers: Record<string, string>; ip: string }>): FastifyRequest {
    return {
        headers: overrides.headers ?? {},
        ip: overrides.ip ?? "127.0.0.1",
    } as unknown as FastifyRequest;
}

describe("generateRefreshToken", () => {
    it("produces a lookupToken.secretToken pair with the expected format", () => {
        const { token, lookupToken, secretToken } = generateRefreshToken();
        expect(token).toBe(`${lookupToken}.${secretToken}`);
        expect(lookupToken).toMatch(/^[0-9a-f]{32}$/);
        expect(secretToken.length).toBeGreaterThan(10);
    });

    it("never repeats a token across calls (cryptographically random)", () => {
        const a = generateRefreshToken();
        const b = generateRefreshToken();
        expect(a.lookupToken).not.toBe(b.lookupToken);
        expect(a.secretToken).not.toBe(b.secretToken);
    });
});

describe("getIp", () => {
    it("prefers the first entry of x-forwarded-for when present (reverse proxy)", () => {
        const req = mockRequest({ headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1" }, ip: "10.0.0.1" });
        expect(getIp(req)).toBe("203.0.113.9");
    });

    it("falls back to req.ip when no x-forwarded-for header is set", () => {
        const req = mockRequest({ ip: "198.51.100.4" });
        expect(getIp(req)).toBe("198.51.100.4");
    });
});

describe("getUserAgent", () => {
    it("returns the user-agent header truncated to 200 chars", () => {
        const long = "A".repeat(300);
        const req = mockRequest({ headers: { "user-agent": long } });
        expect(getUserAgent(req)).toHaveLength(200);
    });

    it("returns 'unknown' when no user-agent header is present", () => {
        const req = mockRequest({});
        expect(getUserAgent(req)).toBe("unknown");
    });
});
