import { LayoutGrid, KeyRound, CreditCard, StickyNote } from "lucide-react";
import { formatExpiry, last4 } from "../../lib/card";
import type { VaultFolder } from "../../lib/vault-format";
import type { Category, VaultEntryExtended, VaultView } from "./types";

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

/**
 * Libellés de la barre d'onglets mobile, où cinq onglets se partagent la
 * largeur : un libellé trop long y passerait sur deux lignes.
 */
export const MOBILE_CATEGORY_LABELS: Partial<Record<Category, string>> = {
    all: "Tous",
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

/** Titre de la liste pour une vue (résolue : son dossier existe). */
export function viewTitle(view: VaultView, folders: readonly VaultFolder[]): string {
    if (view.kind === "category") return CATEGORY_LABELS[view.category];
    return folders.find((f) => f.id === view.folderId)?.name ?? CATEGORY_LABELS.all;
}

function matchesView(entry: VaultEntryExtended, view: VaultView): boolean {
    if (view.kind === "folder") return entry.folderId === view.folderId;
    return view.category === "all" || entry.category === view.category;
}

/**
 * Filtre les entrées par vue (catégorie ou dossier) et par recherche (nom,
 * identifiant, URL, tags, carte) : dans un dossier, on ne cherche que dans lui.
 */
export function filterEntries(
    entries: VaultEntryExtended[],
    view: VaultView,
    search: string,
): VaultEntryExtended[] {
    const q = search.toLowerCase();
    return entries.filter((e) => {
        const matchView = matchesView(e, view);
        const matchSearch =
            !q ||
            e.label.toLowerCase().includes(q) ||
            e.username?.toLowerCase().includes(q) ||
            e.url?.toLowerCase().includes(q) ||
            e.tags?.some((t) => t.toLowerCase().includes(q)) ||
            e.cardholder?.toLowerCase().includes(q) ||
            e.cardBank?.toLowerCase().includes(q) ||
            last4(e.cardNumber ?? "").includes(q);
        return matchView && matchSearch;
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
