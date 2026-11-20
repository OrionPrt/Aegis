import { useState } from "react";
import type { DragEvent } from "react";
import { Folder, FolderOpen, FolderPlus, Folders } from "lucide-react";
import type { VaultFolder } from "../../lib/vault-format";
import { ENTRY_DRAG_TYPE } from "./folders";

type SidebarFoldersProps = {
    /** Dossiers dans l'ordre d'affichage. */
    folders: VaultFolder[];
    counts: Record<string, number>;
    activeFolderId: string | null;
    onOpenFolder: (folderId: string) => void;
    onCreateFolder: () => void;
    /** Onglet « Dossiers » de la barre mobile, où la liste n'a pas la place. */
    onOpenFolderPicker: () => void;
    /** Pendant une sauvegarde : un dépôt partirait d'un coffre bientôt remplacé. */
    isDropDisabled: boolean;
    /** Une carte d'entrée glissée puis déposée sur un dossier. */
    onDropEntry: (entryId: string, folderId: string) => void;
};

function carriesEntry(e: DragEvent): boolean {
    return Array.from(e.dataTransfer.types).includes(ENTRY_DRAG_TYPE);
}

/**
 * Section « Dossiers » de la barre latérale : un dossier ouvert affiche tout
 * son contenu, et chaque dossier accepte une carte d'entrée glissée dessus.
 */
export default function SidebarFolders({
    folders, counts, activeFolderId, onOpenFolder, onCreateFolder, onOpenFolderPicker, isDropDisabled, onDropEntry,
}: SidebarFoldersProps) {
    const [dropTargetId, setDropTargetId] = useState<string | null>(null);

    function handleDragOver(e: DragEvent<HTMLButtonElement>, folderId: string) {
        // Sans preventDefault, le navigateur refuse le dépôt (et drop n'arrive pas).
        if (isDropDisabled || !carriesEntry(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setDropTargetId(folderId);
    }

    function handleDragLeave(e: DragEvent<HTMLButtonElement>) {
        // Passer sur l'icône ou le libellé du bouton n'est pas le quitter.
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setDropTargetId(null);
    }

    function handleDrop(e: DragEvent<HTMLButtonElement>, folderId: string) {
        setDropTargetId(null);
        const entryId = e.dataTransfer.getData(ENTRY_DRAG_TYPE);
        if (isDropDisabled || !entryId) return;
        e.preventDefault();
        onDropEntry(entryId, folderId);
    }

    return (
        <>
            <div className="nav-section-header">
                <span className="nav-section-title">Dossiers</span>
                <button
                    type="button"
                    className="icon-btn nav-section-action"
                    title="Nouveau dossier"
                    aria-label="Nouveau dossier"
                    onClick={onCreateFolder}
                >
                    <FolderPlus size={14} strokeWidth={2} />
                </button>
            </div>

            {folders.length === 0 && <p className="nav-empty-hint">Aucun dossier</p>}

            {folders.map((folder) => {
                const isActive = folder.id === activeFolderId;
                const FolderIcon = isActive ? FolderOpen : Folder;
                return (
                    <button
                        key={folder.id}
                        type="button"
                        className={`nav-item nav-item-folder ${isActive ? "active" : ""} ${dropTargetId === folder.id ? "drop-target" : ""}`}
                        title={folder.name}
                        onClick={() => onOpenFolder(folder.id)}
                        onDragOver={(e) => handleDragOver(e, folder.id)}
                        onDragLeave={handleDragLeave}
                        onDrop={(e) => handleDrop(e, folder.id)}
                    >
                        <span className="nav-icon"><FolderIcon size={15} strokeWidth={2} /></span>
                        <span className="nav-label">{folder.name}</span>
                        <span className="nav-count">{counts[folder.id] ?? 0}</span>
                    </button>
                );
            })}

            <button
                type="button"
                className={`nav-item nav-item-folders-mobile ${activeFolderId ? "active" : ""}`}
                onClick={onOpenFolderPicker}
            >
                <span className="nav-icon"><Folders size={15} strokeWidth={2} /></span>
                <span className="nav-label">Dossiers</span>
            </button>
        </>
    );
}
