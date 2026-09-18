/**
 * Utilitaires partagés par les tests d'intégration (test/integration/*.test.ts).
 * Nécessite DATABASE_URL/DIRECT_URL pointant vers une base Postgres jetable
 * avec les migrations Prisma déjà appliquées (voir docs/testing.md).
 */
import crypto from "node:crypto";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { buildApp } from "../src/server/build-app.js";
import { prisma } from "../src/server/lib/prisma.js";

export async function buildTestApp(): Promise<FastifyInstance> {
    if (!process.env.DATABASE_URL) {
        throw new Error(
            "DATABASE_URL non défini - les tests d'intégration nécessitent une base " +
            "Postgres jetable avec les migrations appliquées. Voir docs/testing.md."
        );
    }
    const app = await buildApp();
    await app.ready();
    return app;
}

let counter = 0;

/** Génère un email unique par test pour éviter les collisions en base. */
export function uniqueEmail(prefix = "test"): string {
    counter += 1;
    return `${prefix}-${Date.now()}-${counter}@example.com`;
}

/**
 * 64 caractères hex - format attendu par les schémas Zod des routes auth/vault.
 * Dérivé de `seed` par sha256 (toujours hex valide, quel que soit le texte
 * lisible passé en graine - "wrong", "current1", etc.) ; même graine → même
 * clé (utile pour re-soumettre volontairement le même authKeyHex).
 */
export function fakeAuthKeyHex(seed = "default"): string {
    return crypto.createHash("sha256").update(seed).digest("hex");
}

/** Sel Base64 arbitraire valide - contenu non significatif pour les tests serveur. */
export function fakeSaltBase64(): string {
    return Buffer.from("x".repeat(32)).toString("base64");
}

export async function cleanupUser(email: string): Promise<void> {
    // onDelete: Cascade sur Session/AuditLog - une seule suppression suffit.
    await prisma.user.deleteMany({ where: { email } });
}

/** Lit la valeur d'un cookie posé par une réponse app.inject(). */
export function getCookie(res: LightMyRequestResponse, name: string): string | undefined {
    return res.cookies.find((c) => c.name === name)?.value;
}
