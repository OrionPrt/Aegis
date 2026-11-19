import { useMemo, useState } from "react";
import { AlertTriangle, Check, Copy, RefreshCw, X } from "lucide-react";
import { copySecret, COPY_FAILED_MESSAGE } from "../../../lib/clipboard";
import { DEFAULT_GENERATOR_SETTINGS, evaluatePasswordStrength, generatePassword } from "../../../lib/crypto";
import type { GeneratorSettings } from "../../../lib/crypto";
import GeneratorOptions from "../../GeneratorOptions";
import StrengthBar from "../StrengthBar";

/** Durée du retour visuel « copié ». */
const COPIED_FEEDBACK_MS = 2000;

/** Générateur de mot de passe autonome (outil de la barre latérale). */
export default function PasswordGeneratorModal({ onClose }: { onClose: () => void }) {
    const [settings,       setSettings]       = useState<GeneratorSettings>(DEFAULT_GENERATOR_SETTINGS);
    const [nonce,          setNonce]          = useState(0);
    const [copiedPassword, setCopiedPassword] = useState<string | null>(null);
    const [copyError,      setCopyError]      = useState<string | null>(null);

    // `nonce` n'est pas lu dans le callback : il force juste une nouvelle valeur au clic sur "Régénérer"
    const password = useMemo(
        () => generatePassword(settings),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [settings, nonce],
    );
    const copied = copiedPassword === password;

    function regenerate() {
        setNonce((n) => n + 1);
    }

    // Presse-papiers effacé automatiquement 30 s après la dernière copie (lib/clipboard.ts).
    async function handleCopy() {
        try {
            await copySecret(password);
        } catch {
            setCopyError(COPY_FAILED_MESSAGE);
            return;
        }
        setCopyError(null);
        setCopiedPassword(password);
        setTimeout(() => setCopiedPassword((p) => (p === password ? null : p)), COPIED_FEEDBACK_MS);
    }

    const strength = evaluatePasswordStrength(password);

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h2>Générateur de mot de passe</h2>
                    <button className="modal-close" onClick={onClose}><X size={15} strokeWidth={2} /></button>
                </div>
                <div className="modal-form">
                    <div className="generator-output">
                        <span className="field-mono generator-password">{password}</span>
                        <div className="icon-btn-group">
                            <button className="icon-btn" onClick={regenerate} title="Régénérer">
                                <RefreshCw size={14} strokeWidth={2} />
                            </button>
                            <button
                                className={`icon-btn ${copied ? "copied" : ""}`}
                                onClick={handleCopy}
                                title="Copier"
                            >
                                {copied ? <Check size={14} strokeWidth={2.25} /> : <Copy size={14} strokeWidth={2} />}
                            </button>
                        </div>
                    </div>

                    <StrengthBar score={strength.score} entropy={strength.entropy} />

                    {copyError && (
                        <div className="form-error" role="alert">
                            <AlertTriangle size={14} strokeWidth={2} /> {copyError}
                        </div>
                    )}

                    <GeneratorOptions value={settings} onChange={setSettings} />

                    <div className="modal-actions">
                        <button className="btn-secondary" onClick={onClose}>Fermer</button>
                        <button className="btn-primary" onClick={handleCopy}>
                            {copied ? <Check size={15} strokeWidth={2.25} /> : <Copy size={15} strokeWidth={2} />}
                            <span>{copied ? "Copié" : "Copier"}</span>
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
