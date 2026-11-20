import { describe, it, expect } from "vitest";
import type { VaultEntry } from "../../lib/crypto";
import type { VaultData, VaultFolder } from "../../lib/vault-format";
import {
    ALL_ENTRIES_VIEW,
    MAX_FOLDER_NAME_LENGTH,
    countByFolder,
    createFolder,
    deleteFolder,
    moveEntryToFolder,
    renameFolder,
    resolveView,
    sortFolders,
    validateFolderName,
} from "./folders";

function folder(id: string, name = id): VaultFolder {
    return { id, name, createdAt: 1, updatedAt: 1 };
}

function entry(id: string, folderId?: string): VaultEntry {
    return { id, label: id, createdAt: 1, updatedAt: 1, ...(folderId ? { folderId } : {}) };
}

const PERSO = folder("f1", "Perso");
const TRAVAIL = folder("f2", "Travail");

const VAULT: VaultData = {
    entries: [entry("a", "f1"), entry("b", "f2"), entry("c")],
    folders: [PERSO, TRAVAIL],
};

describe("validateFolderName", () => {
    it("accepts a new name", () => {
        expect(validateFolderName("Banque", VAULT.folders)).toBeNull();
    });

    it("refuses an empty or blank name", () => {
        expect(validateFolderName("   ", VAULT.folders)).toBe("Le nom du dossier est requis.");
    });

    it("refuses a name longer than the limit once trimmed", () => {
        const tooLong = "x".repeat(MAX_FOLDER_NAME_LENGTH + 1);
        expect(validateFolderName(`  ${"x".repeat(MAX_FOLDER_NAME_LENGTH)}  `, VAULT.folders)).toBeNull();
        expect(validateFolderName(tooLong, VAULT.folders)).toBe(
            `Le nom du dossier ne peut pas dépasser ${MAX_FOLDER_NAME_LENGTH} caractères.`,
        );
    });

    it("refuses a name already used, ignoring case, accents and surrounding spaces", () => {
        const folders = [folder("f1", "Été")];
        expect(validateFolderName(" ete ", folders)).toBe("Un dossier porte déjà ce nom.");
    });

    it("lets a folder keep its own name when renaming it", () => {
        expect(validateFolderName("perso", VAULT.folders, "f1")).toBeNull();
        expect(validateFolderName("perso", VAULT.folders, "f2")).toBe("Un dossier porte déjà ce nom.");
    });
});

describe("createFolder", () => {
    it("adds a folder with the trimmed name and leaves the entries untouched", () => {
        const { vault, folder: created } = createFolder(VAULT, "  Banque  ");

        expect(created).toEqual({ id: expect.any(String), name: "Banque", createdAt: expect.any(Number), updatedAt: created.createdAt });
        expect(vault.folders).toEqual([PERSO, TRAVAIL, created]);
        expect(vault.entries).toBe(VAULT.entries);
        expect(VAULT.folders).toHaveLength(2);
    });

    it("never creates a folder inside another one (a folder has no parent)", () => {
        const { folder: created } = createFolder(VAULT, "Banque");
        expect(Object.keys(created).sort()).toEqual(["createdAt", "id", "name", "updatedAt"]);
    });
});

describe("renameFolder", () => {
    it("renames the folder with the trimmed name", () => {
        const vault = renameFolder(VAULT, "f1", " Famille ");

        expect(vault.folders[0]).toMatchObject({ id: "f1", name: "Famille" });
        expect(vault.folders[1]).toBe(TRAVAIL);
        expect(PERSO.name).toBe("Perso");
    });

    it("returns the same vault when the folder is unknown or the name unchanged", () => {
        expect(renameFolder(VAULT, "missing", "X")).toBe(VAULT);
        expect(renameFolder(VAULT, "f1", " Perso ")).toBe(VAULT);
    });
});

describe("deleteFolder", () => {
    it("removes the folder and puts its entries back without a folder, deleting none", () => {
        const vault = deleteFolder(VAULT, "f1");

        expect(vault.folders).toEqual([TRAVAIL]);
        expect(vault.entries.map((e) => e.id)).toEqual(["a", "b", "c"]);
        expect(vault.entries[0]).not.toHaveProperty("folderId");
        expect(vault.entries[1]).toBe(VAULT.entries[1]);
        expect(VAULT.entries[0].folderId).toBe("f1");
    });

    it("returns the same vault when the folder is unknown", () => {
        expect(deleteFolder(VAULT, "missing")).toBe(VAULT);
    });
});

describe("moveEntryToFolder", () => {
    it("moves an entry into a folder", () => {
        const vault = moveEntryToFolder(VAULT, "c", "f2");

        expect(vault.entries[2].folderId).toBe("f2");
        expect(vault.folders).toBe(VAULT.folders);
        expect(VAULT.entries[2]).not.toHaveProperty("folderId");
    });

    it("takes an entry out of its folder", () => {
        const vault = moveEntryToFolder(VAULT, "a", null);
        expect(vault.entries[0]).not.toHaveProperty("folderId");
    });

    it("returns the same vault when nothing would change or the target does not exist", () => {
        expect(moveEntryToFolder(VAULT, "a", "f1")).toBe(VAULT);
        expect(moveEntryToFolder(VAULT, "c", null)).toBe(VAULT);
        expect(moveEntryToFolder(VAULT, "missing", "f1")).toBe(VAULT);
        expect(moveEntryToFolder(VAULT, "c", "missing")).toBe(VAULT);
    });
});

describe("sortFolders / countByFolder", () => {
    it("sorts folders alphabetically in French without changing the original list", () => {
        const folders = [folder("1", "zèbre"), folder("2", "Été"), folder("3", "avion")];

        expect(sortFolders(folders).map((f) => f.name)).toEqual(["avion", "Été", "zèbre"]);
        expect(folders.map((f) => f.name)).toEqual(["zèbre", "Été", "avion"]);
    });

    it("counts the entries of each folder", () => {
        expect(countByFolder([...VAULT.entries, entry("d", "f1")])).toEqual({ f1: 2, f2: 1 });
    });
});

describe("resolveView", () => {
    it("keeps a category view and the view of an existing folder", () => {
        expect(resolveView({ kind: "category", category: "card" }, VAULT.folders)).toEqual({ kind: "category", category: "card" });
        expect(resolveView({ kind: "folder", folderId: "f2" }, VAULT.folders)).toEqual({ kind: "folder", folderId: "f2" });
    });

    it("falls back to every entry when the displayed folder no longer exists", () => {
        expect(resolveView({ kind: "folder", folderId: "gone" }, VAULT.folders)).toBe(ALL_ENTRIES_VIEW);
    });
});
