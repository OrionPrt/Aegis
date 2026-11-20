/**
 * ╔═══════════════════════════════════════════════════════╗
 * ║         AEGIS - Version de dérivation de clé          ║
 * ║         src/server/lib/kdf.ts                         ║
 * ╚═══════════════════════════════════════════════════════╝
 *
 * Le serveur ne dérive rien : il mémorise, par compte, la version des
 * paramètres Argon2 avec laquelle le client a dérivé ses clés
 * (User.kdfVersion) et la renvoie avec le sel. Les paramètres eux-mêmes
 * sont dans frontend/src/lib/crypto.ts (KDF_PARAMS).
 *
 * Pour renforcer Argon2 : ajouter la version côté client, l'ajouter à
 * SUPPORTED_KDF_VERSIONS et y faire pointer CURRENT_KDF_VERSION, des deux
 * côtés. Les comptes existants gardent leur version.
 */
import { z } from "zod";

export const CURRENT_KDF_VERSION = 1;
export const SUPPORTED_KDF_VERSIONS: readonly number[] = [1];

export const KdfVersionSchema = z
    .number()
    .int()
    .refine((v) => SUPPORTED_KDF_VERSIONS.includes(v), "unsupported kdf version");
