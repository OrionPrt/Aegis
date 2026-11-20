/**
 * ╔═══════════════════════════════════════════════════════╗
 * ║         AEGIS — Format du coffre déchiffré            ║
 * ║         src/lib/vault-format.ts                       ║
 * ╚═══════════════════════════════════════════════════════╝
 *
 * Ce que contient le blob une fois déchiffré (voir crypto.ts) :
 *
 *   v1 : [ ...entrées ]                          (coffres d'avant les dossiers)
 *   v2 : { format: 2, entries: [...], folders: [...] }
 *
 * Le v1 reste lisible ; toute sauvegarde écrit le v2. Les dossiers vivent
 * dans le blob chiffré : le serveur ne voit ni leur nom ni leur contenu.
 * Ils n'ont qu'un niveau : un dossier n'a pas de parent, et la lecture ne
 * garde que ses champs connus.
 */

import type { VaultEntry } from "./crypto";

// ─────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────

export interface VaultFolder {
    id: string;
    name: string;
    createdAt: number;
    updatedAt: number;
}

/** Contenu complet du coffre : c'est lui qui est chiffré et sauvegardé. */
export interface VaultData {
    entries: VaultEntry[];
    folders: VaultFolder[];
}

// ─────────────────────────────────────────────────────────
// CONSTANTES
// ─────────────────────────────────────────────────────────

/**
 * Version écrite par cette application. La lecture ne garde que les champs
 * connus : tout nouveau champ du coffre impose d'incrémenter cette version,
 * sinon une version antérieure de l'application l'effacerait en sauvegardant.
 */
export const VAULT_FORMAT_VERSION = 2;

export const EMPTY_VAULT: VaultData = { entries: [], folders: [] };

export const UNKNOWN_VAULT_FORMAT_MESSAGE =
    "Format de coffre non reconnu : rechargez l'application.";

// ─────────────────────────────────────────────────────────
// LECTURE
// ─────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Dossier bien formé, réduit à ses champs connus ; null sinon. */
function toFolder(value: unknown): VaultFolder | null {
    if (!isRecord(value)) return null;
    const { id, name, createdAt, updatedAt } = value;
    if (typeof id !== "string" || !id) return null;
    if (typeof name !== "string") return null;
    if (typeof createdAt !== "number" || typeof updatedAt !== "number") return null;
    return { id, name, createdAt, updatedAt };
}

/**
 * Dossiers lisibles, sans doublon d'id. Un dossier illisible est ignoré
 * plutôt que de rendre tout le coffre inaccessible : ses entrées repassent
 * simplement sans dossier.
 */
function parseFolders(values: unknown[]): VaultFolder[] {
    const seen = new Set<string>();
    const folders: VaultFolder[] = [];
    for (const value of values) {
        const folder = toFolder(value);
        if (!folder || seen.has(folder.id)) continue;
        seen.add(folder.id);
        folders.push(folder);
    }
    return folders;
}

/** Retire le dossier d'une entrée s'il n'existe pas (ou plus). */
function withExistingFolder(entry: VaultEntry, folderIds: ReadonlySet<string>): VaultEntry {
    if (entry.folderId === undefined || folderIds.has(entry.folderId)) return entry;
    const copy = { ...entry };
    delete copy.folderId;
    return copy;
}

function parseJson(plaintext: string): unknown {
    try {
        return JSON.parse(plaintext);
    } catch {
        throw new Error(UNKNOWN_VAULT_FORMAT_MESSAGE);
    }
}

/**
 * Lit le texte déchiffré du coffre, quel que soit son format.
 * @throws si le format n'est pas reconnu (coffre écrit par une version plus
 *         récente de l'application, par exemple) : mieux vaut ne rien
 *         afficher que risquer de sauvegarder un coffre tronqué.
 */
export function parseVaultPlaintext(plaintext: string): VaultData {
    const parsed = parseJson(plaintext);

    if (Array.isArray(parsed)) {
        return { entries: parsed as VaultEntry[], folders: [] };
    }

    if (
        !isRecord(parsed) ||
        parsed.format !== VAULT_FORMAT_VERSION ||
        !Array.isArray(parsed.entries) ||
        !Array.isArray(parsed.folders)
    ) {
        throw new Error(UNKNOWN_VAULT_FORMAT_MESSAGE);
    }

    const folders   = parseFolders(parsed.folders);
    const folderIds = new Set(folders.map((f) => f.id));
    // Un élément qui n'est pas un objet ne porte aucune donnée d'entrée :
    // on l'écarte plutôt que de bloquer l'accès au coffre.
    const entries   = parsed.entries
        .filter(isRecord)
        .map((e) => withExistingFolder(e as unknown as VaultEntry, folderIds));
    return { entries, folders };
}

// ─────────────────────────────────────────────────────────
// ÉCRITURE
// ─────────────────────────────────────────────────────────

/** Texte à chiffrer, toujours au format courant. */
export function serializeVault(data: VaultData): string {
    return JSON.stringify({
        format:  VAULT_FORMAT_VERSION,
        entries: data.entries,
        folders: data.folders,
    });
}
