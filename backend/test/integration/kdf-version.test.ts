import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp, uniqueEmail, fakeAuthKeyHex, fakeSaltBase64 } from "../helpers.js";
import { prisma } from "../../src/server/lib/prisma.js";
import { CURRENT_KDF_VERSION } from "../../src/server/lib/kdf.js";

describe("key derivation version", () => {
    let app: FastifyInstance;
    const emails: string[] = [];

    beforeAll(async () => {
        app = await buildTestApp();
    });

    afterAll(async () => {
        await app.close();
    });

    afterEach(async () => {
        if (emails.length) await prisma.user.deleteMany({ where: { email: { in: emails } } });
        emails.length = 0;
    });

    function register(email: string, extra: Record<string, unknown> = {}) {
        return app.inject({
            method: "POST",
            url: "/api/auth/register",
            payload: { email, authKeyHex: fakeAuthKeyHex(email), saltBase64: fakeSaltBase64(), ...extra },
        });
    }

    function salt(email: string) {
        return app.inject({ method: "GET", url: `/api/auth/salt?email=${encodeURIComponent(email)}` });
    }

    it("stores the version the client derived its keys with and returns it with the salt", async () => {
        const email = uniqueEmail("kdf-store");
        emails.push(email);

        expect((await register(email, { kdfVersion: CURRENT_KDF_VERSION })).statusCode).toBe(202);

        const user = await prisma.user.findUniqueOrThrow({ where: { email } });
        expect(user.kdfVersion).toBe(CURRENT_KDF_VERSION);
        expect((await salt(email)).json().kdfVersion).toBe(CURRENT_KDF_VERSION);
    });

    it("returns the account's own version, not the current one, for an older account", async () => {
        const email = uniqueEmail("kdf-old");
        emails.push(email);
        await register(email);
        await prisma.user.update({ where: { email }, data: { kdfVersion: 0 } });

        expect((await salt(email)).json().kdfVersion).toBe(0);
    });

    it("answers with the current version for an unknown email, like for a new account", async () => {
        expect((await salt(uniqueEmail("kdf-ghost"))).json().kdfVersion).toBe(CURRENT_KDF_VERSION);
    });

    it("rejects a registration with an unsupported version", async () => {
        const email = uniqueEmail("kdf-unsupported");
        emails.push(email);
        expect((await register(email, { kdfVersion: 99 })).statusCode).toBe(400);
    });
});
