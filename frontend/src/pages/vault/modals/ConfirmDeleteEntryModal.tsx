import { X } from "lucide-react";

interface ConfirmDeleteEntryModalProps {
    label: string;
    onCancel: () => void;
    onConfirm: () => Promise<void>;
}

export default function ConfirmDeleteEntryModal({ label, onCancel, onConfirm }: ConfirmDeleteEntryModalProps) {
    return (
        <div className="modal-overlay" onClick={onCancel}>
            <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Supprimer cette entrée ?</h2>
                    <button className="modal-close" onClick={onCancel}><X size={15} strokeWidth={2} /></button>
                </div>
                <div className="modal-body">
                    <p className="confirm-text">
                        <strong>{label}</strong> sera supprimé définitivement.
                        Cette action est irréversible.
                    </p>
                    <div className="modal-actions">
                        <button className="btn-secondary" onClick={onCancel}>
                            Annuler
                        </button>
                        <button className="btn-delete btn-delete-solid" onClick={onConfirm}>
                            Supprimer
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
