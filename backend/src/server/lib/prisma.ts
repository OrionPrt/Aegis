/**
 * ╔═══════════════════════════════════════════════════════╗
 * ║         AEGIS — Client Prisma partagé                 ║
 * ║         src/server/lib/prisma.ts                      ║
 * ╚═══════════════════════════════════════════════════════╝
 *
 * En environnement serverless (Vercel), une instance de fonction peut
 * être réutilisée entre plusieurs invocations ("warm start"). Si chaque
 * fichier de routes crée son propre `new PrismaClient()`, on ouvre de
 * nouvelles connexions Postgres à chaque invocation "froide" sans jamais
 * les fermer proprement, ce qui épuise vite le pool de connexions.
 *
 * Solution : une seule instance, mise en cache sur `globalThis`, réutilisée
 * tant que l'instance de fonction reste chaude.
 */

import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
    prisma?: PrismaClient;
};

export const prisma: PrismaClient = globalForPrisma.prisma ?? new PrismaClient();

// En dev (tsx watch recharge le module), on garde aussi l'instance en cache
// pour éviter "too many clients" au hot-reload.
if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = prisma;
}
