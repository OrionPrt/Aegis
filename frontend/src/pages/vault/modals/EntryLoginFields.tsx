import type { Dispatch, SetStateAction } from "react";
import { Eye, EyeOff, RefreshCw, SlidersHorizontal } from "lucide-react";
import { evaluatePasswordStrength } from "../../../lib/crypto";
import type { GeneratorSettings } from "../../../lib/crypto";
import { isValidTotpSecret, normalizeSecretInput } from "../../../lib/totp";
import GeneratorOptions from "../../GeneratorOptions";
import StrengthBar from "../StrengthBar";
import type { EntryFormData } from "../types";

interface EntryLoginFieldsProps {
    form: EntryFormData;
    setForm: Dispatch<SetStateAction<EntryFormData>>;
    showPass: boolean;
    onToggleShowPass: () => void;
    onGenerate: () => void;
    genSettings: GeneratorSettings;
    onGenSettingsChange: (next: GeneratorSettings) => void;
    showGenOptions: boolean;
    onToggleGenOptions: () => void;
    totpInputError: string | null;
    setTotpInputError: (error: string | null) => void;
}

/** Champs propres à une entrée de type « Connexion ». */
export default function EntryLoginFields({
    form, setForm, showPass, onToggleShowPass, onGenerate,
    genSettings, onGenSettingsChange, showGenOptions, onToggleGenOptions,
    totpInputError, setTotpInputError,
}: EntryLoginFieldsProps) {
    const strength = evaluatePasswordStrength(form.password ?? "");

    function handleTotpBlur() {
        if (!form.totpSecret?.trim()) return;
        try {
            const norm = normalizeSecretInput(form.totpSecret);
            setForm((f) => ({ ...f, totpSecret: norm.secret }));
            setTotpInputError(null);
        } catch {
            setTotpInputError("Clé secrète invalide.");
        }
    }

    return (
        <>
            <div className="form-row">
                <label htmlFor="modal-username">Identifiant / Email</label>
                <input
                    id="modal-username"
                    value={form.username ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, username: e.target.value }))}
                    placeholder="email@exemple.com"
                    autoComplete="off"
                />
            </div>

            <div className="form-row">
                <label htmlFor="modal-password">Mot de passe</label>
                <div className="password-input-wrap">
                    <input
                        id="modal-password"
                        type={showPass ? "text" : "password"}
                        value={form.password ?? ""}
                        onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                        placeholder="Mot de passe"
                        autoComplete="new-password"
                        className="password-input"
                    />
                    <button type="button" className="icon-btn" onClick={onToggleShowPass}>
                        {showPass ? <EyeOff size={14} strokeWidth={2} /> : <Eye size={14} strokeWidth={2} />}
                    </button>
                    <button
                        type="button"
                        className="icon-btn generate-btn"
                        onClick={onGenerate}
                        title="Générer un mot de passe fort"
                    >
                        <RefreshCw size={14} strokeWidth={2} />
                    </button>
                    <button
                        type="button"
                        className={`icon-btn ${showGenOptions ? "generate-options-open" : ""}`}
                        onClick={onToggleGenOptions}
                        title="Options du générateur"
                        aria-expanded={showGenOptions}
                        aria-controls="modal-generator-options"
                    >
                        <SlidersHorizontal size={14} strokeWidth={2} />
                    </button>
                </div>
                {form.password && (
                    <StrengthBar score={strength.score} entropy={strength.entropy} />
                )}
            </div>

            {showGenOptions && (
                <div id="modal-generator-options" className="generator-panel">
                    <GeneratorOptions value={genSettings} onChange={onGenSettingsChange} />
                </div>
            )}

            <div className="form-row">
                <label htmlFor="modal-url">URL</label>
                <input
                    id="modal-url"
                    type="url"
                    value={form.url ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                    placeholder="https://..."
                />
            </div>

            <div className="form-row">
                <label htmlFor="modal-totp">Clé secrète 2FA (optionnel)</label>
                <input
                    id="modal-totp"
                    className="totp-secret-input"
                    value={form.totpSecret ?? ""}
                    onChange={(e) => {
                        const v = e.target.value;
                        setForm((f) => ({ ...f, totpSecret: v }));
                        setTotpInputError(v.trim() && !isValidTotpSecret(v) ? "Clé secrète invalide." : null);
                    }}
                    onBlur={handleTotpBlur}
                    placeholder="Collez la clé base32 ou un lien otpauth://..."
                    autoComplete="off"
                    spellCheck={false}
                />
                {totpInputError && <div className="field-hint field-hint-danger">{totpInputError}</div>}
                {!totpInputError && form.totpSecret?.trim() && (
                    <div className="field-hint">2FA activée pour cette entrée.</div>
                )}
            </div>
        </>
    );
}
