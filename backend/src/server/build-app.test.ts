import { describe, it, expect, afterEach, vi } from "vitest";
import type { FastifyError } from "fastify";
import { publicErrorMessage } from "./build-app.js";

function fastifyError(message: string): FastifyError {
    return Object.assign(new Error(message), { code: "TEST" }) as FastifyError;
}

describe("publicErrorMessage", () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    it("never exposes the raw message of a 5xx error in production", () => {
        vi.stubEnv("NODE_ENV", "production");
        const message = publicErrorMessage(fastifyError('relation "User" does not exist'), 500);
        expect(message).toBe("Une erreur interne est survenue.");
    });

    it("returns a generic message for a 4xx error in production", () => {
        vi.stubEnv("NODE_ENV", "production");
        expect(publicErrorMessage(fastifyError("Body cannot be empty"), 400)).toBe("Requête invalide.");
    });

    it("keeps an actionable message for a body that is too large, in every environment", () => {
        vi.stubEnv("NODE_ENV", "production");
        expect(publicErrorMessage(fastifyError("Request body is too large"), 413)).toMatch(/trop volumineux/);
    });

    it("returns the raw message outside production, to ease debugging", () => {
        vi.stubEnv("NODE_ENV", "development");
        expect(publicErrorMessage(fastifyError("boom"), 500)).toBe("boom");
    });
});
