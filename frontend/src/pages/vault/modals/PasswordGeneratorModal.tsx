import { useMemo, useState } from "react";
import { Check, Copy, RefreshCw, X } from "lucide-react";
import { DEFAULT_GENERATOR_SETTINGS, evaluatePasswordStrength, generatePassword } from "../../../lib/crypto";
import type { GeneratorSettings } from "../../../lib/crypto";
import GeneratorOptions from "../../GeneratorOptions";
import StrengthBar from "../StrengthBar";

/** Durée du retour visuel « copié ». */
const COPIED_FEEDBACK_MS = 2000;
/** Délai avant effacement automatique du presse-papier. */
const CLIPBOARD_CLEAR_MS = 30_000;

/** Générateur de mot de passe autonome (outil de la barre latérale). */
export default function PasswordGeneratorModal({ onClose }: { onClose: () => void }) {
    const [settings,       setSettings]       = useState<GeneratorSettings>(DEFAULT_GENERATOR_SETTINGS);
    const [nonce,          setNonce]          = useState(0);
    const [copiedPassword, setCopiedPassword] = useState<string | null>(null);

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

    async function handleCopy() {
        await navigator.clipboard.writeText(password);
        setCopiedPassword(password);
        setTimeout(() => setCopiedPassword((p) => (p === password ? null : p)), COPIED_FEEDBACK_MS);
        setTimeout(() => navigator.clipboard.writeText(""), CLIPBOARD_CLEAR_MS);
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
