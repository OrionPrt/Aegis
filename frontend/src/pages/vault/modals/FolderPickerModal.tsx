import { FolderPlus } from "lucide-react";
import Modal from "../../../components/Modal";
import type { VaultFolder } from "../../../lib/vault-format";
import FolderChoiceList from "./FolderChoiceList";

type FolderPickerModalProps = {
    /** Dossiers dans l'ordre d'affichage. */
    folders: VaultFolder[];
    counts: Record<string, number>;
    activeFolderId: string | null;
    onClose: () => void;
    onOpenFolder: (folderId: string) => void;
    onCreateFolder: () => void;
};

/** Onglet « Dossiers » de la barre mobile : ouvrir un dossier ou en créer un. */
export default function FolderPickerModal({
    folders, counts, activeFolderId, onClose, onOpenFolder, onCreateFolder,
}: FolderPickerModalProps) {
    const choices = folders.map((f) => ({ id: f.id, label: f.name, count: counts[f.id] ?? 0 }));

    return (
        <Modal title="Dossiers" size="sm" onClose={onClose}>
            <div className="modal-body">
                {folders.length === 0 ? (
                    <p className="confirm-text">Aucun dossier pour l'instant.</p>
                ) : (
                    <FolderChoiceList
                        choices={choices}
                        selectedId={activeFolderId}
                        onChoose={(id) => { if (id) onOpenFolder(id); }}
                    />
                )}
                <div className="modal-actions">
                    <button type="button" className="btn-primary" onClick={onCreateFolder}>
                        <FolderPlus size={15} strokeWidth={2} /> Nouveau dossier
                    </button>
                </div>
            </div>
        </Modal>
    );
}
