/**
 * ╔═══════════════════════════════════════════════════════╗
 * ║         AEGIS - Lancement local (dev / hors Vercel)   ║
 * ║           src/server/app.ts                           ║
 * ╚═══════════════════════════════════════════════════════╝
 *
 * Utilisé uniquement pour faire tourner un vrai process qui écoute un
 * port (dev local avec `npm run dev`, ou un hébergeur non-serverless).
 * Sur Vercel, c'est api/index.ts qui sert l'app construite par
 * buildApp(), sans jamais appeler .listen().
 */

import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { buildApp } from "./build-app.js";

// Charge le .env à la racine du monorepo (absent en prod : Vercel injecte
// les variables d'environnement directement, sans passer par ce fichier).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(__dirname, "../../../.env") });

try {
    const app = await buildApp();
    await app.listen({ port: parseInt(process.env.PORT ?? "3000"), host: "0.0.0.0" });
    console.log("🛡️  Aegis server running on port 3000");
} catch (err) {
    console.error(err);
    process.exit(1);
}
