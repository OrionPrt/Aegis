import { describe, it, expect, afterEach } from "vitest";
import type { FastifyRequest } from "fastify";
import {
    createSession,
    validateRefreshToken,
    rotateRefreshToken,
    revokeSession,
    revokeAllSessions,
    getUserSessions,
} from "../../src/server/lib/audit.js";
import { prisma } from "../../src/server/lib/prisma.js";
import { uniqueEmail, fakeAuthKeyHex, fakeSaltBase64 } from "../helpers.js";

function mockReq(): FastifyRequest {
    return { headers: { "user-agent": "vitest" }, ip: "127.0.0.1" } as unknown as FastifyRequest;
}

async function makeUser(email: string) {
    return prisma.user.create({
        data: { email, authKeyHash: fakeAuthKeyHex(), saltBase64: fakeSaltBase64() },
    });
}

describe("session lifecycle (lib/audit.ts)", () => {
    const emails: string[] = [];

    afterEach(async () => {
        await prisma.user.deleteMany({ where: { email: { in: emails } } });
        emails.length = 0;
    });

    it("creates a session and validates its refresh token", async () => {
        const email = uniqueEmail("session");
        emails.push(email);
        const user = await makeUser(email);

        const { refreshToken: token } = await createSession(user.id, mockReq());
        const result = await validateRefreshToken(token);

        expect(result).not.toBeNull();
        expect(result?.userId).toBe(user.id);
        expect(result?.email).toBe(email);
    });

    it("rejects a malformed or unknown refresh token", async () => {
        expect(await validateRefreshToken("not-a-real-token")).toBeNull();
        expect(await validateRefreshToken(`${"a".repeat(32)}.somesecret`)).toBeNull();
    });

    it("rotation invalidates the old token and issues a working new one", async () => {
        const email = uniqueEmail("rotate");
        emails.push(email);
        const user = await makeUser(email);

        const { refreshToken: oldToken } = await createSession(user.id, mockReq());
        const validated = await validateRefreshToken(oldToken);
        expect(validated).not.toBeNull();

        const newToken = (await rotateRefreshToken(validated!))!;

        expect(await validateRefreshToken(oldToken)).toBeNull();
        const revalidated = await validateRefreshToken(newToken);
        expect(revalidated?.userId).toBe(user.id);
    });

    it("revokeSession removes exactly that session", async () => {
        const email = uniqueEmail("revoke");
        emails.push(email);
        const user = await makeUser(email);

        const { refreshToken: token } = await createSession(user.id, mockReq());
        const { sessionId } = (await validateRefreshToken(token))!;

        await revokeSession(sessionId);

        expect(await validateRefreshToken(token)).toBeNull();
    });

    it("revokeAllSessions clears every session for a user", async () => {
        const email = uniqueEmail("revokeall");
        emails.push(email);
        const user = await makeUser(email);

        await createSession(user.id, mockReq());
        await createSession(user.id, mockReq());
        expect(await getUserSessions(user.id)).toHaveLength(2);

        await revokeAllSessions(user.id);
        expect(await getUserSessions(user.id)).toHaveLength(0);
    });

    it("enforces MAX_SESSIONS by evicting the oldest session", async () => {
        const email = uniqueEmail("maxsessions");
        emails.push(email);
        const user = await makeUser(email);

        // MAX_SESSIONS = 5 (lib/audit.ts) - la 6e création doit faire tomber la plus ancienne.
        const tokens: string[] = [];
        for (let i = 0; i < 6; i++) {
            tokens.push((await createSession(user.id, mockReq())).refreshToken);
            // Garantit un ordre createdAt strictement croissant sur une résolution
            // temporelle grossière (certains environnements de test arrondissent).
            await new Promise((r) => setTimeout(r, 5));
        }

        const sessions = await getUserSessions(user.id);
        expect(sessions).toHaveLength(5);
        // Le tout premier token créé doit avoir été évincé.
        expect(await validateRefreshToken(tokens[0])).toBeNull();
        // Le plus récent doit rester valide.
        expect(await validateRefreshToken(tokens[5])).not.toBeNull();
    });
});
