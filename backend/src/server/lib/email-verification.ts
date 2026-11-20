/**
 * ╔═══════════════════════════════════════════════════════╗
 * ║         AEGIS - Confirmation de l'adresse email       ║
 * ║         src/server/lib/email-verification.ts          ║
 * ╚═══════════════════════════════════════════════════════╝
 *
 * L'inscription envoie un lien à usage unique : tant qu'il n'est pas ouvert,
 * le compte ne peut pas se connecter. Seule l'empreinte sha256 du jeton est
 * stockée (User.emailVerificationTokenHash), comme un mot de passe.
 */
import crypto from "node:crypto";

export const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

const TOKEN_BYTES = 32;
const DEV_APP_URL = "http://localhost:5173";

export function hashVerificationToken(token: string): string {
    return crypto.createHash("sha256").update(token).digest("hex");
}

/** Nouveau jeton (à envoyer), son empreinte (à stocker) et son expiration. */
export function newVerificationToken(now = Date.now()): { token: string; tokenHash: string; expiresAt: Date } {
    const token = crypto.randomBytes(TOKEN_BYTES).toString("base64url");
    return { token, tokenHash: hashVerificationToken(token), expiresAt: new Date(now + EMAIL_VERIFICATION_TTL_MS) };
}

/**
 * Adresse publique du site, pour les liens des emails. Jamais déduite de la
 * requête : l'en-tête Host est fourni par le client, un lien construit avec
 * lui pourrait pointer vers un autre site. APP_URL, sinon le domaine de
 * production que Vercel fournit, sinon (hors production) le serveur Vite.
 */
export function appUrl(env: NodeJS.ProcessEnv = process.env): string {
    if (env.APP_URL) return env.APP_URL.replace(/\/+$/, "");
    if (env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`;
    if (env.NODE_ENV === "production") {
        throw new Error("APP_URL est requis en production pour les liens des emails.");
    }
    return DEV_APP_URL;
}

export function verificationLink(token: string): string {
    return `${appUrl()}/verify-email?token=${encodeURIComponent(token)}`;
}
