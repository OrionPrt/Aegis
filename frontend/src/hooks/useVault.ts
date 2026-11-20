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
 *
 * Chaque sauvegarde envoie la version du coffre dont elle part : si un autre
 * appareil a sauvegardé entre-temps, le serveur refuse (409) et le hook
 * recharge la dernière version au lieu d'écraser ses changements. Les
 * sauvegardes de cet onglet passent une par une, chacune partant de la
 * version produite par la précédente.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { encryptVault, decryptVault } from "../lib/crypto";
import { apiFetch, getSession, AuthError } from "../lib/auth-client";
import type { AuthSession } from "../lib/auth-client";
import type { VaultEntry } from "../lib/crypto";

// ─────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────

export type VaultStatus = "idle" | "loading" | "ready" | "saving" | "error";

export interface UseVaultReturn {
    entries:     VaultEntry[];
    status:      VaultStatus;
    error:       string | null;
    /** Version serveur du coffre actuellement affiché. */
    version:     number;
    saveVault:   (updated: VaultEntry[]) => Promise<void>;
}

interface VaultResponse {
    vault:   { ciphertext: string; iv: string } | null;
    version: number;
}

interface SaveResponse {
    version: number;
}

export const VAULT_CONFLICT_MESSAGE =
    "Le coffre a été modifié sur un autre appareil : la dernière version vient d'être rechargée. Refaites votre modification.";

const HTTP_CONFLICT = 409;

/** Levée par saveVault quand le coffre a changé ailleurs (le hook l'a déjà rechargé). */
export class VaultConflictError extends Error {
    constructor() {
        super(VAULT_CONFLICT_MESSAGE);
        this.name = "VaultConflictError";
    }
}

/** Télécharge et déchiffre le coffre courant. */
async function fetchVault(session: AuthSession): Promise<{ entries: VaultEntry[]; version: number }> {
    const response = await apiFetch("/vault") as VaultResponse;
    const entries = response.vault
        ? await decryptVault(response.vault, session.keys.masterKey)
        : [];
    return { entries, version: response.version };
}

function errorMessage(err: unknown, fallback: string): string {
    return err instanceof Error ? err.message : fallback;
}

// ─────────────────────────────────────────────────────────
// HOOK
// ─────────────────────────────────────────────────────────

export function useVault(): UseVaultReturn {
    const [entries, setEntries] = useState<VaultEntry[]>([]);
    const [status,  setStatus]  = useState<VaultStatus>("idle");
    const [error,   setError]   = useState<string | null>(null);
    const [version, setVersion] = useState(0);

    // Lue par les sauvegardes en file : un état React serait figé dans la
    // closure de l'appel, pas la version produite par la sauvegarde précédente.
    const versionRef = useRef(0);
    const saveQueue  = useRef<Promise<unknown>>(Promise.resolve());

    const applyVersion = useCallback((next: number) => {
        versionRef.current = next;
        setVersion(next);
    }, []);

    // ── Chargement initial du vault ─────────────────────────

    useEffect(() => {
        let cancelled = false;

        async function loadVault() {
            const session = getSession();
            if (!session) return;

            setStatus("loading");
            setError(null);

            try {
                const loaded = await fetchVault(session);
                if (cancelled) return;
                applyVersion(loaded.version);
                setEntries(loaded.entries);
                setStatus("ready");
            } catch (err) {
                if (!cancelled) {
                    setError(errorMessage(err, "Erreur de chargement."));
                    setStatus("error");
                }
            }
        }

        loadVault();
        return () => { cancelled = true; };
    }, [applyVersion]);

    // ── Sauvegarde du vault ─────────────────────────────────

    const reloadAfterConflict = useCallback(async (session: AuthSession) => {
        try {
            const latest = await fetchVault(session);
            applyVersion(latest.version);
            setEntries(latest.entries);
            setError(VAULT_CONFLICT_MESSAGE);
            setStatus("ready");
        } catch (err) {
            setError(errorMessage(err, "Erreur de chargement."));
            setStatus("error");
        }
    }, [applyVersion]);

    const persist = useCallback(async (updated: VaultEntry[]) => {
        const session = getSession();
        if (!session) throw new Error("Session expirée.");

        setStatus("saving");
        setError(null);

        try {
            const payload = await encryptVault(updated, session.keys.masterKey);
            const saved = await apiFetch("/vault", {
                method: "PUT",
                body:   JSON.stringify({ ...payload, baseVersion: versionRef.current }),
            }) as SaveResponse;

            applyVersion(saved.version);
            setEntries(updated);
            setStatus("ready");
        } catch (err) {
            if (err instanceof AuthError && err.status === HTTP_CONFLICT) {
                await reloadAfterConflict(session);
                throw new VaultConflictError();
            }
            setError(errorMessage(err, "Erreur de sauvegarde."));
            setStatus("error");
            throw err;
        }
    }, [applyVersion, reloadAfterConflict]);

    const saveVault = useCallback((updated: VaultEntry[]) => {
        // Une sauvegarde échouée ne bloque pas les suivantes.
        const run = saveQueue.current.catch(() => undefined).then(() => persist(updated));
        saveQueue.current = run;
        return run;
    }, [persist]);

    return { entries, status, error, version, saveVault };
}
