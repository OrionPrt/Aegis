import { LayoutGrid, KeyRound, CreditCard, StickyNote } from "lucide-react";
import { formatExpiry, last4 } from "../../lib/card";
import type { Category, VaultEntryExtended } from "./types";

export const CATEGORY_ICONS: Record<Category, typeof LayoutGrid> = {
    all:   LayoutGrid,
    login: KeyRound,
    card:  CreditCard,
    note:  StickyNote,
};

export const CATEGORY_LABELS: Record<Category, string> = {
    all:   "Tous les identifiants",
    login: "Connexions",
    card:  "Cartes",
    note:  "Notes",
};

export function getInitial(entry: VaultEntryExtended): string {
    return entry.label.trim().charAt(0).toUpperCase() || "?";
}

export function entrySubtitle(entry: VaultEntryExtended): string {
    if (entry.category === "card") {
        const l4  = last4(entry.cardNumber ?? "");
        const exp = entry.cardExpiry ? ` · ${formatExpiry(entry.cardExpiry)}` : "";
        return l4 ? `•••• ${l4}${exp}` : "Carte";
    }
    if (entry.category === "note") {
        return entry.notes?.split("\n")[0].slice(0, 48) || "Note vide";
    }
    return entry.username ?? "";
}

export function formatDate(ts: number, short = false): string {
    const d   = new Date(ts);
    const now = new Date();
    if (short) {
        const diff = now.getTime() - d.getTime();
        if (diff < 86_400_000)  return "Auj.";
        if (diff < 172_800_000) return "Hier";
    }
    return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

/** Filtre les entrées par catégorie et par recherche (nom, identifiant, URL, tags, carte). */
export function filterEntries(
    entries: VaultEntryExtended[],
    category: Category,
    search: string,
): VaultEntryExtended[] {
    const q = search.toLowerCase();
    return entries.filter((e) => {
        const matchCat = category === "all" || e.category === category;
        const matchSearch =
            !q ||
            e.label.toLowerCase().includes(q) ||
            e.username?.toLowerCase().includes(q) ||
            e.url?.toLowerCase().includes(q) ||
            e.tags?.some((t) => t.toLowerCase().includes(q)) ||
            e.cardholder?.toLowerCase().includes(q) ||
            e.cardBank?.toLowerCase().includes(q) ||
            last4(e.cardNumber ?? "").includes(q);
        return matchCat && matchSearch;
    });
}

/** Nombre d'entrées par catégorie, pour les compteurs de la barre latérale. */
export function countByCategory(entries: VaultEntryExtended[]): Record<Category, number> {
    return {
        all:   entries.length,
        login: entries.filter((e) => e.category === "login").length,
        card:  entries.filter((e) => e.category === "card").length,
        note:  entries.filter((e) => e.category === "note").length,
    };
}
