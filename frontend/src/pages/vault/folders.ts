/**
 * Logique pure des dossiers du coffre (sans DOM ni React).
 *
 * Chaque fonction retourne un nouveau coffre, ou le coffre d'origine si rien
 * ne change : l'appelant ne sauvegarde alors rien. Les dossiers n'ont qu'un
 * niveau et une entrée est dans un dossier au plus (voir lib/vault-format.ts).
 */
import { withoutFolder } from "../../lib/vault-format";
import type { VaultData, VaultFolder } from "../../lib/vault-format";
import type { VaultEntry } from "../../lib/crypto";
import type { VaultView } from "./types";

/** Longueur maximale d'un nom de dossier, espaces de début et de fin retirés. */
export const MAX_FOLDER_NAME_LENGTH = 64;

/** Vue par défaut : toutes les entrées. */
export const ALL_ENTRIES_VIEW: VaultView = { kind: "category", category: "all" };

/**
 * Type de donnée posé sur le glisser d'une carte d'entrée : seuls les dossiers
 * l'acceptent comme dépôt, le réordonnancement de la liste ne le lit pas.
 */
export const ENTRY_DRAG_TYPE = "application/x-aegis-entry";

// Insensible à la casse et aux accents : « Été » et « ete » sont le même nom.
const folderNameCollator = new Intl.Collator("fr", { sensitivity: "base" });

// ─────────────────────────────────────────────────────────
// VALIDATION
// ─────────────────────────────────────────────────────────

/**
 * Premier problème du nom proposé, ou null s'il est valide.
 * @param renamedId - Dossier en cours de renommage : il peut garder son nom.
 */
export function validateFolderName(
    name: string,
    folders: readonly VaultFolder[],
    renamedId?: string,
): string | null {
    const trimmed = name.trim();
    if (!trimmed) return "Le nom du dossier est requis.";
    if (trimmed.length > MAX_FOLDER_NAME_LENGTH) {
        return `Le nom du dossier ne peut pas dépasser ${MAX_FOLDER_NAME_LENGTH} caractères.`;
    }
    const taken = folders.some(
        (f) => f.id !== renamedId && folderNameCollator.compare(f.name.trim(), trimmed) === 0,
    );
    return taken ? "Un dossier porte déjà ce nom." : null;
}

// ─────────────────────────────────────────────────────────
// MODIFICATIONS DU COFFRE
// ─────────────────────────────────────────────────────────

/** Ajoute un dossier (nom déjà validé par validateFolderName). */
export function createFolder(vault: VaultData, name: string): { vault: VaultData; folder: VaultFolder } {
    const now = Date.now();
    const folder: VaultFolder = { id: crypto.randomUUID(), name: name.trim(), createdAt: now, updatedAt: now };
    return { vault: { ...vault, folders: [...vault.folders, folder] }, folder };
}

/** Renomme un dossier (nom déjà validé par validateFolderName). */
export function renameFolder(vault: VaultData, folderId: string, name: string): VaultData {
    const trimmed = name.trim();
    const current = vault.folders.find((f) => f.id === folderId);
    if (!current || current.name === trimmed) return vault;

    const renamed: VaultFolder = { ...current, name: trimmed, updatedAt: Date.now() };
    return { ...vault, folders: vault.folders.map((f) => (f.id === folderId ? renamed : f)) };
}

/** Supprime un dossier : ses entrées restent dans le coffre, sans dossier. */
export function deleteFolder(vault: VaultData, folderId: string): VaultData {
    if (!vault.folders.some((f) => f.id === folderId)) return vault;
    return {
        folders: vault.folders.filter((f) => f.id !== folderId),
        entries: vault.entries.map((e) => (e.folderId === folderId ? withoutFolder(e) : e)),
    };
}

/**
 * Range une entrée dans un dossier, ou la sort de son dossier (folderId null).
 * La date de modification de l'entrée ne change pas : son contenu est le même.
 */
export function moveEntryToFolder(vault: VaultData, entryId: string, folderId: string | null): VaultData {
    const current = vault.entries.find((e) => e.id === entryId);
    if (!current || (current.folderId ?? null) === folderId) return vault;
    if (folderId !== null && !vault.folders.some((f) => f.id === folderId)) return vault;

    const moved = folderId === null ? withoutFolder(current) : { ...current, folderId };
    return { ...vault, entries: vault.entries.map((e) => (e.id === entryId ? moved : e)) };
}

// ─────────────────────────────────────────────────────────
// AFFICHAGE
// ─────────────────────────────────────────────────────────

/** Dossiers par ordre alphabétique (nouvelle liste). */
export function sortFolders(folders: readonly VaultFolder[]): VaultFolder[] {
    return [...folders].sort((a, b) => folderNameCollator.compare(a.name, b.name));
}

/** Nombre d'entrées par id de dossier (les dossiers vides sont absents). */
export function countByFolder(entries: readonly VaultEntry[]): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const { folderId } of entries) {
        if (folderId) counts[folderId] = (counts[folderId] ?? 0) + 1;
    }
    return counts;
}

/**
 * Vue réellement affichée : celle d'un dossier qui n'existe plus (supprimé
 * ici ou sur un autre appareil) retombe sur toutes les entrées.
 */
export function resolveView(view: VaultView, folders: readonly VaultFolder[]): VaultView {
    if (view.kind === "folder" && !folders.some((f) => f.id === view.folderId)) return ALL_ENTRIES_VIEW;
    return view;
}
