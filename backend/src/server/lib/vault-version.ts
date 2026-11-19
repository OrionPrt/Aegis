/**
 * ╔═══════════════════════════════════════════════════════╗
 * ║         AEGIS - Version du coffre                     ║
 * ║         src/server/lib/vault-version.ts               ║
 * ╚═══════════════════════════════════════════════════════╝
 *
 * Chaque écriture du coffre (PUT /api/vault, /api/auth/change-password)
 * incrémente User.vaultVersion. Le client envoie la version dont il part :
 * si un autre appareil a sauvegardé entre-temps, l'écriture est refusée
 * (409) au lieu d'écraser ses changements.
 */
import { z } from "zod";

/** Version du coffre dont part un client (renvoyée par GET /api/vault). */
export const VaultVersionSchema = z.number().int().min(0);

/** Message de la réponse 409. */
export const VAULT_CONFLICT_MESSAGE =
    "Le coffre a été modifié sur un autre appareil. Rechargez-le avant de recommencer.";
