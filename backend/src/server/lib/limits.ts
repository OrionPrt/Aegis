/**
 * ╔═══════════════════════════════════════════════════════╗
 * ║         AEGIS - Limites de taille des requêtes        ║
 * ║         src/server/lib/limits.ts                      ║
 * ╚═══════════════════════════════════════════════════════╝
 *
 * Les fonctions Vercel refusent tout corps de requête ou de réponse
 * au-delà de 4,5 Mo : le coffre chiffré (envoyé par PUT /api/vault et
 * /api/auth/change-password, renvoyé par GET /api/vault) doit tenir dessous.
 */

/** Taille maximale du ciphertext Base64 du coffre (4 Mio, ~3 Mio de données). */
export const MAX_VAULT_CIPHERTEXT_LENGTH = 4 * 1024 * 1024;

/**
 * bodyLimit Fastify des routes qui reçoivent le coffre : le ciphertext plus
 * une marge pour le reste du JSON (iv, clés d'authentification, version).
 * Fastify limite sinon tout corps à 1 Mio par défaut.
 */
export const VAULT_BODY_LIMIT = MAX_VAULT_CIPHERTEXT_LENGTH + 16 * 1024;
