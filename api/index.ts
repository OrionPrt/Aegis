/**
 * ╔═══════════════════════════════════════════════════════╗
 * ║         AEGIS - Fonction serverless Vercel            ║
 * ║              api/index.ts                             ║
 * ╚═══════════════════════════════════════════════════════╝
 *
 * Toutes les requêtes /api/* (voir vercel.json → rewrites) arrivent ici.
 * On construit l'app Fastify une seule fois par instance de fonction
 * ("warm start") et on lui délègue chaque requête HTTP brute.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../backend/src/server/build-app.js";

let appPromise: Promise<FastifyInstance> | null = null;

async function getApp(): Promise<FastifyInstance> {
    if (!appPromise) {
        appPromise = buildApp().then(async (app) => {
            await app.ready();
            return app;
        });
    }
    return appPromise;
}

export default async function handler(
    req: IncomingMessage,
    res: ServerResponse
): Promise<void> {
    const app = await getApp();
    app.server.emit("request", req, res);
}
