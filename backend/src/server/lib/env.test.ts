import { describe, it, expect } from "vitest";
import { checkEnvironment } from "./env.js";

const STRONG_SECRET = "s".repeat(32);

describe("checkEnvironment", () => {
    it("refuses to start without JWT_SECRET", () => {
        expect(() => checkEnvironment({})).toThrow(/JWT_SECRET/);
    });

    it("refuses to start in production without a database URL", () => {
        expect(() => checkEnvironment({ NODE_ENV: "production", JWT_SECRET: STRONG_SECRET })).toThrow(/DATABASE_URL/);
    });

    it("warns about a JWT secret shorter than 32 characters without blocking", () => {
        const warnings = checkEnvironment({ JWT_SECRET: "short" });
        expect(warnings.join(" ")).toMatch(/JWT_SECRET/);
    });

    it("has nothing to report for a complete configuration", () => {
        expect(checkEnvironment({ NODE_ENV: "production", JWT_SECRET: STRONG_SECRET, DATABASE_URL: "postgresql://x", APP_URL: "https://aegis.example" })).toEqual([]);
    });

    it("refuses to start in production without a public URL for email links", () => {
        expect(() => checkEnvironment({ NODE_ENV: "production", JWT_SECRET: STRONG_SECRET, DATABASE_URL: "postgresql://x" })).toThrow(/APP_URL/);
    });

    it("accepts the production domain Vercel provides instead of APP_URL", () => {
        expect(checkEnvironment({ NODE_ENV: "production", JWT_SECRET: STRONG_SECRET, DATABASE_URL: "postgresql://x", VERCEL_PROJECT_PRODUCTION_URL: "aegis.example" })).toEqual([]);
    });
});
