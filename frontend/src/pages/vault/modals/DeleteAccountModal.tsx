import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import Modal from "../../../components/Modal";
import { AuthError, deleteAccount } from "../../../lib/auth-client";

interface DeleteAccountModalProps {
    onClose: () => void;
    onDeleted: () => void;
}

export default function DeleteAccountModal({ onClose, onDeleted }: DeleteAccountModalProps) {
    const [password, setPassword] = useState("");
    const [error,    setError]    = useState<string | null>(null);
    const [loading,  setLoading]  = useState(false);

    async function handleConfirm() {
        setLoading(true);
        setError(null);
        try {
            await deleteAccount(password);
            onDeleted();
        } catch (err) {
            setError(err instanceof AuthError ? err.message : "Une erreur inattendue est survenue.");
            setLoading(false);
        }
    }

    return (
        <Modal
            title={<><AlertTriangle size={16} strokeWidth={2} /> Supprimer le compte</>}
            titleClassName="modal-title-danger"
            size="sm"
            onClose={onClose}
            dismissible={!loading}
        >
            <div className="modal-body">
                <p className="confirm-text">
                    Cette action supprime <strong>définitivement</strong> votre
                    compte et l'intégralité de votre vault. Aucune récupération n'est possible - le serveur
                    ne conserve aucune copie de vos données en clair.
                </p>
                <p className="confirm-subtext">
                    Saisissez votre mot de passe maître pour confirmer.
                </p>
                <input
                    className="confirm-input"
                    type="password"
                    value={password}
                    onChange={(e) => { setPassword(e.target.value); setError(null); }}
                    placeholder="Mot de passe maître"
                    autoComplete="current-password"
                    data-autofocus
                    disabled={loading}
                />
                {error && (
                    <div className="form-error" role="alert">
                        <AlertTriangle size={14} strokeWidth={2} /> {error}
                    </div>
                )}
                <div className="modal-actions">
                    <button className="btn-secondary" onClick={onClose} disabled={loading}>
                        Annuler
                    </button>
                    <button
                        className="btn-delete btn-delete-solid"
                        disabled={!password || loading}
                        onClick={handleConfirm}
                    >
                        {loading ? "Suppression…" : "Supprimer définitivement"}
                    </button>
                </div>
            </div>
        </Modal>
    );
}
