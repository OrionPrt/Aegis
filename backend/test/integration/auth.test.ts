import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp, uniqueEmail, fakeAuthKeyHex, fakeSaltBase64, getCookie, registerVerified } from "../helpers.js";
import { prisma } from "../../src/server/lib/prisma.js";
import { throttleKey } from "../../src/server/lib/lockout.js";

describe("/api/auth", () => {
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

    /** Compte confirmé et connecté : réponse du login (jeton + cookie). */
    async function register(email: string, authKeyHex = fakeAuthKeyHex()) {
        return registerVerified(app, email, authKeyHex);
    }

    describe("POST /register", () => {
        function rawRegister(email: string, authKeyHex = fakeAuthKeyHex()) {
            return app.inject({
                method: "POST",
                url: "/api/auth/register",
                payload: { email, authKeyHex, saltBase64: fakeSaltBase64() },
            });
        }

        it("creates a pending account without opening a session", async () => {
            const email = uniqueEmail("register");
            emails.push(email);

            const res = await rawRegister(email);

            expect(res.statusCode).toBe(202);
            expect(res.json().accessToken).toBeUndefined();
            expect(getCookie(res, "aegis_rt")).toBeUndefined();
            const user = await prisma.user.findUniqueOrThrow({ where: { email } });
            expect(user.emailVerifiedAt).toBeNull();
            expect(user.emailVerificationTokenHash).toMatch(/^[0-9a-f]{64}$/);
            expect(user.emailVerificationExpiresAt!.getTime()).toBeGreaterThan(Date.now());
        });

        it("answers a registration on a taken address exactly like a new one, and changes nothing", async () => {
            const email = uniqueEmail("dup");
            emails.push(email);
            await register(email, fakeAuthKeyHex("owner"));
            const before = await prisma.user.findUniqueOrThrow({ where: { email } });

            const fresh = await rawRegister(uniqueEmail("dup-fresh"));
            const dup = await rawRegister(email, fakeAuthKeyHex("intruder"));

            expect(dup.statusCode).toBe(fresh.statusCode);
            expect(dup.json()).toEqual(fresh.json());
            const after = await prisma.user.findUniqueOrThrow({ where: { email } });
            expect(after.authKeyHash).toBe(before.authKeyHash);
            await prisma.user.deleteMany({ where: { email: { startsWith: "dup-fresh" } } });
        });

        it("keeps a pending registration that is still valid instead of letting someone replace it", async () => {
            const email = uniqueEmail("pending-keep");
            emails.push(email);
            await rawRegister(email, fakeAuthKeyHex("first"));
            const first = await prisma.user.findUniqueOrThrow({ where: { email } });

            await rawRegister(email, fakeAuthKeyHex("second"));

            const after = await prisma.user.findUniqueOrThrow({ where: { email } });
            expect(after.id).toBe(first.id);
            expect(after.authKeyHash).toBe(first.authKeyHash);
        });

        it("replaces a pending registration whose link has expired", async () => {
            const email = uniqueEmail("pending-expired");
            emails.push(email);
            await rawRegister(email, fakeAuthKeyHex("first"));
            await prisma.user.update({ where: { email }, data: { emailVerificationExpiresAt: new Date(Date.now() - 1000) } });
            const first = await prisma.user.findUniqueOrThrow({ where: { email } });

            await rawRegister(email, fakeAuthKeyHex("second"));

            const after = await prisma.user.findUniqueOrThrow({ where: { email } });
            expect(after.id).not.toBe(first.id);
        });

        it("rejects a salt that is not 32 bytes of base64 with 400", async () => {
            const res = await app.inject({
                method: "POST",
                url: "/api/auth/register",
                payload: { email: uniqueEmail("badsalt"), authKeyHex: fakeAuthKeyHex(), saltBase64: "!".repeat(44) },
            });
            expect(res.statusCode).toBe(400);
        });

        it("rejects a malformed payload with 400", async () => {
            const res = await app.inject({
                method: "POST",
                url: "/api/auth/register",
                payload: { email: "not-an-email", authKeyHex: "short", saltBase64: "x" },
            });
            expect(res.statusCode).toBe(400);
        });
    });

    describe("GET /salt (anti-enumeration)", () => {
        it("returns the real salt for an existing account", async () => {
            const email = uniqueEmail("salt");
            emails.push(email);
            const authKeyHex = fakeAuthKeyHex("b");
            const regRes = await register(email, authKeyHex);
            expect(regRes.statusCode).toBe(200);

            const res = await app.inject({ method: "GET", url: `/api/auth/salt?email=${encodeURIComponent(email)}` });
            expect(res.statusCode).toBe(200);
            expect(res.json().saltBase64).toBeTypeOf("string");
        });

        it("still returns 200 with a salt-shaped value for a non-existent account", async () => {
            const res = await app.inject({
                method: "GET",
                url: `/api/auth/salt?email=${encodeURIComponent(uniqueEmail("ghost"))}`,
            });
            expect(res.statusCode).toBe(200);
            expect(res.json().saltBase64).toBeTypeOf("string");
        });

        it("rejects an invalid email format with 400", async () => {
            const res = await app.inject({ method: "GET", url: "/api/auth/salt?email=not-an-email" });
            expect(res.statusCode).toBe(400);
        });

        it("gives each unknown email its own fake salt, stable across calls (no shared dummy value)", async () => {
            const salt = async (email: string) =>
                (await app.inject({ method: "GET", url: `/api/auth/salt?email=${encodeURIComponent(email)}` })).json().saltBase64;
            const ghostA = uniqueEmail("ghost-a");
            const ghostB = uniqueEmail("ghost-b");

            const [a1, a2, b] = [await salt(ghostA), await salt(ghostA), await salt(ghostB)];

            expect(a1).toBe(a2);
            expect(a1).not.toBe(b);
            // Même forme qu'un vrai sel : 32 octets en base64.
            expect(Buffer.from(a1, "base64")).toHaveLength(32);
        });

        it("rejects a repeated email parameter with 400 instead of crashing", async () => {
            const res = await app.inject({ method: "GET", url: "/api/auth/salt?email=a@example.com&email=b@example.com" });
            expect(res.statusCode).toBe(400);
        });
    });

    describe("POST /login", () => {
        it("logs in with correct credentials", async () => {
            const email = uniqueEmail("login");
            emails.push(email);
            const authKeyHex = fakeAuthKeyHex("c");
            await register(email, authKeyHex);

            const res = await app.inject({
                method: "POST",
                url: "/api/auth/login",
                payload: { email, authKeyHex },
            });

            expect(res.statusCode).toBe(200);
            expect(res.json().accessToken).toBeTypeOf("string");
        });

        it("rejects wrong credentials with 401 and a generic message", async () => {
            const email = uniqueEmail("wrongpw");
            emails.push(email);
            await register(email, fakeAuthKeyHex("d"));

            const res = await app.inject({
                method: "POST",
                url: "/api/auth/login",
                payload: { email, authKeyHex: fakeAuthKeyHex("e") },
            });

            expect(res.statusCode).toBe(401);
            expect(res.json().message).toBe("Identifiants incorrects.");
        });

        it("returns the SAME message for an unknown email as for a wrong password (anti-enumeration)", async () => {
            const res = await app.inject({
                method: "POST",
                url: "/api/auth/login",
                payload: { email: uniqueEmail("noaccount"), authKeyHex: fakeAuthKeyHex("f") },
            });
            expect(res.statusCode).toBe(401);
            expect(res.json().message).toBe("Identifiants incorrects.");
        });

        it("locks the account after 3 failed attempts (429 with Retry-After)", async () => {
            const email = uniqueEmail("lockout");
            emails.push(email);
            const correctKey = fakeAuthKeyHex("g");
            await register(email, correctKey);

            for (let i = 0; i < 3; i++) {
                await app.inject({
                    method: "POST",
                    url: "/api/auth/login",
                    payload: { email, authKeyHex: fakeAuthKeyHex("wrong") },
                });
            }

            const res = await app.inject({
                method: "POST",
                url: "/api/auth/login",
                payload: { email, authKeyHex: correctKey },
            });

            expect(res.statusCode).toBe(429);
            expect(res.headers["retry-after"]).toBeDefined();
        });

        it("counts simultaneous wrong attempts atomically: only 3 are checked before the lock", async () => {
            const email = uniqueEmail("lockout-burst");
            emails.push(email);
            await register(email, fakeAuthKeyHex("burst"));

            const results = await Promise.all(
                Array.from({ length: 8 }, () => app.inject({
                    method: "POST",
                    url: "/api/auth/login",
                    payload: { email, authKeyHex: fakeAuthKeyHex("wrong") },
                })),
            );

            const statuses = results.map((r) => r.statusCode);
            expect(statuses.filter((code) => code === 401)).toHaveLength(3);
            expect(statuses.filter((code) => code === 429)).toHaveLength(5);
            const throttle = await prisma.authThrottle.findUniqueOrThrow({ where: { key: throttleKey(email) } });
            expect(throttle.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
        });

        it("locks an address without an account exactly like a registered one (no 429 oracle)", async () => {
            const statuses: number[] = [];
            const email = uniqueEmail("ghost-lockout");
            for (let i = 0; i < 4; i++) {
                const res = await app.inject({
                    method: "POST",
                    url: "/api/auth/login",
                    payload: { email, authKeyHex: fakeAuthKeyHex("wrong") },
                });
                statuses.push(res.statusCode);
            }
            expect(statuses).toEqual([401, 401, 401, 429]);
        });

        it("starts a fresh count once the lock has expired (one mistake does not re-lock)", async () => {
            const email = uniqueEmail("lockout-expired");
            emails.push(email);
            await register(email, fakeAuthKeyHex("expired"));
            await prisma.authThrottle.upsert({
                where:  { key: throttleKey(email) },
                create: { key: throttleKey(email), failedAttempts: 3, lockedUntil: new Date(Date.now() - 1000) },
                update: { failedAttempts: 3, lockedUntil: new Date(Date.now() - 1000) },
            });

            const res = await app.inject({
                method: "POST",
                url: "/api/auth/login",
                payload: { email, authKeyHex: fakeAuthKeyHex("wrong") },
            });

            expect(res.statusCode).toBe(401);
            const throttle = await prisma.authThrottle.findUniqueOrThrow({ where: { key: throttleKey(email) } });
            expect(throttle.failedAttempts).toBe(1);
            expect(throttle.lockedUntil).toBeNull();
        });

        it("resets the failed-attempts counter on a successful login", async () => {
            const email = uniqueEmail("resetcounter");
            emails.push(email);
            const correctKey = fakeAuthKeyHex("h");
            await register(email, correctKey);

            await app.inject({
                method: "POST",
                url: "/api/auth/login",
                payload: { email, authKeyHex: fakeAuthKeyHex("wrong") },
            });

            const ok = await app.inject({
                method: "POST",
                url: "/api/auth/login",
                payload: { email, authKeyHex: correctKey },
            });
            expect(ok.statusCode).toBe(200);

            expect(await prisma.authThrottle.findUnique({ where: { key: throttleKey(email) } })).toBeNull();
        });

        it("revokes the previous session on same-device re-login (no ghost sessions)", async () => {
            const email = uniqueEmail("dedup");
            emails.push(email);
            const authKeyHex = fakeAuthKeyHex("i");
            const first = await register(email, authKeyHex);
            const firstCookie = getCookie(first, "aegis_rt")!;

            await app.inject({
                method: "POST",
                url: "/api/auth/login",
                payload: { email, authKeyHex },
                cookies: { aegis_rt: firstCookie },
            });

            const user = await prisma.user.findUniqueOrThrow({ where: { email } });
            const sessions = await prisma.session.findMany({ where: { userId: user.id } });
            expect(sessions).toHaveLength(1);
        });
    });

    describe("POST /refresh", () => {
        it("rotates the refresh token and returns a fresh access token + matching email", async () => {
            const email = uniqueEmail("refresh");
            emails.push(email);
            const reg = await register(email);
            const cookie = getCookie(reg, "aegis_rt")!;

            const res = await app.inject({ method: "POST", url: "/api/auth/refresh", cookies: { aegis_rt: cookie } });

            expect(res.statusCode).toBe(200);
            expect(res.json().accessToken).toBeTypeOf("string");
            // Régression : ce champ permet au client de détecter un mélange de
            // comptes (cookie partagé par le navigateur, masterKey par onglet).
            expect(res.json().email).toBe(email);
        });

        it("rejects a missing or invalid refresh cookie with 401", async () => {
            const res = await app.inject({ method: "POST", url: "/api/auth/refresh" });
            expect(res.statusCode).toBe(401);
        });

        it("REGRESSION: refresh with account B's cookie returns account B's email, never account A's", async () => {
            // Reproduit exactement le scénario du bug corrigé : un navigateur qui
            // a connecté deux comptes (le cookie aegis_rt appartient au dernier
            // compte connecté, quel que soit l'onglet qui en a besoin).
            const emailA = uniqueEmail("crossacct-a");
            const emailB = uniqueEmail("crossacct-b");
            emails.push(emailA, emailB);
            await register(emailA);
            const regB = await register(emailB);
            const cookieB = getCookie(regB, "aegis_rt")!;

            const res = await app.inject({ method: "POST", url: "/api/auth/refresh", cookies: { aegis_rt: cookieB } });

            expect(res.json().email).toBe(emailB);
            expect(res.json().email).not.toBe(emailA);
        });
    });

    describe("POST /change-password", () => {
        async function loginAndGetToken(email: string, authKeyHex: string) {
            const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, authKeyHex } });
            return res.json().accessToken as string;
        }

        it("rejects an incorrect current password with 401", async () => {
            const email = uniqueEmail("cp-wrong");
            emails.push(email);
            const authKeyHex = fakeAuthKeyHex("j");
            await register(email, authKeyHex);
            const token = await loginAndGetToken(email, authKeyHex);

            const res = await app.inject({
                method: "POST",
                url: "/api/auth/change-password",
                headers: { authorization: `Bearer ${token}` },
                payload: {
                    currentAuthKeyHex: fakeAuthKeyHex("wrong"),
                    newAuthKeyHex: fakeAuthKeyHex("k"),
                    vault: { ciphertext: "AAAA", iv: "AAAAAAAAAAAAAAAA" },
                    baseVersion: 0,
                },
            });

            expect(res.statusCode).toBe(401);
        });

        it("rejects the request without a valid access token", async () => {
            const res = await app.inject({
                method: "POST",
                url: "/api/auth/change-password",
                payload: {
                    currentAuthKeyHex: fakeAuthKeyHex(),
                    newAuthKeyHex: fakeAuthKeyHex("k"),
                    vault: { ciphertext: "AAAA", iv: "AAAAAAAAAAAAAAAA" },
                    baseVersion: 0,
                },
            });
            expect(res.statusCode).toBe(401);
        });

        it("on success, updates the auth hash and revokes all sessions", async () => {
            const email = uniqueEmail("cp-ok");
            emails.push(email);
            const currentKey = fakeAuthKeyHex("l");
            const newKey = fakeAuthKeyHex("m");
            await register(email, currentKey);
            const token = await loginAndGetToken(email, currentKey);

            const res = await app.inject({
                method: "POST",
                url: "/api/auth/change-password",
                headers: { authorization: `Bearer ${token}` },
                payload: {
                    currentAuthKeyHex: currentKey,
                    newAuthKeyHex: newKey,
                    vault: { ciphertext: "AAAA", iv: "AAAAAAAAAAAAAAAA" },
                    baseVersion: 0,
                },
            });
            expect(res.statusCode).toBe(200);

            const user = await prisma.user.findUniqueOrThrow({ where: { email } });
            const sessions = await prisma.session.findMany({ where: { userId: user.id } });
            expect(sessions).toHaveLength(0);

            // L'ancienne authKey ne doit plus fonctionner, la nouvelle si.
            const oldLogin = await app.inject({
                method: "POST",
                url: "/api/auth/login",
                payload: { email, authKeyHex: currentKey },
            });
            expect(oldLogin.statusCode).toBe(401);

            const newLogin = await app.inject({
                method: "POST",
                url: "/api/auth/login",
                payload: { email, authKeyHex: newKey },
            });
            expect(newLogin.statusCode).toBe(200);
        });

        it("rejects a change based on an outdated vault version with 409 and changes nothing", async () => {
            const email = uniqueEmail("cp-conflict");
            emails.push(email);
            const currentKey = fakeAuthKeyHex("cp-conflict");
            await register(email, currentKey);
            const token = await loginAndGetToken(email, currentKey);

            // Un autre appareil a sauvegardé entre-temps : le coffre est en version 1.
            await app.inject({
                method: "PUT",
                url: "/api/vault",
                headers: { authorization: `Bearer ${token}` },
                payload: { ciphertext: "QkJCQg==", iv: "AAAAAAAAAAAAAAAA", baseVersion: 0 },
            });

            const res = await app.inject({
                method: "POST",
                url: "/api/auth/change-password",
                headers: { authorization: `Bearer ${token}` },
                payload: {
                    currentAuthKeyHex: currentKey,
                    newAuthKeyHex: fakeAuthKeyHex("cp-conflict-new"),
                    vault: { ciphertext: "AAAA", iv: "AAAAAAAAAAAAAAAA" },
                    baseVersion: 0,
                },
            });
            expect(res.statusCode).toBe(409);

            const user = await prisma.user.findUniqueOrThrow({ where: { email } });
            expect(user.vaultData).toBe("QkJCQg==");
            const stillWorks = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, authKeyHex: currentKey } });
            expect(stillWorks.statusCode).toBe(200);
        });
    });

    describe("POST /logout", () => {
        it("revokes the session tied to the refresh cookie", async () => {
            const email = uniqueEmail("logout");
            emails.push(email);
            const reg = await register(email);
            const cookie = getCookie(reg, "aegis_rt")!;

            const res = await app.inject({ method: "POST", url: "/api/auth/logout", cookies: { aegis_rt: cookie } });
            expect(res.statusCode).toBe(200);

            const refreshAfter = await app.inject({ method: "POST", url: "/api/auth/refresh", cookies: { aegis_rt: cookie } });
            expect(refreshAfter.statusCode).toBe(401);
        });
    });
});
