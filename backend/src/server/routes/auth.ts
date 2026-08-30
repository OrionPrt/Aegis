/**
 * ╔═══════════════════════════════════════════════════════╗
 * ║         AEGIS — Auth routes (avec audit + sessions)   ║
 * ║         src/server/routes/auth.ts                     ║
 * ╚═══════════════════════════════════════════════════════╝
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import {
    createSession,
    validateRefreshToken,
    rotateRefreshToken,
    revokeSession,
    logAudit,
} from "../lib/audit.js";

interface JwtPayload { sub: string; email: string; }

interface CookieOptions {
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: "strict" | "lax" | "none";
    path?: string;
    maxAge?: number;
}

const BCRYPT_ROUNDS       = 12;
const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_DURATION_MS = 15 * 60 * 1000;
const DUMMY_SALT          = process.env.AEGIS_DUMMY_SALT ?? "dummy_salt_replace_with_env";

const RegisterSchema = z.object({
    email:      z.string().email().max(254).toLowerCase().trim(),
    authKeyHex: z.string().length(64).regex(/^[0-9a-f]+$/),
    saltBase64: z.string().min(32).max(64),
});

const LoginSchema = z.object({
    email:      z.string().email().max(254).toLowerCase().trim(),
    authKeyHex: z.string().length(64).regex(/^[0-9a-f]+$/),
});

function cookieOpts(maxAge?: number): CookieOptions {
    return {
        httpOnly: true,
        secure:   process.env.NODE_ENV === "production",
        sameSite: "strict",
        path:     "/api/auth",
        maxAge:   maxAge ?? 7 * 24 * 60 * 60,
    };
}

function accessTokenExpiresAt(): number {
    return Date.now() + ACCESS_TOKEN_TTL_MS;
}

// ─────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────

export async function authRoutes(app: FastifyInstance) {

    // ── POST /api/auth/register ─────────────────────────────

    app.post("/register", async (req: FastifyRequest, reply: FastifyReply) => {
        const parsed = RegisterSchema.safeParse(req.body);
        if (!parsed.success) {
            return reply.status(400).send({ message: "Données invalides.", errors: parsed.error.flatten() });
        }

        const { email, authKeyHex, saltBase64 } = parsed.data;

        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing) {
            await bcrypt.hash(authKeyHex, BCRYPT_ROUNDS); // timing constant
            return reply.status(409).send({ message: "Impossible de créer ce compte." });
        }

        const authKeyHash = await bcrypt.hash(authKeyHex, BCRYPT_ROUNDS);
        const user = await prisma.user.create({
            data: { email, authKeyHash, saltBase64 },
        });

        const accessToken    = await reply.jwtSign({ sub: user.id, email }, { expiresIn: "15m" });
        const refreshToken   = await createSession(user.id, req);

        await logAudit(user.id, "REGISTER", req);

        return reply
            .setCookie("aegis_rt", refreshToken, cookieOpts())
            .status(201)
            .send({ accessToken, expiresAt: accessTokenExpiresAt() });
    });

    // ── GET /api/auth/salt ──────────────────────────────────

    app.get("/salt", async (req: FastifyRequest, reply: FastifyReply) => {
        const email = (req.query as Record<string, string>).email?.toLowerCase().trim();

        if (!email || !z.string().email().safeParse(email).success) {
            return reply.status(400).send({ message: "Email invalide." });
        }

        const user = await prisma.user.findUnique({
            where:  { email },
            select: { saltBase64: true },
        });

        const saltBase64 = user?.saltBase64 ?? DUMMY_SALT;
        await new Promise((r) => setTimeout(r, 200 + Math.random() * 100));

        return reply.send({ saltBase64 });
    });

    // ── POST /api/auth/login ────────────────────────────────

    app.post("/login", async (req: FastifyRequest, reply: FastifyReply) => {
        const parsed = LoginSchema.safeParse(req.body);
        if (!parsed.success) {
            return reply.status(400).send({ message: "Données invalides." });
        }

        const { email, authKeyHex } = parsed.data;
        const user = await prisma.user.findUnique({ where: { email } });

        if (user?.lockedUntil && user.lockedUntil > new Date()) {
            const retryAfter = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000);
            return reply
                .status(429)
                .header("Retry-After", String(retryAfter))
                .send({ message: `Compte bloqué. Réessayez dans ${retryAfter}s.` });
        }

        const dummyHash = "$2b$12$invaliddummyhashfortimingattackmitigation000000000000";
        const isValid   = await bcrypt.compare(authKeyHex, user?.authKeyHash ?? dummyHash);

        if (!user || !isValid) {
            if (user) {
                const failedAttempts = user.failedAttempts + 1;
                await prisma.user.update({
                    where: { id: user.id },
                    data: {
                        failedAttempts,
                        ...(failedAttempts >= MAX_FAILED_ATTEMPTS && {
                            lockedUntil: new Date(Date.now() + LOCKOUT_DURATION_MS),
                        }),
                    },
                });
                await logAudit(user.id, "LOGIN_FAILED", req, { failedAttempts });
            }
            return reply.status(401).send({ message: "Identifiants incorrects." });
        }

        // Réinitialisation du compteur d'échecs
        await prisma.user.update({
            where: { id: user.id },
            data:  { failedAttempts: 0, lockedUntil: null },
        });

        const accessToken  = await reply.jwtSign({ sub: user.id, email }, { expiresIn: "15m" });
        const refreshToken = await createSession(user.id, req);

        await logAudit(user.id, "LOGIN_SUCCESS", req);

        return reply
            .setCookie("aegis_rt", refreshToken, cookieOpts())
            .send({ accessToken, expiresAt: accessTokenExpiresAt() });
    });

    // ── POST /api/auth/refresh ──────────────────────────────

    app.post("/refresh", async (req: FastifyRequest, reply: FastifyReply) => {
        const refreshToken = req.cookies["aegis_rt"];
        if (!refreshToken) {
            return reply.status(401).send({ message: "Session expirée." });
        }

        const result = await validateRefreshToken(refreshToken);
        if (!result) {
            reply.clearCookie("aegis_rt", cookieOpts(0));
            return reply.status(401).send({ message: "Session invalide. Reconnectez-vous." });
        }

        const newRefreshToken = await rotateRefreshToken(result.sessionId);
        const newAccessToken  = await reply.jwtSign(
            { sub: result.userId, email: result.email },
            { expiresIn: "15m" }
        );

        return reply
            .setCookie("aegis_rt", newRefreshToken, cookieOpts())
            .send({ accessToken: newAccessToken, expiresAt: accessTokenExpiresAt() });
    });

    // ── POST /api/auth/logout ───────────────────────────────

    app.post("/logout", async (req: FastifyRequest, reply: FastifyReply) => {
        const refreshToken = req.cookies["aegis_rt"];

        if (refreshToken) {
            const result = await validateRefreshToken(refreshToken);
            if (result) {
                await revokeSession(result.sessionId);
                await logAudit(result.userId, "LOGOUT", req);
            }
        }

        return reply
            .clearCookie("aegis_rt", cookieOpts(0))
            .send({ message: "Déconnecté avec succès." });
    });
}

// ─────────────────────────────────────────────────────────
// MIDDLEWARE
// ─────────────────────────────────────────────────────────

export async function requireAuth(req: FastifyRequest, reply: FastifyReply): Promise<void> {
    try {
        await req.jwtVerify();
    } catch {
        reply.status(401).send({ message: "Non authentifié." });
    }
}
