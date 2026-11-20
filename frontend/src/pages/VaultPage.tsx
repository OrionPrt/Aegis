/**
 * ╔═══════════════════════════════════════════════════════╗
 * ║           AEGIS — Interface du Vault (finale)         ║
 * ║           src/pages/VaultPage.tsx                     ║
 * ╚═══════════════════════════════════════════════════════╝
 *
 * Assemble la barre latérale, la liste des entrées, le panneau de détail et
 * les modales (sous-composants dans ./vault/). Ce composant possède l'état
 * de la page : entrée sélectionnée, vue (catégorie ou dossier), recherche,
 * modales ouvertes. La logique des dossiers est dans ./vault/folders.ts.
 */

import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { AlertTriangle, Shield } from "lucide-react";
import { getSession, logout } from "../lib/auth-client";
import { useVault } from "../hooks/useVault";
import { moveEntry } from "../lib/reorder";
import type { DropPlacement } from "../lib/reorder";
import type { VaultData, VaultFolder } from "../lib/vault-format";
import EntryDetail, { EmptyDetail } from "./vault/EntryDetail";
import EntryList from "./vault/EntryList";
import SidebarFolders from "./vault/SidebarFolders";
import VaultSidebar from "./vault/VaultSidebar";
import VaultTopbar from "./vault/VaultTopbar";
import {
    ALL_ENTRIES_VIEW, countByFolder, createFolder, deleteFolder, moveEntryToFolder, renameFolder, resolveView, sortFolders,
} from "./vault/folders";
import { countByCategory, filterEntries, viewTitle } from "./vault/format";
import ChangePasswordModal from "./vault/modals/ChangePasswordModal";
import ConfirmDeleteEntryModal from "./vault/modals/ConfirmDeleteEntryModal";
import ConfirmDeleteFolderModal from "./vault/modals/ConfirmDeleteFolderModal";
import DeleteAccountModal from "./vault/modals/DeleteAccountModal";
import EntryModal from "./vault/modals/EntryModal";
import FolderModal from "./vault/modals/FolderModal";
import FolderPickerModal from "./vault/modals/FolderPickerModal";
import MoveToFolderModal from "./vault/modals/MoveToFolderModal";
import PasswordGeneratorModal from "./vault/modals/PasswordGeneratorModal";
import type { EntryCategory, EntryFormData, VaultEntryExtended, VaultView } from "./vault/types";
import "./VaultPage.css";
import "./vault/folders.css";

/** Modale de dossier ouverte. */
type FolderDialog =
    | { kind: "create" }
    | { kind: "rename"; folder: VaultFolder }
    | { kind: "delete"; folder: VaultFolder }
    | { kind: "picker" };

/** Catégorie proposée par défaut à l'ajout, d'après la vue affichée. */
function defaultCategoryFor(view: VaultView): EntryCategory {
    return view.kind === "category" && view.category !== "all" ? view.category : "login";
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
    const { entries, folders, status, error: vaultError, version: vaultVersion, saveVault } = useVault();
    const typedEntries = entries as VaultEntryExtended[];
    const vault: VaultData = { entries: typedEntries, folders };

    // ── État local UI ──────────────────────────────────────
    const [selected,     setSelected]     = useState<VaultEntryExtended | null>(null);
    // Change à chaque clic sur une entrée : le panneau de détail repart
    // masqué (mot de passe, notes), même en recliquant sur la même entrée.
    const [detailKey,    setDetailKey]    = useState(0);
    const [view,         setView]         = useState<VaultView>(ALL_ENTRIES_VIEW);
    // Préremplit la recherche si on arrive depuis l'audit de sécurité (?q=...)
    const [search,       setSearch]       = useState(() => searchParams.get("q") ?? "");

    const [showModal,    setShowModal]    = useState(false);
    const [showGenerator, setShowGenerator] = useState(false);
    const [editEntry,    setEditEntry]    = useState<VaultEntryExtended | null>(null);
    const [showConfirmDelete,        setShowConfirmDelete]        = useState(false);
    const [showConfirmDeleteAccount, setShowConfirmDeleteAccount] = useState(false);
    const [showChangePassword,       setShowChangePassword]       = useState(false);
    const [showMoveEntry,            setShowMoveEntry]            = useState(false);
    const [folderDialog,             setFolderDialog]             = useState<FolderDialog | null>(null);

    const saving  = status === "saving";
    const loading = status === "loading";

    // Entrée affichée dans le détail, lue dans le coffre courant : après une
    // suppression de dossier ou un rechargement sur conflit, la copie gardée
    // au clic serait périmée (et « Modifier » la réécrirait). Une entrée pas
    // encore sauvegardée n'y est pas encore : on garde alors la copie.
    const current = selected ? (typedEntries.find((e) => e.id === selected.id) ?? selected) : null;

    // Un dossier affiché puis supprimé (ici ou ailleurs) ramène à « Tous ».
    const activeView   = resolveView(view, folders);
    const activeFolder = activeView.kind === "folder" ? folders.find((f) => f.id === activeView.folderId) : undefined;

    const filtered      = useMemo(() => filterEntries(typedEntries, activeView, search), [typedEntries, activeView, search]);
    const counts        = useMemo(() => countByCategory(typedEntries), [typedEntries]);
    const folderCounts  = useMemo(() => countByFolder(typedEntries), [typedEntries]);
    const sortedFolders = useMemo(() => sortFolders(folders), [folders]);

    // ── Actions ────────────────────────────────────────────

    function selectEntry(entry: VaultEntryExtended) {
        setSelected(entry);
        setDetailKey((k) => k + 1);
    }

    // Les échecs de sauvegarde (dont un conflit avec un autre appareil) sont
    // affichés par la bannière d'erreur de VaultTopbar, alimentée par useVault.
    async function deleteEntry(id: string) {
        const updated = typedEntries.filter((e) => e.id !== id);
        try {
            await saveVault({ entries: updated, folders });
        } catch {
            return;
        }
        if (selected?.id === id) setSelected(null);
    }

    // Réordonne le vault en déplaçant `draggedEntryId` avant ou après `targetId`.
    // L'ordre du tableau est ce qui est persisté (chiffré) via saveVault -
    // c'est donc lui qui définit l'ordre d'affichage à la prochaine connexion.
    async function reorderEntries(draggedEntryId: string, targetId: string, placement?: DropPlacement) {
        const reordered = moveEntry(typedEntries, draggedEntryId, targetId, placement);
        if (reordered === typedEntries) return;
        try {
            await saveVault({ entries: [...reordered], folders });
        } catch {
            // Affiché par la bannière d'erreur (voir deleteEntry).
        }
    }

    async function saveEntryForm(data: EntryFormData) {
        const { updated, saved } = applyEntryForm(typedEntries, editEntry, data);
        setSelected(saved);
        await saveVault({ entries: updated, folders });
        setShowModal(false);
    }

    // ── Dossiers ───────────────────────────────────────────

    /** Range l'entrée ; propage l'échec de sauvegarde à l'appelant. */
    async function moveToFolder(entryId: string, folderId: string | null) {
        const next = moveEntryToFolder(vault, entryId, folderId);
        if (next === vault) return;
        await saveVault(next);
    }

    async function moveSelectedEntry(folderId: string | null) {
        if (!current) return;
        await moveToFolder(current.id, folderId);
        setShowMoveEntry(false);
    }

    function dropEntryOnFolder(entryId: string, folderId: string) {
        // Partirait d'un coffre que la sauvegarde en cours va remplacer, et
        // effacerait ce qu'elle enregistre (SidebarFolders refuse déjà le dépôt).
        if (saving) return;
        // Affiché par la bannière d'erreur (voir deleteEntry).
        moveToFolder(entryId, folderId).catch(() => undefined);
    }

    async function saveFolderName(dialog: FolderDialog, name: string) {
        if (dialog.kind === "rename") {
            if (!folders.some((f) => f.id === dialog.folder.id)) {
                throw new Error("Ce dossier n'existe plus : il a été supprimé sur un autre appareil.");
            }
            const next = renameFolder(vault, dialog.folder.id, name);
            if (next !== vault) await saveVault(next);
        } else {
            const { vault: next, folder } = createFolder(vault, name);
            await saveVault(next);
            setView({ kind: "folder", folderId: folder.id });
        }
        setFolderDialog(null);
    }

    async function confirmDeleteFolder(folder: VaultFolder) {
        try {
            await saveVault(deleteFolder(vault, folder.id));
            setView(ALL_ENTRIES_VIEW);
        } catch {
            // Affiché par la bannière d'erreur (voir deleteEntry).
        }
        setFolderDialog(null);
    }

    function openFolder(folderId: string) {
        setView({ kind: "folder", folderId });
        setFolderDialog(null);
    }

    // ── Session ────────────────────────────────────────────

    async function handleLogout() {
        try {
            await logout();
        } catch {
            // Hors ligne : la session locale est déjà effacée par logout(),
            // celle du serveur expirera d'elle-même.
        }
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

    const folderActions = activeFolder && {
        onRename: () => setFolderDialog({ kind: "rename", folder: activeFolder }),
        onDelete: () => setFolderDialog({ kind: "delete", folder: activeFolder }),
    };

    return (
        <div className="vault-layout">
            <VaultSidebar
                email={getSession()?.email}
                search={search}
                onSearchChange={setSearch}
                view={activeView}
                onCategoryChange={(category) => setView({ kind: "category", category })}
                counts={counts}
                folderSection={
                    <SidebarFolders
                        folders={sortedFolders}
                        counts={folderCounts}
                        activeFolderId={activeFolder?.id ?? null}
                        onOpenFolder={openFolder}
                        onCreateFolder={() => setFolderDialog({ kind: "create" })}
                        onOpenFolderPicker={() => setFolderDialog({ kind: "picker" })}
                        isDropDisabled={saving}
                        onDropEntry={dropEntryOnFolder}
                    />
                }
                onOpenGenerator={() => setShowGenerator(true)}
                onOpenSecurityAudit={() => navigate("/security")}
                onOpenSessions={() => navigate("/sessions")}
                onLogout={handleLogout}
                onChangePassword={() => setShowChangePassword(true)}
                onDeleteAccount={() => setShowConfirmDeleteAccount(true)}
            />

            <main className="vault-main">
                <VaultTopbar
                    title={viewTitle(activeView, folders)}
                    folderActions={folderActions}
                    saving={saving}
                    errorMessage={vaultError}
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

            {current ? (
                <EntryDetail
                    key={detailKey}
                    entry={current}
                    folderName={folders.find((f) => f.id === current.folderId)?.name}
                    saving={saving}
                    onBack={() => setSelected(null)}
                    onEdit={() => openEntryModal(current)}
                    onMove={() => setShowMoveEntry(true)}
                    onDelete={() => setShowConfirmDelete(true)}
                />
            ) : (
                <EmptyDetail />
            )}

            {showModal && (
                <EntryModal
                    entry={editEntry}
                    defaultCategory={defaultCategoryFor(activeView)}
                    folders={sortedFolders}
                    defaultFolderId={activeFolder?.id}
                    onClose={() => setShowModal(false)}
                    onSave={saveEntryForm}
                />
            )}

            {showMoveEntry && current && (
                <MoveToFolderModal
                    entryLabel={current.label}
                    currentFolderId={current.folderId ?? null}
                    folders={sortedFolders}
                    onClose={() => setShowMoveEntry(false)}
                    onMove={moveSelectedEntry}
                />
            )}

            {(folderDialog?.kind === "create" || folderDialog?.kind === "rename") && (
                <FolderModal
                    folder={folderDialog.kind === "rename" ? folderDialog.folder : null}
                    folders={folders}
                    onClose={() => setFolderDialog(null)}
                    onSave={(name) => saveFolderName(folderDialog, name)}
                />
            )}

            {folderDialog?.kind === "delete" && (
                <ConfirmDeleteFolderModal
                    name={folderDialog.folder.name}
                    entryCount={folderCounts[folderDialog.folder.id] ?? 0}
                    onCancel={() => setFolderDialog(null)}
                    onConfirm={() => confirmDeleteFolder(folderDialog.folder)}
                />
            )}

            {folderDialog?.kind === "picker" && (
                <FolderPickerModal
                    folders={sortedFolders}
                    counts={folderCounts}
                    activeFolderId={activeFolder?.id ?? null}
                    onClose={() => setFolderDialog(null)}
                    onOpenFolder={openFolder}
                    onCreateFolder={() => setFolderDialog({ kind: "create" })}
                />
            )}

            {showChangePassword && (
                <ChangePasswordModal
                    vault={vault}
                    vaultVersion={vaultVersion}
                    onClose={() => setShowChangePassword(false)}
                    onSuccess={() => navigate("/login")}
                />
            )}

            {showGenerator && (
                <PasswordGeneratorModal onClose={() => setShowGenerator(false)} />
            )}

            {showConfirmDelete && current && (
                <ConfirmDeleteEntryModal
                    label={current.label}
                    onCancel={() => setShowConfirmDelete(false)}
                    onConfirm={async () => {
                        await deleteEntry(current.id);
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
