import { useState } from "react";
import type { FormEvent } from "react";
import { AlertTriangle, X } from "lucide-react";
import { checkExpiry, detectBrand, digitsOnly, luhn } from "../../../lib/card";
import { DEFAULT_GENERATOR_SETTINGS, generatePassword } from "../../../lib/crypto";
import type { GeneratorSettings } from "../../../lib/crypto";
import { CATEGORY_ICONS, CATEGORY_LABELS } from "../format";
import type { EntryCategory, EntryFormData, VaultEntryExtended } from "../types";
import EntryCardFields from "./EntryCardFields";
import EntryLoginFields from "./EntryLoginFields";
import { initialFormData, toEntryData, validateEntryForm } from "./entryForm";

const ENTRY_CATEGORIES = ["login", "card", "note"] as const;
/** Longueur à partir de laquelle un numéro de carte est vérifié (Luhn) pendant la saisie. */
const PAN_CHECK_MIN_LENGTH = 12;

interface EntryModalProps {
    entry: VaultEntryExtended | null;
    defaultCategory: EntryCategory;
    onClose: () => void;
    onSave: (data: EntryFormData) => Promise<void>;
}

/** Modal d'ajout (entry = null) ou d'édition d'une entrée du coffre. */
export default function EntryModal({ entry, defaultCategory, onClose, onSave }: EntryModalProps) {
    const [form, setForm] = useState<EntryFormData>(() => initialFormData(entry, defaultCategory));
    const [showPass,   setShowPass]   = useState(false);
    const [showSecret, setShowSecret] = useState(false); // CVV + PIN, œil partagé
    const [saving,     setSaving]     = useState(false);
    const [tagsInput,  setTagsInput]  = useState(entry?.tags?.join(", ") ?? "");
    const [formError,  setFormError]  = useState<string | null>(null);
    const [totpInputError, setTotpInputError] = useState<string | null>(null);
    // Réglages du générateur conservés tant que le modal est ouvert : on ne
    // veut pas re-décocher les symboles à chaque clic sur "Générer".
    // Mêmes valeurs par défaut que le générateur autonome (caractères
    // ambigus inclus) pour que les deux se comportent pareil.
    const [genSettings,    setGenSettings]    = useState<GeneratorSettings>(DEFAULT_GENERATOR_SETTINGS);
    const [showGenOptions, setShowGenOptions] = useState(false);

    const panDigits    = digitsOnly(form.cardNumber ?? "");
    const brand        = detectBrand(panDigits);
    const panInvalid   = panDigits.length >= PAN_CHECK_MIN_LENGTH && !luhn(panDigits);
    const expiryStatus = checkExpiry(form.cardExpiry ?? "");

    function applyGenerated(settings: GeneratorSettings) {
        setForm((f) => ({ ...f, password: generatePassword(settings) }));
        setShowPass(true);
    }

    // Changer une option régénère aussitôt : c'est le but (ex. un site qui
    // refuse les caractères spéciaux) - inutile de recliquer sur "Générer".
    function handleGenSettingsChange(next: GeneratorSettings) {
        setGenSettings(next);
        applyGenerated(next);
    }

    async function handleSubmit(e: FormEvent) {
        e.preventDefault();
        const err = validateEntryForm(form, panDigits, brand);
        if (err) { setFormError(err); return; }
        setFormError(null);
        setSaving(true);
        try {
            await onSave(toEntryData(form, tagsInput, panDigits, brand));
        } catch (saveError) {
            // Le modal reste ouvert avec la saisie : en cas de conflit, le
            // coffre vient d'être rechargé et un nouvel envoi part de lui.
            setFormError(saveError instanceof Error ? saveError.message : "Erreur de sauvegarde.");
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="modal-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
            <div className="modal">
                <div className="modal-header">
                    <h2>{entry ? "Modifier l'entrée" : "Nouvelle entrée"}</h2>
                    <button className="modal-close" onClick={onClose}><X size={15} strokeWidth={2} /></button>
                </div>

                <form className="modal-form" onSubmit={handleSubmit}>
                    <div className="form-row">
                        <label>Catégorie</label>
                        <div className="category-selector">
                            {ENTRY_CATEGORIES.map((cat) => {
                                const CatIcon = CATEGORY_ICONS[cat];
                                return (
                                    <button
                                        key={cat}
                                        type="button"
                                        className={`cat-btn ${form.category === cat ? "active" : ""}`}
                                        onClick={() => setForm((f) => ({ ...f, category: cat }))}
                                    >
                                        <CatIcon size={13} strokeWidth={2} /> {CATEGORY_LABELS[cat]}
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    <div className="form-row">
                        <label htmlFor="modal-label">Nom</label>
                        <input
                            id="modal-label"
                            value={form.label}
                            onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                            placeholder="ex: GitHub"
                        />
                    </div>

                    {form.category === "login" && (
                        <EntryLoginFields
                            form={form}
                            setForm={setForm}
                            showPass={showPass}
                            onToggleShowPass={() => setShowPass((v) => !v)}
                            onGenerate={() => applyGenerated(genSettings)}
                            genSettings={genSettings}
                            onGenSettingsChange={handleGenSettingsChange}
                            showGenOptions={showGenOptions}
                            onToggleGenOptions={() => setShowGenOptions((v) => !v)}
                            totpInputError={totpInputError}
                            setTotpInputError={setTotpInputError}
                        />
                    )}

                    {form.category === "card" && (
                        <EntryCardFields
                            form={form}
                            setForm={setForm}
                            panDigits={panDigits}
                            brand={brand}
                            panInvalid={panInvalid}
                            expiryStatus={expiryStatus}
                            showSecret={showSecret}
                            onToggleShowSecret={() => setShowSecret((v) => !v)}
                        />
                    )}

                    <div className="form-row">
                        <label htmlFor="modal-notes">{form.category === "note" ? "Contenu" : "Notes"}</label>
                        <textarea
                            id="modal-notes"
                            value={form.notes ?? ""}
                            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                            placeholder={form.category === "note" ? "Écrivez votre note..." : "Notes optionnelles..."}
                            rows={form.category === "note" ? 8 : 3}
                        />
                    </div>

                    <div className="form-row">
                        <label htmlFor="modal-tags">Tags</label>
                        <input
                            id="modal-tags"
                            value={tagsInput}
                            onChange={(e) => setTagsInput(e.target.value)}
                            placeholder="dev, perso, pro (séparés par des virgules)"
                        />
                    </div>

                    {formError && (
                        <div className="auth-error" role="alert">
                            <AlertTriangle size={14} strokeWidth={2} /> {formError}
                        </div>
                    )}

                    <div className="modal-actions">
                        <button type="button" className="btn-secondary" onClick={onClose}>
                            Annuler
                        </button>
                        <button type="submit" className="btn-primary" disabled={saving}>
                            {saving ? "Sauvegarde…" : entry ? "Enregistrer" : "Ajouter"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
