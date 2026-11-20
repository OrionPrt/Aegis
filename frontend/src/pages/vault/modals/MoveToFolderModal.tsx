import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import Modal from "../../../components/Modal";
import type { VaultFolder } from "../../../lib/vault-format";
import FolderChoiceList from "./FolderChoiceList";
import type { FolderChoice } from "./FolderChoiceList";

type MoveToFolderModalProps = {
    entryLabel: string;
    currentFolderId: string | null;
    /** Dossiers dans l'ordre d'affichage. */
    folders: VaultFolder[];
    onClose: () => void;
    onMove: (folderId: string | null) => Promise<void>;
};

/** « Déplacer vers… » : range l'entrée dans un dossier (alternative clavier et tactile au glisser). */
export default function MoveToFolderModal({ entryLabel, currentFolderId, folders, onClose, onMove }: MoveToFolderModalProps) {
    const [isMoving, setIsMoving] = useState(false);
    const [error,    setError]    = useState<string | null>(null);

    const choices: FolderChoice[] = [
        { id: null, label: "Aucun dossier" },
        ...folders.map((f) => ({ id: f.id, label: f.name })),
    ];

    async function handleChoose(folderId: string | null) {
        if (folderId === currentFolderId) { onClose(); return; }
        setIsMoving(true);
        setError(null);
        try {
            await onMove(folderId);
        } catch (moveError) {
            setError(moveError instanceof Error ? moveError.message : "Erreur de sauvegarde.");
            setIsMoving(false);
        }
    }

    return (
        <Modal title={`Déplacer « ${entryLabel} »`} size="sm" onClose={onClose} dismissible={!isMoving}>
            <div className="modal-body">
                {folders.length === 0 && (
                    <p className="confirm-text">
                        Aucun dossier pour l'instant : créez-en un depuis la section « Dossiers ».
                    </p>
                )}
                <FolderChoiceList choices={choices} selectedId={currentFolderId} disabled={isMoving} onChoose={handleChoose} />
                {error && (
                    <div className="auth-error" role="alert">
                        <AlertTriangle size={14} strokeWidth={2} /> {error}
                    </div>
                )}
            </div>
        </Modal>
    );
}
