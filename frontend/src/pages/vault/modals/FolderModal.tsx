import { useState } from "react";
import type { FormEvent } from "react";
import { AlertTriangle } from "lucide-react";
import Modal from "../../../components/Modal";
import type { VaultFolder } from "../../../lib/vault-format";
import { MAX_FOLDER_NAME_LENGTH, validateFolderName } from "../folders";

type FolderModalProps = {
    /** Dossier à renommer, ou null pour en créer un. */
    folder: VaultFolder | null;
    folders: VaultFolder[];
    onClose: () => void;
    onSave: (name: string) => Promise<void>;
};

/** Création ou renommage d'un dossier. */
export default function FolderModal({ folder, folders, onClose, onSave }: FolderModalProps) {
    const [name,     setName]     = useState(folder?.name ?? "");
    const [error,    setError]    = useState<string | null>(null);
    const [isSaving, setIsSaving] = useState(false);

    async function handleSubmit(e: FormEvent) {
        e.preventDefault();
        const validationError = validateFolderName(name, folders, folder?.id);
        if (validationError) { setError(validationError); return; }

        setError(null);
        setIsSaving(true);
        try {
            await onSave(name);
        } catch (saveError) {
            // Le modal reste ouvert avec la saisie (conflit : le coffre vient
            // d'être rechargé, un nouvel envoi part de lui).
            setError(saveError instanceof Error ? saveError.message : "Erreur de sauvegarde.");
            setIsSaving(false);
        }
    }

    return (
        <Modal title={folder ? "Renommer le dossier" : "Nouveau dossier"} size="sm" onClose={onClose} dismissible={!isSaving}>
            <form className="modal-form" onSubmit={handleSubmit}>
                <div className="form-row">
                    <label htmlFor="folder-name">Nom du dossier</label>
                    <input
                        id="folder-name"
                        data-autofocus
                        value={name}
                        maxLength={MAX_FOLDER_NAME_LENGTH}
                        onChange={(e) => { setName(e.target.value); setError(null); }}
                        placeholder="ex: Perso"
                        disabled={isSaving}
                    />
                </div>

                {error && (
                    <div className="auth-error" role="alert">
                        <AlertTriangle size={14} strokeWidth={2} /> {error}
                    </div>
                )}

                <div className="modal-actions">
                    <button type="button" className="btn-secondary" onClick={onClose} disabled={isSaving}>
                        Annuler
                    </button>
                    <button type="submit" className="btn-primary" disabled={isSaving}>
                        {isSaving ? "Sauvegarde…" : folder ? "Renommer" : "Créer"}
                    </button>
                </div>
            </form>
        </Modal>
    );
}
