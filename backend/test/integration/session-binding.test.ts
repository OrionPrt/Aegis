import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp, uniqueEmail, fakeAuthKeyHex, fakeSaltBase64, getCookie, registerVerified } from "../helpers.js";
import { prisma } from "../../src/server/lib/prisma.js";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("access tokens bound to their session, refresh token rotation", () => {
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

    async function newAccount(prefix: string) {
        const email = uniqueEmail(prefix);
        emails.push(email);
        const authKeyHex = fakeAuthKeyHex(prefix);
        const res = await registerVerified(app, email, authKeyHex);
        return { email, authKeyHex, token: res.json().accessToken as string, cookie: getCookie(res, "aegis_rt")! };
    }

    async function login(email: string, authKeyHex: string) {
        const res = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, authKeyHex } });
        return { token: res.json().accessToken as string, cookie: getCookie(res, "aegis_rt")! };
    }

    function getVault(token: string) {
        return app.inject({ method: "GET", url: "/api/vault", headers: { authorization: `Bearer ${token}` } });
    }

    function refresh(cookie: string) {
        return app.inject({ method: "POST", url: "/api/auth/refresh", cookies: { aegis_rt: cookie } });
    }

    describe("access token", () => {
        it("stops working as soon as its session is logged out", async () => {
            const { token, cookie } = await newAccount("bind-logout");
            expect((await getVault(token)).statusCode).toBe(200);

            await app.inject({ method: "POST", url: "/api/auth/logout", cookies: { aegis_rt: cookie } });

            expect((await getVault(token)).statusCode).toBe(401);
        });

        it("stops working when its session is revoked from another device", async () => {
            const account = await newAccount("bind-revoke");
            const other = await login(account.email, account.authKeyHex);
            const sessions = (await app.inject({
                method: "GET", url: "/api/sessions", headers: { authorization: `Bearer ${other.token}` },
            })).json().sessions as Array<{ id: string; isCurrent: boolean }>;
            const firstDevice = sessions.find((s) => !s.isCurrent)!;

            await app.inject({
                method: "DELETE", url: `/api/sessions/${firstDevice.id}`, headers: { authorization: `Bearer ${other.token}` },
            });

            expect((await getVault(account.token)).statusCode).toBe(401);
            expect((await getVault(other.token)).statusCode).toBe(200);
        });

        it("stops working on every device after a master password change", async () => {
            const account = await newAccount("bind-cp");
            const other = await login(account.email, account.authKeyHex);

            const res = await app.inject({
                method: "POST",
                url: "/api/auth/change-password",
                headers: { authorization: `Bearer ${account.token}` },
                payload: {
                    currentAuthKeyHex: account.authKeyHex,
                    newAuthKeyHex: fakeAuthKeyHex("bind-cp-new"),
                    vault: { ciphertext: "AAAA", iv: "AAAAAAAAAAAAAAAA" },
                    baseVersion: 0,
                },
            });
            expect(res.statusCode).toBe(200);

            expect((await getVault(other.token)).statusCode).toBe(401);
        });

        it("is rejected when it carries no session id", async () => {
            const { email } = await newAccount("bind-nosid");
            const user = await prisma.user.findUniqueOrThrow({ where: { email } });
            const unbound = app.jwt.sign({ sub: user.id, email });

            expect((await getVault(unbound)).statusCode).toBe(401);
        });
    });

    describe("refresh token", () => {
        it("lets only one of two simultaneous refreshes with the same cookie rotate it", async () => {
            const { cookie } = await newAccount("rotate-race");

            const [a, b] = await Promise.all([refresh(cookie), refresh(cookie)]);
            const winner = [a, b].find((r) => r.statusCode === 200)!;

            expect([a.statusCode, b.statusCode].sort()).toEqual([200, 401]);
            expect((await refresh(getCookie(winner, "aegis_rt")!)).statusCode).toBe(200);
        });

        it("revokes the session when an old refresh token is replayed after the grace period", async () => {
            const { email, cookie: oldCookie } = await newAccount("rotate-reuse");
            const rotated = await refresh(oldCookie);
            const newCookie = getCookie(rotated, "aegis_rt")!;
            const user = await prisma.user.findUniqueOrThrow({ where: { email } });
            await prisma.session.updateMany({ where: { userId: user.id }, data: { rotatedAt: new Date(Date.now() - 5 * 60_000) } });

            expect((await refresh(oldCookie)).statusCode).toBe(401);

            expect(await prisma.session.count({ where: { userId: user.id } })).toBe(0);
            expect((await refresh(newCookie)).statusCode).toBe(401);
        });

        it("refuses to extend a session past its 30-day absolute lifetime", async () => {
            const { email, cookie } = await newAccount("rotate-absolute");
            const user = await prisma.user.findUniqueOrThrow({ where: { email } });
            await prisma.session.updateMany({ where: { userId: user.id }, data: { createdAt: new Date(Date.now() - 31 * DAY_MS) } });

            expect((await refresh(cookie)).statusCode).toBe(401);
        });
    });

    it("marks only the session of the calling token as current, even on the same IP and browser", async () => {
        const account = await newAccount("current-flag");
        await login(account.email, account.authKeyHex);

        const sessions = (await app.inject({
            method: "GET", url: "/api/sessions", headers: { authorization: `Bearer ${account.token}` },
        })).json().sessions as Array<{ isCurrent: boolean }>;

        expect(sessions).toHaveLength(2);
        expect(sessions.filter((s) => s.isCurrent)).toHaveLength(1);
    });
});
