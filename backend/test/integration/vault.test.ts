import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp, uniqueEmail, fakeAuthKeyHex, fakeSaltBase64 } from "../helpers.js";
import { prisma } from "../../src/server/lib/prisma.js";

describe("/api/vault", () => {
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

    async function registerAndLogin(email: string, authKeyHex: string) {
        await app.inject({
            method: "POST",
            url: "/api/auth/register",
            payload: { email, authKeyHex, saltBase64: fakeSaltBase64() },
        });
        return authKeyHex;
    }

    async function accessToken(email: string, authKeyHex: string): Promise<string> {
        const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, authKeyHex } });
        return res.json().accessToken as string;
    }

    it("rejects unauthenticated access with 401", async () => {
        const res = await app.inject({ method: "GET", url: "/api/vault" });
        expect(res.statusCode).toBe(401);
    });

    it("returns vault: null right after registration (nothing saved yet)", async () => {
        const email = uniqueEmail("vault-empty");
        emails.push(email);
        const authKeyHex = fakeAuthKeyHex("vault-empty");
        await registerAndLogin(email, authKeyHex);
        const token = await accessToken(email, authKeyHex);

        const res = await app.inject({ method: "GET", url: "/api/vault", headers: { authorization: `Bearer ${token}` } });
        expect(res.statusCode).toBe(200);
        expect(res.json().vault).toBeNull();
    });

    it("round-trips a saved ciphertext/iv pair exactly", async () => {
        const email = uniqueEmail("vault-roundtrip");
        emails.push(email);
        const authKeyHex = fakeAuthKeyHex("vault-roundtrip");
        await registerAndLogin(email, authKeyHex);
        const token = await accessToken(email, authKeyHex);

        const payload = { ciphertext: Buffer.from("fake-encrypted-vault-content").toString("base64"), iv: Buffer.from("123456789012").toString("base64") };

        const putRes = await app.inject({
            method: "PUT",
            url: "/api/vault",
            headers: { authorization: `Bearer ${token}` },
            payload,
        });
        expect(putRes.statusCode).toBe(200);

        const getRes = await app.inject({ method: "GET", url: "/api/vault", headers: { authorization: `Bearer ${token}` } });
        expect(getRes.json().vault).toEqual({ ciphertext: payload.ciphertext, iv: payload.iv });
    });

    it("rejects a malformed vault payload with 400", async () => {
        const email = uniqueEmail("vault-badpayload");
        emails.push(email);
        const authKeyHex = fakeAuthKeyHex("vault-badpayload");
        await registerAndLogin(email, authKeyHex);
        const token = await accessToken(email, authKeyHex);

        const res = await app.inject({
            method: "PUT",
            url: "/api/vault",
            headers: { authorization: `Bearer ${token}` },
            payload: { ciphertext: "not base64!!", iv: "too-short" },
        });
        expect(res.statusCode).toBe(400);
    });

    describe("DELETE /api/vault (account deletion)", () => {
        it("requires a body with authKeyHex (400 without it)", async () => {
            const email = uniqueEmail("del-nobody");
            emails.push(email);
            const authKeyHex = fakeAuthKeyHex("del-nobody");
            await registerAndLogin(email, authKeyHex);
            const token = await accessToken(email, authKeyHex);

            const res = await app.inject({ method: "DELETE", url: "/api/vault", headers: { authorization: `Bearer ${token}` } });
            expect(res.statusCode).toBe(400);
        });

        it("rejects the wrong master password with 401 and does not delete the account", async () => {
            const email = uniqueEmail("del-wrongpw");
            emails.push(email);
            const authKeyHex = fakeAuthKeyHex("del-wrongpw");
            await registerAndLogin(email, authKeyHex);
            const token = await accessToken(email, authKeyHex);

            const res = await app.inject({
                method: "DELETE",
                url: "/api/vault",
                headers: { authorization: `Bearer ${token}` },
                payload: { authKeyHex: fakeAuthKeyHex("wrong-password") },
            });
            expect(res.statusCode).toBe(401);

            const stillThere = await prisma.user.findUnique({ where: { email } });
            expect(stillThere).not.toBeNull();
        });

        it("locks the account after 3 failed deletion attempts", async () => {
            const email = uniqueEmail("del-lockout");
            emails.push(email);
            const authKeyHex = fakeAuthKeyHex("del-lockout");
            await registerAndLogin(email, authKeyHex);
            const token = await accessToken(email, authKeyHex);

            for (let i = 0; i < 3; i++) {
                await app.inject({
                    method: "DELETE",
                    url: "/api/vault",
                    headers: { authorization: `Bearer ${token}` },
                    payload: { authKeyHex: fakeAuthKeyHex("wrong") },
                });
            }

            const res = await app.inject({
                method: "DELETE",
                url: "/api/vault",
                headers: { authorization: `Bearer ${token}` },
                payload: { authKeyHex },
            });
            expect(res.statusCode).toBe(429);
        });

        it("on success, permanently deletes the account and its vault", async () => {
            const email = uniqueEmail("del-ok");
            emails.push(email);
            const authKeyHex = fakeAuthKeyHex("del-ok");
            await registerAndLogin(email, authKeyHex);
            const token = await accessToken(email, authKeyHex);

            const res = await app.inject({
                method: "DELETE",
                url: "/api/vault",
                headers: { authorization: `Bearer ${token}` },
                payload: { authKeyHex },
            });
            expect(res.statusCode).toBe(200);

            expect(await prisma.user.findUnique({ where: { email } })).toBeNull();
        });
    });
});
