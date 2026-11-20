/**
 * ╔═══════════════════════════════════════════════════════╗
 * ║         AEGIS - Vérification de la configuration      ║
 * ║         src/server/lib/env.ts                         ║
 * ╚═══════════════════════════════════════════════════════╝
 *
 * Appelée au démarrage par buildApp() : une variable indispensable absente
 * arrête l'application tout de suite, avec un message clair, plutôt qu'à la
 * première requête qui en aurait besoin.
 */

/** Longueur minimale recommandée d'un secret HS256 (256 bits). */
const MIN_JWT_SECRET_LENGTH = 32;

/**
 * Lève une erreur si une variable indispensable manque ; retourne les
 * avertissements (configuration fonctionnelle mais faible).
 */
export function checkEnvironment(env: NodeJS.ProcessEnv = process.env): string[] {
    if (!env.JWT_SECRET) {
        throw new Error("JWT_SECRET est requis : il signe les access tokens.");
    }
    if (env.NODE_ENV === "production" && !env.DATABASE_URL) {
        throw new Error("DATABASE_URL est requis en production.");
    }
    if (env.NODE_ENV === "production" && !env.APP_URL && !env.VERCEL_PROJECT_PRODUCTION_URL) {
        throw new Error("APP_URL est requis en production : il sert aux liens des emails de confirmation.");
    }

    const warnings: string[] = [];
    if (env.NODE_ENV === "production" && !env.CRON_SECRET) {
        warnings.push("CRON_SECRET n'est pas défini : la purge planifiée des données expirées (/api/cron/purge) refusera de tourner.");
    }
    if (env.JWT_SECRET.length < MIN_JWT_SECRET_LENGTH) {
        warnings.push(`JWT_SECRET fait moins de ${MIN_JWT_SECRET_LENGTH} caractères : utilisez un secret aléatoire plus long.`);
    }
    return warnings;
}
