import { describe, it, expect } from "vitest";
import { countByCategory, entrySubtitle, filterEntries, getInitial, viewTitle } from "./format";
import type { Category, VaultEntryExtended, VaultView } from "./types";

function categoryView(category: Category): VaultView {
    return { kind: "category", category };
}

function entry(overrides: Partial<VaultEntryExtended>): VaultEntryExtended {
    return { id: "id", label: "Label", category: "login", createdAt: 0, updatedAt: 0, ...overrides };
}

const ENTRIES: VaultEntryExtended[] = [
    entry({ id: "1", label: "GitHub", username: "me@example.com", url: "https://github.com", tags: ["dev"], folderId: "f1" }),
    entry({ id: "2", label: "Visa", category: "card", cardNumber: "4111111111111111", cardholder: "JEAN DUPONT", cardBank: "BNP" }),
    entry({ id: "3", label: "Wifi", category: "note", notes: "Code du wifi\nligne 2", folderId: "f1" }),
];

describe("filterEntries", () => {
    it("returns every entry for the 'all' category and an empty search", () => {
        expect(filterEntries(ENTRIES, categoryView("all"), "")).toHaveLength(3);
    });

    it("keeps only the entries of the selected category", () => {
        expect(filterEntries(ENTRIES, categoryView("card"), "").map((e) => e.id)).toEqual(["2"]);
    });

    it("keeps every entry of the selected folder, whatever its category", () => {
        expect(filterEntries(ENTRIES, { kind: "folder", folderId: "f1" }, "").map((e) => e.id)).toEqual(["1", "3"]);
    });

    it("searches inside the selected folder only", () => {
        const folder: VaultView = { kind: "folder", folderId: "f1" };
        expect(filterEntries(ENTRIES, folder, "wifi").map((e) => e.id)).toEqual(["3"]);
        expect(filterEntries(ENTRIES, folder, "visa")).toEqual([]);
    });

    it("matches the search case-insensitively on label, username, url, tags, cardholder, bank and last 4 digits", () => {
        expect(filterEntries(ENTRIES, categoryView("all"), "GITHUB").map((e) => e.id)).toEqual(["1"]);
        expect(filterEntries(ENTRIES, categoryView("all"), "dev").map((e) => e.id)).toEqual(["1"]);
        expect(filterEntries(ENTRIES, categoryView("all"), "dupont").map((e) => e.id)).toEqual(["2"]);
        expect(filterEntries(ENTRIES, categoryView("all"), "bnp").map((e) => e.id)).toEqual(["2"]);
        expect(filterEntries(ENTRIES, categoryView("all"), "1111").map((e) => e.id)).toEqual(["2"]);
    });
});

describe("countByCategory", () => {
    it("counts entries per category", () => {
        expect(countByCategory(ENTRIES)).toEqual({ all: 3, login: 1, card: 1, note: 1 });
    });
});

describe("entrySubtitle / getInitial", () => {
    it("shows the masked last 4 digits for a card, the first line for a note, the username otherwise", () => {
        expect(entrySubtitle(ENTRIES[1])).toBe("•••• 1111");
        expect(entrySubtitle(ENTRIES[2])).toBe("Code du wifi");
        expect(entrySubtitle(ENTRIES[0])).toBe("me@example.com");
    });

    it("falls back to '?' for an empty label", () => {
        expect(getInitial(entry({ label: "  " }))).toBe("?");
        expect(getInitial(entry({ label: "github" }))).toBe("G");
    });
});

describe("viewTitle", () => {
    const folders = [{ id: "f1", name: "Perso", createdAt: 0, updatedAt: 0 }];

    it("shows the category label, or the name of the displayed folder", () => {
        expect(viewTitle(categoryView("card"), folders)).toBe("Cartes");
        expect(viewTitle({ kind: "folder", folderId: "f1" }, folders)).toBe("Perso");
    });
});
