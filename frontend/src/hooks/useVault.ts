/**
 * ╔═══════════════════════════════════════════════════════╗
 * ║         AEGIS - Hook useVault                         ║
 * ║         src/hooks/useVault.ts                         ║
 * ╚═══════════════════════════════════════════════════════╝
 *
 * Gère le cycle de vie complet du vault :
 *   1. Chargement du vault chiffré depuis le serveur
 *   2. Déchiffrement local avec la masterKey en mémoire
 *   3. Sauvegarde chiffrée après chaque modification
 */

import { useState, useEffect, useCallback } from "react";
import { encryptVault, decryptVault } from "../lib/crypto";
import { apiFetch, getSession } from "../lib/auth-client";
import type { VaultEntry } from "../lib/crypto";

// ─────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────

export type VaultStatus = "idle" | "loading" | "ready" | "saving" | "error";

export interface UseVaultReturn {
    entries:     VaultEntry[];
    status:      VaultStatus;
    error:       string | null;
    saveVault:   (updated: VaultEntry[]) => Promise<void>;
}

interface VaultResponse {
    vault: { ciphertext: string; iv: string } | null;
}

// ─────────────────────────────────────────────────────────
// HOOK
// ─────────────────────────────────────────────────────────

export function useVault(): UseVaultReturn {
    const [entries, setEntries] = useState<VaultEntry[]>([]);
    const [status,  setStatus]  = useState<VaultStatus>("idle");
    const [error,   setError]   = useState<string | null>(null);

    // ── Chargement initial du vault ─────────────────────────

    useEffect(() => {
        let cancelled = false;

        async function loadVault() {
            const session = getSession();
            if (!session) return;

            setStatus("loading");
            setError(null);

            try {
                const response = await apiFetch("/vault") as VaultResponse;

                if (cancelled) return;

                // Vault vide - nouvel utilisateur
                if (!response.vault) {
                    setEntries([]);
                    setStatus("ready");
                    return;
                }

                // Déchiffrement local - la masterKey ne quitte pas la mémoire
                const decrypted = await decryptVault(
                    response.vault,
                    session.keys.masterKey
                );

                if (!cancelled) {
                    setEntries(decrypted as VaultEntry[]);
                    setStatus("ready");
                }
            } catch (err) {
                if (!cancelled) {
                    const message = err instanceof Error ? err.message : "Erreur de chargement.";
                    setError(message);
                    setStatus("error");
                }
            }
        }

        loadVault();
        return () => { cancelled = true; };
    }, []);

    // ── Sauvegarde du vault ─────────────────────────────────

    const saveVault = useCallback(async (updated: VaultEntry[]) => {
        const session = getSession();
        if (!session) throw new Error("Session expirée.");

        setStatus("saving");
        setError(null);

        try {
            const payload = await encryptVault(updated, session.keys.masterKey);

            await apiFetch("/vault", {
                method: "PUT",
                body:   JSON.stringify(payload),
            });

            setEntries(updated);
            setStatus("ready");
        } catch (err) {
            const message = err instanceof Error ? err.message : "Erreur de sauvegarde.";
            setError(message);
            setStatus("error");
            throw err;
        }
    }, []);

    return { entries, status, error, saveVault };
}
