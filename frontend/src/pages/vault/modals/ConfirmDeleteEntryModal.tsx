import Modal from "../../../components/Modal";

interface ConfirmDeleteEntryModalProps {
    label: string;
    onCancel: () => void;
    onConfirm: () => Promise<void>;
}

export default function ConfirmDeleteEntryModal({ label, onCancel, onConfirm }: ConfirmDeleteEntryModalProps) {
    return (
        <Modal title="Supprimer cette entrée ?" size="sm" onClose={onCancel}>
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
        </Modal>
    );
}
