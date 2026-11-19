import { useState } from "react";
import type { FormEvent } from "react";
import { AlertTriangle, RefreshCw, X } from "lucide-react";
import { AuthError, changeMasterPassword, getSession } from "../../../lib/auth-client";
import type { VaultEntry } from "../../../lib/crypto";
import { assessMasterPassword, guessesToBits, rejectionMessage, MIN_MASTER_PASSWORD_LENGTH } from "../../../lib/password-strength";
import { useMasterPasswordStrength } from "../../../hooks/useMasterPasswordStrength";
import StrengthBar from "../StrengthBar";

interface ChangePasswordModalProps {
    vaultEntries: VaultEntry[];
    onClose: () => void;
    onSuccess: () => void;
}

export default function ChangePasswordModal({ vaultEntries, onClose, onSuccess }: ChangePasswordModalProps) {
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword,     setNewPassword]     = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [error,   setError]   = useState<string | null>(null);

    const email = getSession()?.email ?? "";
    const assessment = useMasterPasswordStrength(newPassword, [email]);

    function validate(): string | null {
        if (!currentPassword) return "Le mot de passe actuel est requis.";
        if (newPassword.length < MIN_MASTER_PASSWORD_LENGTH) return `Le nouveau mot de passe doit faire au moins ${MIN_MASTER_PASSWORD_LENGTH} caractères.`;
        if (newPassword !== confirmPassword) return "Les mots de passe ne correspondent pas.";
        if (newPassword === currentPassword) return "Le nouveau mot de passe doit être différent de l'actuel.";
        return null;
    }

    async function handleSubmit(e: FormEvent) {
        e.preventDefault();
        const validationError = validate();
        if (validationError) { setError(validationError); return; }

        setLoading(true);
        setError(null);
        try {
            const verdict = await assessMasterPassword(newPassword, [email]);
            if (!verdict.acceptable) {
                setError(rejectionMessage(verdict, newPassword));
                setLoading(false);
                return;
            }
            await changeMasterPassword(currentPassword, newPassword, vaultEntries);
            onSuccess();
        } catch (err) {
            setError(err instanceof AuthError ? err.message : "Une erreur inattendue est survenue.");
            setLoading(false);
        }
    }

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Changer le mot de passe maître</h2>
                    <button className="modal-close" onClick={onClose}><X size={15} strokeWidth={2} /></button>
                </div>
                <form className="modal-form" onSubmit={handleSubmit}>
                    <div className="form-row">
                        <label htmlFor="cp-current">Mot de passe actuel</label>
                        <input
                            id="cp-current"
                            type="password"
                            value={currentPassword}
                            onChange={(e) => { setCurrentPassword(e.target.value); setError(null); }}
                            autoComplete="current-password"
                            disabled={loading}
                        />
                    </div>

                    <div className="form-row">
                        <label htmlFor="cp-new">Nouveau mot de passe</label>
                        <input
                            id="cp-new"
                            type="password"
                            value={newPassword}
                            onChange={(e) => { setNewPassword(e.target.value); setError(null); }}
                            autoComplete="new-password"
                            disabled={loading}
                        />
                        {newPassword && assessment && (
                            <StrengthBar score={assessment.score} entropy={guessesToBits(assessment.guessesLog10)} />
                        )}
                    </div>

                    <div className="form-row">
                        <label htmlFor="cp-confirm">Confirmer le nouveau mot de passe</label>
                        <input
                            id="cp-confirm"
                            type="password"
                            value={confirmPassword}
                            onChange={(e) => { setConfirmPassword(e.target.value); setError(null); }}
                            autoComplete="new-password"
                            disabled={loading}
                        />
                    </div>

                    <p className="field-hint">
                        Toutes vos sessions actives (tous les appareils) seront déconnectées -
                        vous devrez vous reconnecter avec le nouveau mot de passe.
                    </p>

                    {loading && (
                        <div className="form-notice">
                            <RefreshCw size={14} strokeWidth={2} className="argon-spinner" />
                            <span>Vérification et rechiffrement du vault… (~3s)</span>
                        </div>
                    )}

                    {error && (
                        <div className="form-error" role="alert">
                            <AlertTriangle size={14} strokeWidth={2} /> {error}
                        </div>
                    )}

                    <div className="modal-actions">
                        <button type="button" className="btn-secondary" onClick={onClose} disabled={loading}>
                            Annuler
                        </button>
                        <button type="submit" className="btn-primary" disabled={loading}>
                            {loading ? "Changement…" : "Changer le mot de passe"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
