import type { Dispatch, SetStateAction } from "react";
import { Eye, EyeOff } from "lucide-react";
import { brandLabel, cvvLength, detectBrand, digitsOnly, formatCardNumber, formatExpiry, maxPanLength } from "../../../lib/card";
import type { CardBrand, ExpiryStatus } from "../../../lib/card";
import type { EntryFormData } from "../types";

/** Longueur maximale d'un code PIN de carte. */
const MAX_PIN_LENGTH = 6;

interface EntryCardFieldsProps {
    form: EntryFormData;
    setForm: Dispatch<SetStateAction<EntryFormData>>;
    panDigits: string;
    brand: CardBrand;
    panInvalid: boolean;
    expiryStatus: ExpiryStatus;
    showSecret: boolean;
    onToggleShowSecret: () => void;
}

/** Champs propres à une entrée de type « Carte ». */
export default function EntryCardFields({
    form, setForm, panDigits, brand, panInvalid, expiryStatus, showSecret, onToggleShowSecret,
}: EntryCardFieldsProps) {
    const revealToggle = (
        <button
            type="button"
            className="icon-btn"
            onClick={onToggleShowSecret}
            aria-label={showSecret ? "Masquer le cryptogramme et le code PIN" : "Afficher le cryptogramme et le code PIN"}
            aria-pressed={showSecret}
        >
            {showSecret ? <EyeOff size={14} strokeWidth={2} /> : <Eye size={14} strokeWidth={2} />}
        </button>
    );

    return (
        <>
            <div className="form-row">
                <label htmlFor="modal-cardholder">Titulaire</label>
                <input
                    id="modal-cardholder"
                    className="uppercase-input"
                    value={form.cardholder ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, cardholder: e.target.value }))}
                    placeholder="JEAN DUPONT"
                    autoComplete="off"
                    spellCheck={false}
                />
            </div>

            <div className="form-row">
                <label htmlFor="modal-card-number">Numéro</label>
                <div className="card-number-wrap">
                    <input
                        id="modal-card-number"
                        className="card-number-input"
                        value={formatCardNumber(form.cardNumber ?? "")}
                        onChange={(e) => {
                            const b = detectBrand(e.target.value);
                            setForm((f) => ({
                                ...f,
                                cardNumber: digitsOnly(e.target.value).slice(0, maxPanLength(b)),
                            }));
                        }}
                        placeholder="0000 0000 0000 0000"
                        inputMode="numeric"
                        autoComplete="off"
                        spellCheck={false}
                    />
                    {panDigits.length > 0 && (
                        <span className={`card-brand-chip card-brand-chip-${brand}`}>
                            {brandLabel(brand)}
                        </span>
                    )}
                </div>
                {panInvalid && <div className="field-hint field-hint-danger">Numéro invalide</div>}
            </div>

            <div className="form-row-split">
                <div className="form-row">
                    <label htmlFor="modal-card-expiry">Expiration</label>
                    <input
                        id="modal-card-expiry"
                        value={formatExpiry(form.cardExpiry ?? "")}
                        onChange={(e) => setForm((f) => ({
                            ...f, cardExpiry: digitsOnly(e.target.value).slice(0, 4),
                        }))}
                        placeholder="MM/AA"
                        inputMode="numeric"
                        autoComplete="off"
                    />
                    {expiryStatus === "expired" && (
                        <div className="field-hint field-hint-danger">Carte expirée</div>
                    )}
                    {expiryStatus === "soon" && (
                        <div className="field-hint field-hint-warn">Expire bientôt</div>
                    )}
                </div>

                <div className="form-row">
                    <label htmlFor="modal-card-cvv">Cryptogramme</label>
                    <div className="password-input-wrap">
                        <input
                            id="modal-card-cvv"
                            type={showSecret ? "text" : "password"}
                            value={form.cardCvv ?? ""}
                            onChange={(e) => setForm((f) => ({
                                ...f, cardCvv: digitsOnly(e.target.value).slice(0, cvvLength(brand)),
                            }))}
                            placeholder="CVV"
                            inputMode="numeric"
                            maxLength={cvvLength(brand)}
                            autoComplete="off"
                        />
                        {revealToggle}
                    </div>
                </div>
            </div>

            <div className="form-row-split">
                <div className="form-row">
                    <label htmlFor="modal-card-pin">Code PIN</label>
                    <div className="password-input-wrap">
                        <input
                            id="modal-card-pin"
                            type={showSecret ? "text" : "password"}
                            value={form.cardPin ?? ""}
                            onChange={(e) => setForm((f) => ({
                                ...f, cardPin: digitsOnly(e.target.value).slice(0, MAX_PIN_LENGTH),
                            }))}
                            placeholder="Optionnel"
                            inputMode="numeric"
                            maxLength={MAX_PIN_LENGTH}
                            autoComplete="off"
                        />
                        {revealToggle}
                    </div>
                </div>

                <div className="form-row">
                    <label>Type</label>
                    <div className="category-selector">
                        {(["credit", "debit"] as const).map((t) => (
                            <button
                                key={t}
                                type="button"
                                className={`cat-btn ${form.cardType === t ? "active" : ""}`}
                                onClick={() => setForm((f) => ({ ...f, cardType: t }))}
                            >
                                {t === "credit" ? "Crédit" : "Débit"}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            <div className="form-row">
                <label htmlFor="modal-card-bank">Banque émettrice</label>
                <input
                    id="modal-card-bank"
                    value={form.cardBank ?? ""}
                    onChange={(e) => setForm((f) => ({ ...f, cardBank: e.target.value }))}
                    placeholder="ex: BNP Paribas"
                    autoComplete="off"
                />
            </div>
        </>
    );
}
