import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp, uniqueEmail, fakeAuthKeyHex, fakeSaltBase64 } from "../helpers.js";
import { prisma } from "../../src/server/lib/prisma.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY_MS);
const SECRET = "cron-secret-for-tests-0123456789";

describe("GET /api/cron/purge", () => {
    let app: FastifyInstance;
    const emails: string[] = [];
    const throttleKeys: string[] = [];

    beforeAll(async () => {
        vi.stubEnv("CRON_SECRET", SECRET);
        app = await buildTestApp();
    });

    afterAll(async () => {
        await app.close();
        vi.unstubAllEnvs();
    });

    afterEach(async () => {
        await prisma.user.deleteMany({ where: { email: { in: emails } } });
        await prisma.authThrottle.deleteMany({ where: { key: { in: throttleKeys } } });
        emails.length = 0;
        throttleKeys.length = 0;
    });

    function purge(authorization?: string) {
        return app.inject({ method: "GET", url: "/api/cron/purge", headers: authorization ? { authorization } : {} });
    }

    async function makeUser(prefix: string, data: { emailVerifiedAt: Date | null; createdAt?: Date }) {
        const email = uniqueEmail(prefix);
        emails.push(email);
        return prisma.user.create({ data: { email, authKeyHash: fakeAuthKeyHex(), saltBase64: fakeSaltBase64(), ...data } });
    }

    it("refuses a call without the right secret", async () => {
        expect((await purge()).statusCode).toBe(401);
        expect((await purge("Bearer wrong-secret")).statusCode).toBe(401);
    });

    it("deletes audit entries older than a year and keeps recent ones", async () => {
        const user = await makeUser("purge-audit", { emailVerifiedAt: new Date() });
        await prisma.auditLog.createMany({ data: [
            { userId: user.id, action: "LOGIN_SUCCESS", createdAt: daysAgo(400) },
            { userId: user.id, action: "LOGIN_SUCCESS", createdAt: daysAgo(30) },
        ] });

        expect((await purge(`Bearer ${SECRET}`)).statusCode).toBe(200);

        const left = await prisma.auditLog.findMany({ where: { userId: user.id } });
        expect(left).toHaveLength(1);
        expect(left[0].createdAt.getTime()).toBeGreaterThan(daysAgo(31).getTime());
    });

    it("deletes registrations never confirmed after 7 days, and only those", async () => {
        const stale   = await makeUser("purge-stale",   { emailVerifiedAt: null, createdAt: daysAgo(8) });
        const pending = await makeUser("purge-pending", { emailVerifiedAt: null, createdAt: daysAgo(1) });
        const oldUser = await makeUser("purge-old",     { emailVerifiedAt: daysAgo(500), createdAt: daysAgo(500) });

        await purge(`Bearer ${SECRET}`);

        const ids = (await prisma.user.findMany({ where: { id: { in: [stale.id, pending.id, oldUser.id] } } })).map((u) => u.id);
        expect(ids.sort()).toEqual([pending.id, oldUser.id].sort());
    });

    it("drops stale attempt counters but keeps a lock that is still running", async () => {
        const stale = `purge-throttle-stale-${Date.now()}`;
        const locked = `purge-throttle-locked-${Date.now()}`;
        throttleKeys.push(stale, locked);
        await prisma.authThrottle.create({ data: { key: stale, failedAttempts: 2 } });
        await prisma.authThrottle.create({ data: { key: locked, failedAttempts: 3, lockedUntil: new Date(Date.now() + 10 * 60_000) } });
        await prisma.$executeRaw`UPDATE "AuthThrottle" SET "updatedAt" = ${daysAgo(2)} WHERE key IN (${stale}, ${locked})`;

        await purge(`Bearer ${SECRET}`);

        const keys = (await prisma.authThrottle.findMany({ where: { key: { in: [stale, locked] } } })).map((t) => t.key);
        expect(keys).toEqual([locked]);
    });
});
