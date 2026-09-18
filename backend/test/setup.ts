/**
 * Chargé automatiquement par vitest (voir vitest.config.ts, setupFiles)
 * avant tout fichier de test. Fixe des secrets par défaut pour que les
 * tests n'aient pas besoin d'un .env - DATABASE_URL/DIRECT_URL restent
 * requis explicitement pour les tests d'intégration (voir test/helpers.ts).
 */
process.env.JWT_SECRET    ??= "test-jwt-secret-not-for-production";
process.env.COOKIE_SECRET ??= "test-cookie-secret-not-for-production";
process.env.RESEND_API_KEY ??= "";
process.env.NODE_ENV      ??= "test";
