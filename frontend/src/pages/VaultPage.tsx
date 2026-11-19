/**
 * ╔═══════════════════════════════════════════════════════╗
 * ║           AEGIS — Interface du Vault (finale)         ║
 * ║           src/pages/VaultPage.tsx                     ║
 * ╚═══════════════════════════════════════════════════════╝
 *
 * Assemble la barre latérale, la liste des entrées, le panneau de détail et
 * les modales (sous-composants dans ./vault/). Ce composant possède l'état
 * de la page : entrée sélectionnée, filtre, recherche, modales ouvertes.
 */

import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AlertTriangle, Shield } from "lucide-react";
import { getSession, logout } from "../lib/auth-client";
import { useVault } from "../hooks/useVault";
import { moveEntry } from "../lib/reorder";
import type { DropPlacement } from "../lib/reorder";
import EntryDetail, { EmptyDetail } from "./vault/EntryDetail";
import EntryList from "./vault/EntryList";
import VaultSidebar from "./vault/VaultSidebar";
import VaultTopbar from "./vault/VaultTopbar";
import { countByCategory, filterEntries } from "./vault/format";
import ChangePasswordModal from "./vault/modals/ChangePasswordModal";
import ConfirmDeleteEntryModal from "./vault/modals/ConfirmDeleteEntryModal";
import DeleteAccountModal from "./vault/modals/DeleteAccountModal";
import EntryModal from "./vault/modals/EntryModal";
import PasswordGeneratorModal from "./vault/modals/PasswordGeneratorModal";
import type { Category, EntryCategory, EntryFormData, VaultEntryExtended } from "./vault/types";
import "./VaultPage.css";

/** Catégorie proposée par défaut à l'ajout, d'après le filtre affiché. */
function defaultCategoryFor(category: Category): EntryCategory {
    return category === "all" ? "login" : category;
}

/** Applique le formulaire du modal : modifie `editEntry`, ou ajoute une nouvelle entrée. */
function applyEntryForm(
    entries: VaultEntryExtended[],
    editEntry: VaultEntryExtended | null,
    data: EntryFormData,
): { updated: VaultEntryExtended[]; saved: VaultEntryExtended | null } {
    const now = Date.now();
    if (editEntry) {
        const updated = entries.map((e) =>
            e.id === editEntry.id ? { ...e, ...data, updatedAt: now } : e
        );
        return { updated, saved: updated.find((e) => e.id === editEntry.id) ?? null };
    }
    const newEntry: VaultEntryExtended = {
        ...data,
        id:        crypto.randomUUID(),
        createdAt: now,
        updatedAt: now,
    };
    return { updated: [...entries, newEntry], saved: newEntry };
}

export default function VaultPage() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();

    // ── Hook vault — chargement, chiffrement, sauvegarde ───
    const { entries, status, error: vaultError, saveVault } = useVault();
    const typedEntries = entries as VaultEntryExtended[];

    // ── État local UI ──────────────────────────────────────
    const [selected,     setSelected]     = useState<VaultEntryExtended | null>(null);
    // Change à chaque clic sur une entrée : le panneau de détail repart
    // masqué (mot de passe, notes), même en recliquant sur la même entrée.
    const [detailKey,    setDetailKey]    = useState(0);
    const [category,     setCategory]     = useState<Category>("all");
    // Préremplit la recherche si on arrive depuis l'audit de sécurité (?q=...)
    const [search,       setSearch]       = useState(() => searchParams.get("q") ?? "");

    const [showModal,    setShowModal]    = useState(false);
    const [showGenerator, setShowGenerator] = useState(false);
    const [editEntry,    setEditEntry]    = useState<VaultEntryExtended | null>(null);
    const [showConfirmDelete,        setShowConfirmDelete]        = useState(false);
    const [showConfirmDeleteAccount, setShowConfirmDeleteAccount] = useState(false);
    const [showChangePassword,       setShowChangePassword]       = useState(false);

    const saving  = status === "saving";
    const loading = status === "loading";

    const filtered = useMemo(() => filterEntries(typedEntries, category, search), [typedEntries, category, search]);
    const counts   = useMemo(() => countByCategory(typedEntries), [typedEntries]);

    // ── Actions ────────────────────────────────────────────

    function selectEntry(entry: VaultEntryExtended) {
        setSelected(entry);
        setDetailKey((k) => k + 1);
    }

    async function deleteEntry(id: string) {
        const updated = typedEntries.filter((e) => e.id !== id);
        await saveVault(updated);
        if (selected?.id === id) setSelected(null);
    }

    // Réordonne le vault en déplaçant `draggedEntryId` avant ou après `targetId`.
    // L'ordre du tableau est ce qui est persisté (chiffré) via saveVault -
    // c'est donc lui qui définit l'ordre d'affichage à la prochaine connexion.
    async function reorderEntries(draggedEntryId: string, targetId: string, placement?: DropPlacement) {
        const reordered = moveEntry(typedEntries, draggedEntryId, targetId, placement);
        if (reordered === typedEntries) return;
        await saveVault([...reordered]);
    }

    async function saveEntryForm(data: EntryFormData) {
        const { updated, saved } = applyEntryForm(typedEntries, editEntry, data);
        setSelected(saved);
        await saveVault(updated);
        setShowModal(false);
    }

    async function handleLogout() {
        await logout();
        navigate("/login");
    }

    function openEntryModal(entry: VaultEntryExtended | null) {
        setEditEntry(entry);
        setShowModal(true);
    }

    // ── État de chargement ─────────────────────────────────

    if (loading) {
        return (
            <div className="vault-loading">
                <Shield className="loading-mark" size={28} strokeWidth={1.75} />
                <p>Déchiffrement du vault…</p>
            </div>
        );
    }

    if (vaultError && status === "error") {
        return (
            <div className="vault-loading">
                <AlertTriangle className="loading-mark loading-mark-danger" size={28} strokeWidth={1.75} />
                <p className="loading-text-danger">{vaultError}</p>
                <button className="btn-primary" style={{ marginTop: "16px" }} onClick={() => window.location.reload()}>
                    Réessayer
                </button>
            </div>
        );
    }

    return (
        <div className="vault-layout">
            <VaultSidebar
                email={getSession()?.email}
                search={search}
                onSearchChange={setSearch}
                category={category}
                onCategoryChange={setCategory}
                counts={counts}
                onOpenGenerator={() => setShowGenerator(true)}
                onOpenSecurityAudit={() => navigate("/security")}
                onOpenSessions={() => navigate("/sessions")}
                onLogout={handleLogout}
                onChangePassword={() => setShowChangePassword(true)}
                onDeleteAccount={() => setShowConfirmDeleteAccount(true)}
            />

            <main className="vault-main">
                <VaultTopbar
                    category={category}
                    saving={saving}
                    hasError={!!vaultError}
                    search={search}
                    onSearchChange={setSearch}
                    onAdd={() => openEntryModal(null)}
                    onOpenGenerator={() => setShowGenerator(true)}
                    onOpenSecurityAudit={() => navigate("/security")}
                    onOpenSessions={() => navigate("/sessions")}
                    onLogout={handleLogout}
                />
                <EntryList
                    entries={filtered}
                    selectedId={selected?.id}
                    search={search}
                    saving={saving}
                    onSelect={selectEntry}
                    onReorder={(draggedEntryId, targetId, placement) => {
                        void reorderEntries(draggedEntryId, targetId, placement);
                    }}
                />
            </main>

            {selected ? (
                <EntryDetail
                    key={detailKey}
                    entry={selected}
                    saving={saving}
                    onBack={() => setSelected(null)}
                    onEdit={() => openEntryModal(selected)}
                    onDelete={() => setShowConfirmDelete(true)}
                />
            ) : (
                <EmptyDetail />
            )}

            {showModal && (
                <EntryModal
                    entry={editEntry}
                    defaultCategory={defaultCategoryFor(category)}
                    onClose={() => setShowModal(false)}
                    onSave={saveEntryForm}
                />
            )}

            {showChangePassword && (
                <ChangePasswordModal
                    vaultEntries={typedEntries}
                    onClose={() => setShowChangePassword(false)}
                    onSuccess={() => navigate("/login")}
                />
            )}

            {showGenerator && (
                <PasswordGeneratorModal onClose={() => setShowGenerator(false)} />
            )}

            {showConfirmDelete && selected && (
                <ConfirmDeleteEntryModal
                    label={selected.label}
                    onCancel={() => setShowConfirmDelete(false)}
                    onConfirm={async () => {
                        await deleteEntry(selected.id);
                        setShowConfirmDelete(false);
                    }}
                />
            )}

            {showConfirmDeleteAccount && (
                <DeleteAccountModal
                    onClose={() => setShowConfirmDeleteAccount(false)}
                    onDeleted={() => navigate("/login")}
                />
            )}
        </div>
    );
}
