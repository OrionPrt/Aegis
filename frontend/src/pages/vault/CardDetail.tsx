import { useEffect, useState } from "react";
import { AlertTriangle, Check, Copy, Eye, EyeOff } from "lucide-react";
import {
    brandLabel, checkExpiry, detectBrand, digitsOnly, formatCardNumber, formatExpiry, maskCardNumber,
} from "../../lib/card";
import Field from "./Field";
import type { CopyToClipboard, VaultEntryExtended } from "./types";

/** Durée avant re-masquage automatique des données de carte révélées. */
const REVEAL_DURATION_MS = 30_000;

interface CardDetailProps {
    entry: VaultEntryExtended;
    copied: string | null;
    copyToClipboard: CopyToClipboard;
}

export default function CardDetail({ entry, copied, copyToClipboard }: CardDetailProps) {
    const [revealed, setRevealed] = useState(false);

    // Re-masquage automatique après 30 secondes
    useEffect(() => {
        if (!revealed) return;
        const timer = setTimeout(() => setRevealed(false), REVEAL_DURATION_MS);
        return () => clearTimeout(timer);
    }, [revealed]);

    const pan    = entry.cardNumber ?? "";
    const brand  = entry.cardBrand ?? detectBrand(pan);
    const status = checkExpiry(entry.cardExpiry ?? "");

    return (
        <>
            <div className={`card-preview card-preview-${brand}`}>
                <div className="card-preview-top">
                    <div className="card-chip" />
                    <span className="card-preview-brand">{brandLabel(brand)}</span>
                </div>
                <div className="card-preview-number">{maskCardNumber(pan)}</div>
                <div className="card-preview-bottom">
                    <div>
                        <div className="card-preview-label">Titulaire</div>
                        <div className="card-preview-value">{entry.cardholder || "-"}</div>
                    </div>
                    <div>
                        <div className="card-preview-label">Expire</div>
                        <div className="card-preview-value">
                            {entry.cardExpiry ? formatExpiry(entry.cardExpiry) : "--/--"}
                        </div>
                    </div>
                </div>
            </div>

            {status === "expired" && (
                <div className="card-expired-banner">
                    <AlertTriangle size={13} strokeWidth={2} /> Cette carte a expiré.
                </div>
            )}

            <Field label="Numéro de carte">
                <div className="field-value-row">
                    <span className="field-mono">
                        {revealed ? formatCardNumber(pan) : maskCardNumber(pan)}
                    </span>
                    <div className="icon-btn-group">
                        <button
                            className="icon-btn"
                            onClick={() => setRevealed((v) => !v)}
                            title={revealed ? "Masquer" : "Afficher"}
                        >
                            {revealed ? <EyeOff size={14} strokeWidth={2} /> : <Eye size={14} strokeWidth={2} />}
                        </button>
                        <CopyButton field="cardNumber" value={digitsOnly(pan)} copied={copied} copyToClipboard={copyToClipboard} />
                    </div>
                </div>
            </Field>

            {entry.cardCvv && (
                <SecretField label="Cryptogramme" field="cvv" value={entry.cardCvv} revealed={revealed} copied={copied} copyToClipboard={copyToClipboard} />
            )}

            {entry.cardPin && (
                <SecretField label="Code PIN" field="pin" value={entry.cardPin} revealed={revealed} copied={copied} copyToClipboard={copyToClipboard} />
            )}

            {entry.cardBank && (
                <Field label="Banque émettrice">
                    <span className="field-mono">{entry.cardBank}</span>
                </Field>
            )}

            {entry.cardType && (
                <Field label="Type">
                    <span className="field-mono">{entry.cardType === "credit" ? "Crédit" : "Débit"}</span>
                </Field>
            )}
        </>
    );
}

interface CopyButtonProps {
    field: string;
    value: string;
    copied: string | null;
    copyToClipboard: CopyToClipboard;
}

function CopyButton({ field, value, copied, copyToClipboard }: CopyButtonProps) {
    return (
        <button
            className={`icon-btn ${copied === field ? "copied" : ""}`}
            onClick={() => copyToClipboard(value, field)}
            title="Copier"
        >
            {copied === field ? <Check size={14} strokeWidth={2.25} /> : <Copy size={14} strokeWidth={2} />}
        </button>
    );
}

interface SecretFieldProps extends CopyButtonProps {
    label: string;
    revealed: boolean;
}

/** Champ de carte masqué par des points tant que la carte n'est pas révélée (CVV, PIN). */
function SecretField({ label, field, value, revealed, copied, copyToClipboard }: SecretFieldProps) {
    return (
        <Field label={label}>
            <div className="field-value-row">
                <span className="field-mono">
                    {revealed ? value : "•".repeat(value.length)}
                </span>
                <CopyButton field={field} value={value} copied={copied} copyToClipboard={copyToClipboard} />
            </div>
        </Field>
    );
}
