/**
 * ╔═══════════════════════════════════════════════════════╗
 * ║         AEGIS - Route /vault                          ║
 * ║         src/server/routes/vault.ts                    ║
 * ╚═══════════════════════════════════════════════════════╝
 *
 * Le serveur ne voit que du ciphertext - jamais de données en clair.
 *
 * GET  /api/vault  → retourne { ciphertext, iv } du vault
 * PUT  /api/vault  → remplace le vault chiffré
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import bcrypt from "bcryptjs";
import { VAULT_CONFLICT_MESSAGE, VaultVersionSchema } from "../lib/vault-version.js";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth, MAX_FAILED_ATTEMPTS, LOCKOUT_DURATION_MS } from "./auth.js";
import { getIp, getUserAgent, logAudit } from "../lib/audit.js";
import { sendAccountLockedEmail } from "../lib/email.js";

// ─────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────

interface JwtPayload {
    sub: string;   // userId
    email: string;
}

// ─────────────────────────────────────────────────────────
// SCHÉMAS ZOD
// ─────────────────────────────────────────────────────────

const VaultPayloadSchema = z.object({
    // ciphertext : vault chiffré AES-256-GCM encodé en Base64
    ciphertext: z
        .string()
        .min(1)
        .max(10 * 1024 * 1024) // 10 MB max - protection contre les abus
        .regex(/^[A-Za-z0-9+/=]+$/, "ciphertext must be base64"),

    // iv : vecteur d'initialisation AES-GCM (12 bytes → 16 chars base64)
    iv: z
        .string()
        .length(16)
        .regex(/^[A-Za-z0-9+/=]+$/, "iv must be base64"),

    // Version du coffre dont part le client (renvoyée par GET /api/vault)
    baseVersion: VaultVersionSchema,
});

const DeleteAccountSchema = z.object({
    authKeyHex: z.string().length(64).regex(/^[0-9a-f]+$/),
});

// ─────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────

export async function vaultRoutes(app: FastifyInstance) {

    // ── GET /api/vault ──────────────────────────────────────
    // Retourne le vault chiffré de l'utilisateur authentifié.

    app.get(
        "/",
        { preHandler: [requireAuth] },
        async (req: FastifyRequest, reply: FastifyReply) => {
            const { sub: userId } = req.user as JwtPayload;

            const user = await prisma.user.findUnique({
                where:  { id: userId },
                select: { vaultData: true, vaultIv: true, vaultVersion: true, updatedAt: true },
            });

            if (!user) {
                return reply.status(404).send({ message: "Utilisateur introuvable." });
            }

            // Vault vide - premier accès après inscription
            if (!user.vaultData || !user.vaultIv) {
                return reply.status(200).send({ vault: null, version: user.vaultVersion });
            }

            return reply.send({
                vault: {
                    ciphertext: user.vaultData,
                    iv:         user.vaultIv,
                },
                version:   user.vaultVersion,
                updatedAt: user.updatedAt.getTime(),
            });
        }
    );

    // ── PUT /api/vault ──────────────────────────────────────
    // Remplace intégralement le vault chiffré.
    // Le serveur ne valide que la structure - jamais le contenu.

    app.put(
        "/",
        { preHandler: [requireAuth] },
        async (req: FastifyRequest, reply: FastifyReply) => {
            const { sub: userId } = req.user as JwtPayload;

            const parsed = VaultPayloadSchema.safeParse(req.body);
            if (!parsed.success) {
                return reply.status(400).send({
                    message: "Payload invalide.",
                    errors:  parsed.error.flatten(),
                });
            }

            const { ciphertext, iv, baseVersion } = parsed.data;

            // Écriture conditionnelle atomique : elle ne passe que si personne
            // n'a sauvegardé depuis la version dont part le client.
            const { count } = await prisma.user.updateMany({
                where: { id: userId, vaultVersion: baseVersion },
                data:  {
                    vaultData:    ciphertext,
                    vaultIv:      iv,
                    vaultVersion: { increment: 1 },
                },
            });

            if (count === 0) {
                const current = await prisma.user.findUnique({
                    where:  { id: userId },
                    select: { vaultVersion: true },
                });
                if (!current) {
                    return reply.status(404).send({ message: "Utilisateur introuvable." });
                }
                return reply.status(409).send({ message: VAULT_CONFLICT_MESSAGE, version: current.vaultVersion });
            }

            return reply.status(200).send({ message: "Vault sauvegardé.", version: baseVersion + 1 });
        }
    );

    // ── DELETE /api/vault ───────────────────────────────────
    // Supprime définitivement le vault et le compte utilisateur.
    // Action irréversible - zero-knowledge oblige, impossible de récupérer.
    // Exige une re-preuve du mot de passe maître (authKeyHex), au même titre
    // que /change-password : un JWT volé (15 min de durée de vie) ne doit
    // jamais suffire à lui seul pour une action aussi destructrice.

    app.delete(
        "/",
        { preHandler: [requireAuth] },
        async (req: FastifyRequest, reply: FastifyReply) => {
            const { sub: userId } = req.user as JwtPayload;

            const parsed = DeleteAccountSchema.safeParse(req.body);
            if (!parsed.success) {
                return reply.status(400).send({ message: "Données invalides." });
            }
            const { authKeyHex } = parsed.data;

            const user = await prisma.user.findUnique({ where: { id: userId } });
            if (!user) {
                return reply.status(404).send({ message: "Utilisateur introuvable." });
            }

            if (user.lockedUntil && user.lockedUntil > new Date()) {
                const retryAfter = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 1000);
                return reply
                    .status(429)
                    .header("Retry-After", String(retryAfter))
                    .send({ message: `Compte bloqué. Réessayez dans ${retryAfter}s.` });
            }

            const isValid = await bcrypt.compare(authKeyHex, user.authKeyHash);
            if (!isValid) {
                const failedAttempts = user.failedAttempts + 1;
                const justLocked     = failedAttempts >= MAX_FAILED_ATTEMPTS;
                await prisma.user.update({
                    where: { id: userId },
                    data: {
                        failedAttempts,
                        ...(justLocked && {
                            lockedUntil: new Date(Date.now() + LOCKOUT_DURATION_MS),
                        }),
                    },
                });
                await logAudit(userId, "ACCOUNT_DELETE_FAILED", req, { failedAttempts });
                if (justLocked) {
                    await sendAccountLockedEmail(user.email, { ipAddress: getIp(req), userAgent: getUserAgent(req) });
                }
                return reply.status(401).send({ message: "Mot de passe incorrect." });
            }

            // Pas de logAudit("ACCOUNT_DELETED", ...) ici : AuditLog a
            // onDelete: Cascade sur User, l'entrée serait supprimée dans le
            // même instant que le compte - elle n'apporterait aucune trace.
            await prisma.user.delete({ where: { id: userId } });

            // Suppression du cookie de refresh token
            reply.clearCookie("aegis_rt", {
                httpOnly: true,
                secure:   process.env.NODE_ENV === "production",
                sameSite: "strict",
                path:     "/api/auth",
            });

            return reply.send({ message: "Compte et vault supprimés définitivement." });
        }
    );
}
