import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildTestApp, uniqueEmail, fakeAuthKeyHex, fakeSaltBase64 } from "../helpers.js";
import { prisma } from "../../src/server/lib/prisma.js";

// Le lien n'est connu que de l'email : on l'intercepte à l'envoi.
vi.mock("../../src/server/lib/email.js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../src/server/lib/email.js")>()),
    sendVerificationEmail: vi.fn(async () => undefined),
}));
const { sendVerificationEmail } = await import("../../src/server/lib/email.js");
const sentLinks = () => vi.mocked(sendVerificationEmail).mock.calls.map(([, link]) => link);
const tokenOf = (link: string) => new URL(link).searchParams.get("token")!;

describe("email address confirmation", () => {
    let app: FastifyInstance;
    const emails: string[] = [];

    beforeAll(async () => {
        vi.stubEnv("APP_URL", "https://app.aegis.example");
        app = await buildTestApp();
    });

    afterAll(async () => {
        await app.close();
        vi.unstubAllEnvs();
    });

    afterEach(async () => {
        vi.mocked(sendVerificationEmail).mockClear();
        if (emails.length) await prisma.user.deleteMany({ where: { email: { in: emails } } });
        emails.length = 0;
    });

    async function registerPending(prefix: string) {
        const email = uniqueEmail(prefix);
        emails.push(email);
        const authKeyHex = fakeAuthKeyHex(prefix);
        await app.inject({
            method: "POST",
            url: "/api/auth/register",
            headers: { host: "evil.example" },
            payload: { email, authKeyHex, saltBase64: fakeSaltBase64() },
        });
        return { email, authKeyHex, link: sentLinks().at(-1)! };
    }

    const login = (email: string, authKeyHex: string) =>
        app.inject({ method: "POST", url: "/api/auth/login", payload: { email, authKeyHex } });
    const verify = (token: string) =>
        app.inject({ method: "POST", url: "/api/auth/verify-email", payload: { token } });

    it("emails a link to the site's own address, never one built from the request's Host header", async () => {
        const { link } = await registerPending("verify-link");
        expect(link).toMatch(/^https:\/\/app\.aegis\.example\/verify-email\?token=[\w-]{43}$/);
    });

    it("blocks login until the link is opened, then lets the account in", async () => {
        const { email, authKeyHex, link } = await registerPending("verify-flow");

        const before = await login(email, authKeyHex);
        expect(before.statusCode).toBe(403);
        expect(before.json().code).toBe("EMAIL_NOT_VERIFIED");

        expect((await verify(tokenOf(link))).statusCode).toBe(200);

        expect((await login(email, authKeyHex)).statusCode).toBe(200);
        const user = await prisma.user.findUniqueOrThrow({ where: { email } });
        expect(user.emailVerifiedAt).not.toBeNull();
        expect(user.emailVerificationTokenHash).toBeNull();
        expect(await prisma.auditLog.count({ where: { userId: user.id, action: "EMAIL_VERIFIED" } })).toBe(1);
    });

    it("answers a wrong password on a pending account with the usual 401, not the 403", async () => {
        const { email } = await registerPending("verify-wrongpw");
        expect((await login(email, fakeAuthKeyHex("wrong"))).statusCode).toBe(401);
    });

    it("accepts a link only once, and never after it expires", async () => {
        const used = await registerPending("verify-once");
        expect((await verify(tokenOf(used.link))).statusCode).toBe(200);
        expect((await verify(tokenOf(used.link))).statusCode).toBe(400);

        const expired = await registerPending("verify-expired");
        await prisma.user.update({ where: { email: expired.email }, data: { emailVerificationExpiresAt: new Date(Date.now() - 1000) } });
        expect((await verify(tokenOf(expired.link))).statusCode).toBe(400);
    });

    it("sends no email when the address already has an account", async () => {
        const { email, link } = await registerPending("verify-dup");
        await verify(tokenOf(link));
        vi.mocked(sendVerificationEmail).mockClear();

        await app.inject({
            method: "POST",
            url: "/api/auth/register",
            payload: { email, authKeyHex: fakeAuthKeyHex("intruder"), saltBase64: fakeSaltBase64() },
        });

        expect(sendVerificationEmail).not.toHaveBeenCalled();
    });

    it("resends a fresh link only to a pending registration, with the same answer in every case", async () => {
        const pending = await registerPending("verify-resend");
        const resend = (email: string) =>
            app.inject({ method: "POST", url: "/api/auth/resend-verification", payload: { email } });

        const forPending = await resend(pending.email);
        const forUnknown = await resend(uniqueEmail("verify-resend-ghost"));

        expect(forPending.statusCode).toBe(202);
        expect(forUnknown.json()).toEqual(forPending.json());
        expect(sentLinks()).toHaveLength(2);
        const fresh = sentLinks()[1];
        expect((await verify(tokenOf(pending.link))).statusCode).toBe(400);
        expect((await verify(tokenOf(fresh))).statusCode).toBe(200);
    });
});
