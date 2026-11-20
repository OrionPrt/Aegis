import { describe, it, expect } from "vitest";
import {
    EMPTY_VAULT,
    UNKNOWN_VAULT_FORMAT_MESSAGE,
    VAULT_FORMAT_VERSION,
    parseVaultPlaintext,
    serializeVault,
    type VaultData,
    type VaultFolder,
} from "./vault-format";
import type { VaultEntry } from "./crypto";

function entry(overrides: Partial<VaultEntry> = {}): VaultEntry {
    return { id: "e1", label: "GitHub", createdAt: 1, updatedAt: 1, ...overrides };
}

function folder(overrides: Partial<VaultFolder> = {}): VaultFolder {
    return { id: "f1", name: "Perso", createdAt: 1, updatedAt: 1, ...overrides };
}

function v2(body: Record<string, unknown>): string {
    return JSON.stringify({ format: VAULT_FORMAT_VERSION, ...body });
}

describe("parseVaultPlaintext", () => {
    it("reads a v1 vault (bare array of entries) as entries without folders", () => {
        const entries = [entry({ id: "a" }), entry({ id: "b" })];

        const vault = parseVaultPlaintext(JSON.stringify(entries));

        expect(vault).toEqual({ entries, folders: [] });
    });

    it("reads a v2 vault with its folders and the folder of each entry", () => {
        const data: VaultData = {
            entries: [entry({ id: "a", folderId: "f1" }), entry({ id: "b" })],
            folders: [folder({ id: "f1" })],
        };

        expect(parseVaultPlaintext(serializeVault(data))).toEqual(data);
    });

    it("removes the folder of an entry when that folder does not exist", () => {
        const plaintext = v2({ entries: [entry({ id: "a", folderId: "gone" })], folders: [] });

        const [parsed] = parseVaultPlaintext(plaintext).entries;

        expect(parsed).not.toHaveProperty("folderId");
        expect(parsed.id).toBe("a");
    });

    it("keeps only the known fields of a folder, so a parentId cannot nest folders", () => {
        const plaintext = v2({ entries: [], folders: [{ ...folder(), parentId: "f0", color: "red" }] });

        expect(parseVaultPlaintext(plaintext).folders).toEqual([folder()]);
    });

    it("drops malformed folders and duplicate folder ids instead of locking the vault", () => {
        const plaintext = v2({
            entries: [entry({ id: "a", folderId: "f1" })],
            folders: [
                folder({ id: "f1", name: "Perso" }),
                folder({ id: "f1", name: "Doublon" }),
                { id: "f2", name: 42, createdAt: 1, updatedAt: 1 },
                { id: "", name: "Sans id", createdAt: 1, updatedAt: 1 },
                null,
            ],
        });

        const vault = parseVaultPlaintext(plaintext);

        expect(vault.folders).toEqual([folder({ id: "f1", name: "Perso" })]);
        expect(vault.entries[0].folderId).toBe("f1");
    });

    it("ignores a v2 entry that is not an object instead of failing on it", () => {
        const plaintext = v2({ entries: [null, "x", entry({ id: "a" })], folders: [] });

        expect(parseVaultPlaintext(plaintext).entries).toEqual([entry({ id: "a" })]);
    });

    it.each([
        ["an unknown format version", JSON.stringify({ format: 99, entries: [], folders: [] })],
        ["a v2 vault without entries", v2({ folders: [] })],
        ["a v2 vault without folders", v2({ entries: [] })],
        ["a JSON value that is not a vault", JSON.stringify("hello")],
        ["text that is not JSON", "not json"],
    ])("refuses %s with an explicit message", (_case, plaintext) => {
        expect(() => parseVaultPlaintext(plaintext)).toThrow(UNKNOWN_VAULT_FORMAT_MESSAGE);
    });
});

describe("serializeVault", () => {
    it("always writes the current format, even for a vault without folders", () => {
        expect(JSON.parse(serializeVault(EMPTY_VAULT))).toEqual({
            format: VAULT_FORMAT_VERSION,
            entries: [],
            folders: [],
        });
    });
});
