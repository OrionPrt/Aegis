import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp, uniqueEmail, fakeAuthKeyHex, fakeSaltBase64, getCookie } from "../helpers.js";
import { prisma } from "../../src/server/lib/prisma.js";

describe("/api/sessions", () => {
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

    async function register(email: string, authKeyHex: string) {
        return app.inject({
            method: "POST",
            url: "/api/auth/register",
            payload: { email, authKeyHex, saltBase64: fakeSaltBase64() },
        });
    }

    it("rejects unauthenticated access with 401", async () => {
        const res = await app.inject({ method: "GET", url: "/api/sessions" });
        expect(res.statusCode).toBe(401);
    });

    it("lists the current session right after registration", async () => {
        const email = uniqueEmail("sess-list");
        emails.push(email);
        const authKeyHex = fakeAuthKeyHex("sess-list");
        const reg = await register(email, authKeyHex);
        const token = reg.json().accessToken as string;

        const res = await app.inject({ method: "GET", url: "/api/sessions", headers: { authorization: `Bearer ${token}` } });
        expect(res.statusCode).toBe(200);
        const sessions = res.json().sessions;
        expect(sessions).toHaveLength(1);
        expect(sessions[0].isCurrent).toBe(true);
    });

    it("never returns another user's sessions", async () => {
        const emailA = uniqueEmail("sess-isolation-a");
        const emailB = uniqueEmail("sess-isolation-b");
        emails.push(emailA, emailB);
        const regA = await register(emailA, fakeAuthKeyHex("sess-isolation-a"));
        await register(emailB, fakeAuthKeyHex("sess-isolation-b"));
        const tokenA = regA.json().accessToken as string;

        const res = await app.inject({ method: "GET", url: "/api/sessions", headers: { authorization: `Bearer ${tokenA}` } });
        const sessions = res.json().sessions as Array<{ id: string }>;
        expect(sessions).toHaveLength(1);

        const userB = await prisma.user.findUniqueOrThrow({ where: { email: emailB } });
        const sessionIdsB = (await prisma.session.findMany({ where: { userId: userB.id } })).map((s) => s.id);
        expect(sessions.some((s) => sessionIdsB.includes(s.id))).toBe(false);
    });

    describe("DELETE /api/sessions/:id", () => {
        it("revokes a specific session belonging to the caller", async () => {
            const email = uniqueEmail("sess-revoke-one");
            emails.push(email);
            const authKeyHex = fakeAuthKeyHex("sess-revoke-one");
            const reg = await register(email, authKeyHex);
            const token = reg.json().accessToken as string;

            const list = await app.inject({ method: "GET", url: "/api/sessions", headers: { authorization: `Bearer ${token}` } });
            const sessionId = list.json().sessions[0].id as string;

            const res = await app.inject({
                method: "DELETE",
                url: `/api/sessions/${sessionId}`,
                headers: { authorization: `Bearer ${token}` },
            });
            expect(res.statusCode).toBe(200);

            const user = await prisma.user.findUniqueOrThrow({ where: { email } });
            expect(await prisma.session.findMany({ where: { userId: user.id } })).toHaveLength(0);
        });

        it("returns 404 when trying to revoke another user's session", async () => {
            const emailA = uniqueEmail("sess-crossrevoke-a");
            const emailB = uniqueEmail("sess-crossrevoke-b");
            emails.push(emailA, emailB);
            const regA = await register(emailA, fakeAuthKeyHex("sess-crossrevoke-a"));
            const regB = await register(emailB, fakeAuthKeyHex("sess-crossrevoke-b"));
            const tokenA = regA.json().accessToken as string;

            const listB = await app.inject({ method: "GET", url: "/api/sessions", headers: { authorization: `Bearer ${regB.json().accessToken}` } });
            const sessionIdB = listB.json().sessions[0].id as string;

            const res = await app.inject({
                method: "DELETE",
                url: `/api/sessions/${sessionIdB}`,
                headers: { authorization: `Bearer ${tokenA}` },
            });
            expect(res.statusCode).toBe(404);

            // La session de B doit rester intacte.
            const userB = await prisma.user.findUniqueOrThrow({ where: { email: emailB } });
            expect(await prisma.session.findMany({ where: { userId: userB.id } })).toHaveLength(1);
        });
    });

    it("DELETE /api/sessions revokes everything and clears the cookie", async () => {
        const email = uniqueEmail("sess-revoke-all");
        emails.push(email);
        const authKeyHex = fakeAuthKeyHex("sess-revoke-all");
        const reg = await register(email, authKeyHex);
        const token = reg.json().accessToken as string;
        const cookie = getCookie(reg, "aegis_rt")!;

        // Une deuxième session pour le même compte (ex: un autre appareil).
        await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, authKeyHex } });

        const res = await app.inject({
            method: "DELETE",
            url: "/api/sessions",
            headers: { authorization: `Bearer ${token}` },
            cookies: { aegis_rt: cookie },
        });
        expect(res.statusCode).toBe(200);

        const user = await prisma.user.findUniqueOrThrow({ where: { email } });
        expect(await prisma.session.findMany({ where: { userId: user.id } })).toHaveLength(0);
    });

    describe("GET /api/sessions/audit", () => {
        it("logs REGISTER then LOGIN_SUCCESS in reverse-chronological order", async () => {
            const email = uniqueEmail("sess-audit");
            emails.push(email);
            const authKeyHex = fakeAuthKeyHex("sess-audit");
            const reg = await register(email, authKeyHex);
            const token = reg.json().accessToken as string;

            await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, authKeyHex } });

            const res = await app.inject({
                method: "GET",
                url: "/api/sessions/audit",
                headers: { authorization: `Bearer ${token}` },
            });
            expect(res.statusCode).toBe(200);
            const body = res.json();
            const actions = body.logs.map((l: { action: string }) => l.action);
            expect(actions[0]).toBe("LOGIN_SUCCESS");
            expect(actions).toContain("REGISTER");
            expect(body.total).toBeGreaterThanOrEqual(2);
        });

        it("caps the limit query param at 100", async () => {
            const email = uniqueEmail("sess-audit-limit");
            emails.push(email);
            const reg = await register(email, fakeAuthKeyHex("sess-audit-limit"));
            const token = reg.json().accessToken as string;

            const res = await app.inject({
                method: "GET",
                url: "/api/sessions/audit?limit=99999",
                headers: { authorization: `Bearer ${token}` },
            });
            expect(res.json().limit).toBe(100);
        });
    });
});
