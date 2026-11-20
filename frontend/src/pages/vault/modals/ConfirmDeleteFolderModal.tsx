import { useState } from "react";
import Modal from "../../../components/Modal";

type ConfirmDeleteFolderModalProps = {
    name: string;
    entryCount: number;
    onCancel: () => void;
    onConfirm: () => Promise<void>;
};

function keptEntriesText(entryCount: number): string {
    if (entryCount === 0) return "Il est vide.";
    if (entryCount === 1) return "Son entrée restera dans le coffre, sans dossier.";
    return `Ses ${entryCount} entrées resteront dans le coffre, sans dossier.`;
}

/** Confirmation de suppression d'un dossier : aucune entrée n'est supprimée. */
export default function ConfirmDeleteFolderModal({ name, entryCount, onCancel, onConfirm }: ConfirmDeleteFolderModalProps) {
    const [isDeleting, setIsDeleting] = useState(false);

    async function handleConfirm() {
        setIsDeleting(true);
        try {
            await onConfirm();
        } finally {
            setIsDeleting(false);
        }
    }

    return (
        <Modal title="Supprimer ce dossier ?" size="sm" onClose={onCancel} dismissible={!isDeleting}>
            <div className="modal-body">
                <p className="confirm-text">
                    Le dossier <strong>{name}</strong> sera supprimé. {keptEntriesText(entryCount)}
                </p>
                <div className="modal-actions">
                    <button className="btn-secondary" onClick={onCancel} disabled={isDeleting}>
                        Annuler
                    </button>
                    <button className="btn-delete btn-delete-solid" onClick={handleConfirm} disabled={isDeleting}>
                        Supprimer le dossier
                    </button>
                </div>
            </div>
        </Modal>
    );
}
