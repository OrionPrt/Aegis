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

        const payload = { ciphertext: Buffer.from("fake-encrypted-vault-content").toString("base64"), iv: Buffer.from("123456789012").toString("base64"), baseVersion: 0 };

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

    describe("version control (concurrent devices)", () => {
        const iv = Buffer.from("123456789012").toString("base64");

        async function put(token: string, ciphertext: string, baseVersion: number) {
            return app.inject({
                method: "PUT",
                url: "/api/vault",
                headers: { authorization: `Bearer ${token}` },
                payload: { ciphertext, iv, baseVersion },
            });
        }

        it("reports version 0 before any save, then increments it on each save", async () => {
            const email = uniqueEmail("vault-version");
            emails.push(email);
            const authKeyHex = fakeAuthKeyHex("vault-version");
            await registerAndLogin(email, authKeyHex);
            const token = await accessToken(email, authKeyHex);

            const empty = await app.inject({ method: "GET", url: "/api/vault", headers: { authorization: `Bearer ${token}` } });
            expect(empty.json().version).toBe(0);

            const first = await put(token, "QUFBQQ==", 0);
            expect(first.statusCode).toBe(200);
            expect(first.json().version).toBe(1);

            const second = await put(token, "QkJCQg==", 1);
            expect(second.json().version).toBe(2);

            const get = await app.inject({ method: "GET", url: "/api/vault", headers: { authorization: `Bearer ${token}` } });
            expect(get.json().version).toBe(2);
        });

        it("rejects a save based on an outdated version with 409 and keeps the newer vault", async () => {
            const email = uniqueEmail("vault-conflict");
            emails.push(email);
            const authKeyHex = fakeAuthKeyHex("vault-conflict");
            await registerAndLogin(email, authKeyHex);
            const token = await accessToken(email, authKeyHex);

            // Deux appareils partent de la version 0 ; le premier sauvegarde.
            expect((await put(token, "RGV2aWNlQg==", 0)).statusCode).toBe(200);
            const stale = await put(token, "RGV2aWNlQQ==", 0);

            expect(stale.statusCode).toBe(409);
            expect(stale.json().version).toBe(1);
            const get = await app.inject({ method: "GET", url: "/api/vault", headers: { authorization: `Bearer ${token}` } });
            expect(get.json().vault.ciphertext).toBe("RGV2aWNlQg==");
        });

        it("rejects a save without baseVersion with 400", async () => {
            const email = uniqueEmail("vault-noversion");
            emails.push(email);
            const authKeyHex = fakeAuthKeyHex("vault-noversion");
            await registerAndLogin(email, authKeyHex);
            const token = await accessToken(email, authKeyHex);

            const res = await app.inject({
                method: "PUT",
                url: "/api/vault",
                headers: { authorization: `Bearer ${token}` },
                payload: { ciphertext: "QUFBQQ==", iv },
            });
            expect(res.statusCode).toBe(400);
        });
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

    it("accepts a vault larger than Fastify's default 1 MiB body limit", async () => {
        const email = uniqueEmail("vault-large");
        emails.push(email);
        const authKeyHex = fakeAuthKeyHex("vault-large");
        await registerAndLogin(email, authKeyHex);
        const token = await accessToken(email, authKeyHex);

        // baseVersion : exigé par le contrôle de version du coffre, ignoré avant lui.
        const payload = { ciphertext: "A".repeat(2 * 1024 * 1024), iv: Buffer.from("123456789012").toString("base64"), baseVersion: 0 };
        const putRes = await app.inject({
            method: "PUT",
            url: "/api/vault",
            headers: { authorization: `Bearer ${token}` },
            payload,
        });
        expect(putRes.statusCode).toBe(200);

        const getRes = await app.inject({ method: "GET", url: "/api/vault", headers: { authorization: `Bearer ${token}` } });
        expect(getRes.json().vault.ciphertext).toHaveLength(payload.ciphertext.length);
    });

    it("rejects a vault above the maximum size with 413 and a readable message", async () => {
        const email = uniqueEmail("vault-toolarge");
        emails.push(email);
        const authKeyHex = fakeAuthKeyHex("vault-toolarge");
        await registerAndLogin(email, authKeyHex);
        const token = await accessToken(email, authKeyHex);

        const res = await app.inject({
            method: "PUT",
            url: "/api/vault",
            headers: { authorization: `Bearer ${token}` },
            payload: { ciphertext: "A".repeat(5 * 1024 * 1024), iv: Buffer.from("123456789012").toString("base64") },
        });
        expect(res.statusCode).toBe(413);
        expect(res.json().message).toMatch(/trop volumineux/);
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
