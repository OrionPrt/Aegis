/**
 * ╔═══════════════════════════════════════════════════════╗
 * ║         AEGIS — Route /vault                          ║
 * ║         src/server/routes/vault.ts                    ║
 * ╚═══════════════════════════════════════════════════════╝
 *
 * Le serveur ne voit que du ciphertext — jamais de données en clair.
 *
 * GET  /api/vault  → retourne { ciphertext, iv } du vault
 * PUT  /api/vault  → remplace le vault chiffré
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "./auth.js";

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
        .max(10 * 1024 * 1024) // 10 MB max — protection contre les abus
        .regex(/^[A-Za-z0-9+/=]+$/, "ciphertext must be base64"),

    // iv : vecteur d'initialisation AES-GCM (12 bytes → 16 chars base64)
    iv: z
        .string()
        .length(16)
        .regex(/^[A-Za-z0-9+/=]+$/, "iv must be base64"),
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
                select: { vaultData: true, vaultIv: true, updatedAt: true },
            });

            if (!user) {
                return reply.status(404).send({ message: "Utilisateur introuvable." });
            }

            // Vault vide — premier accès après inscription
            if (!user.vaultData || !user.vaultIv) {
                return reply.status(200).send({ vault: null });
            }

            return reply.send({
                vault: {
                    ciphertext: user.vaultData,
                    iv:         user.vaultIv,
                },
                updatedAt: user.updatedAt.getTime(),
            });
        }
    );

    // ── PUT /api/vault ──────────────────────────────────────
    // Remplace intégralement le vault chiffré.
    // Le serveur ne valide que la structure — jamais le contenu.

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

            const { ciphertext, iv } = parsed.data;

            // Vérification que l'utilisateur existe toujours
            const user = await prisma.user.findUnique({
                where:  { id: userId },
                select: { id: true },
            });

            if (!user) {
                return reply.status(404).send({ message: "Utilisateur introuvable." });
            }

            await prisma.user.update({
                where: { id: userId },
                data:  {
                    vaultData: ciphertext,
                    vaultIv:   iv,
                    updatedAt: new Date(),
                },
            });

            return reply.status(200).send({ message: "Vault sauvegardé." });
        }
    );

    // ── DELETE /api/vault ───────────────────────────────────
    // Supprime définitivement le vault et le compte utilisateur.
    // Action irréversible — zero-knowledge oblige, impossible de récupérer.

    app.delete(
        "/",
        { preHandler: [requireAuth] },
        async (req: FastifyRequest, reply: FastifyReply) => {
            const { sub: userId } = req.user as JwtPayload;

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
