import { useState } from "react";
import { ArrowLeft, Check, Copy, ExternalLink, Eye, EyeOff, Pencil, Shield, Trash2 } from "lucide-react";
import { evaluatePasswordStrength } from "../../lib/crypto";
import CardDetail from "./CardDetail";
import Field from "./Field";
import StrengthBar from "./StrengthBar";
import TotpField from "./TotpField";
import { formatDate, getInitial } from "./format";
import type { CopyToClipboard, VaultEntryExtended } from "./types";

/** Durée du retour visuel « copié » sur un bouton de copie. */
const COPIED_FEEDBACK_MS = 2000;
/** Délai avant effacement automatique du presse-papier. */
const CLIPBOARD_CLEAR_MS = 30_000;

interface EntryDetailProps {
    entry: VaultEntryExtended;
    saving: boolean;
    onBack: () => void;
    onEdit: () => void;
    onDelete: () => void;
}

export default function EntryDetail({ entry, saving, onBack, onEdit, onDelete }: EntryDetailProps) {
    const [copied, setCopied] = useState<string | null>(null);

    async function copyToClipboard(text: string, field: string) {
        await navigator.clipboard.writeText(text);
        setCopied(field);
        setTimeout(() => setCopied(null), COPIED_FEEDBACK_MS);
        // Effacement automatique du presse-papier après 30s
        setTimeout(() => navigator.clipboard.writeText(""), CLIPBOARD_CLEAR_MS);
    }

    return (
        <aside className="vault-detail">
            <button className="mobile-back-btn" onClick={onBack}>
                <ArrowLeft size={15} strokeWidth={2} /> Retour
            </button>
            <DetailHeader entry={entry} />

            <div className="detail-body">
                {entry.category === "login" && (
                    <LoginDetail entry={entry} copied={copied} copyToClipboard={copyToClipboard} />
                )}

                {entry.category === "card" && (
                    <CardDetail
                        key={entry.id}
                        entry={entry}
                        copied={copied}
                        copyToClipboard={copyToClipboard}
                    />
                )}

                {entry.notes && (
                    <NotesField notes={entry.notes} copied={copied} copyToClipboard={copyToClipboard} />
                )}

                {entry.tags && entry.tags.length > 0 && (
                    <Field label="Tags">
                        <div className="tag-list">
                            {entry.tags.map((tag) => (
                                <span key={tag} className="tag">{tag}</span>
                            ))}
                        </div>
                    </Field>
                )}

                <div className="detail-meta">
                    <span>Créé le {formatDate(entry.createdAt)}</span>
                    <span>Modifié le {formatDate(entry.updatedAt)}</span>
                </div>
            </div>

            <div className="detail-footer">
                <button className="btn-edit" onClick={onEdit} disabled={saving}>
                    <Pencil size={13} strokeWidth={2} /> Modifier
                </button>
                <button className="btn-delete" onClick={onDelete} title="Supprimer" disabled={saving}>
                    <Trash2 size={14} strokeWidth={2} />
                </button>
            </div>
        </aside>
    );
}

/** Panneau affiché quand aucune entrée n'est sélectionnée. */
export function EmptyDetail() {
    return (
        <aside className="vault-detail vault-detail-empty">
            <div className="detail-placeholder">
                <Shield className="placeholder-icon" size={30} strokeWidth={1.5} />
                <p>Sélectionne une entrée</p>
            </div>
        </aside>
    );
}

function DetailHeader({ entry }: { entry: VaultEntryExtended }) {
    return (
        <div className="detail-header">
            <div className="detail-icon-wrap">
                <div className={`detail-icon cat-${entry.category}`}>{getInitial(entry)}</div>
                <div>
                    <div className="detail-name">{entry.label}</div>
                    {entry.url && (() => {
                        try { return <div className="detail-url">{new URL(entry.url).hostname}</div>; }
                        catch { return <div className="detail-url">{entry.url}</div>; }
                    })()}
                </div>
            </div>
        </div>
    );
}

interface CopyableProps {
    copied: string | null;
    copyToClipboard: CopyToClipboard;
}

function CopyButton({ field, value, copied, copyToClipboard }: CopyableProps & { field: string; value: string }) {
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

function RevealButton({ revealed, onToggle }: { revealed: boolean; onToggle: () => void }) {
    return (
        <button className="icon-btn" onClick={onToggle} title={revealed ? "Masquer" : "Afficher"}>
            {revealed ? <EyeOff size={14} strokeWidth={2} /> : <Eye size={14} strokeWidth={2} />}
        </button>
    );
}

function LoginDetail({ entry, copied, copyToClipboard }: CopyableProps & { entry: VaultEntryExtended }) {
    const [showPassword, setShowPassword] = useState(false);
    const strengthResult = entry.password ? evaluatePasswordStrength(entry.password) : null;

    return (
        <>
            <Field label="Identifiant">
                <div className="field-value-row">
                    <span className="field-mono">{entry.username}</span>
                    <CopyButton field="user" value={entry.username ?? ""} copied={copied} copyToClipboard={copyToClipboard} />
                </div>
            </Field>

            <Field label="Mot de passe">
                <div className="field-value-row">
                        <span className={`field-mono ${showPassword ? "password-visible" : "password-hidden"}`}>
                          {showPassword
                              ? entry.password
                              : "•".repeat(Math.min((entry.password ?? "").length, 16))}
                        </span>
                    <div className="icon-btn-group">
                        <RevealButton revealed={showPassword} onToggle={() => setShowPassword((v) => !v)} />
                        <CopyButton field="pass" value={entry.password ?? ""} copied={copied} copyToClipboard={copyToClipboard} />
                    </div>
                </div>
                {strengthResult && (
                    <StrengthBar score={strengthResult.score} entropy={strengthResult.entropy} />
                )}
            </Field>

            {entry.totpSecret && (
                <TotpField
                    key={entry.id}
                    entry={entry}
                    copied={copied}
                    copyToClipboard={copyToClipboard}
                />
            )}

            {entry.url && (
                <Field label="URL">
                    <div className="field-value-row">
                        <a
                            className="field-link"
                            href={entry.url}
                            target="_blank"
                            rel="noopener noreferrer"
                        >
                            {entry.url}
                        </a>
                        <button className="icon-btn"><ExternalLink size={13} strokeWidth={2} /></button>
                    </div>
                </Field>
            )}
        </>
    );
}

function NotesField({ notes, copied, copyToClipboard }: CopyableProps & { notes: string }) {
    const [showNotes, setShowNotes] = useState(false);

    return (
        <Field label="Notes">
            <div className="field-notes-row">
                <div className="field-notes-box">
                    {showNotes ? (
                        <p className="field-notes">{notes}</p>
                    ) : (
                        <p className="field-notes field-notes-hidden">Contenu masqué</p>
                    )}
                </div>
                <div className="icon-btn-group field-notes-actions">
                    <RevealButton revealed={showNotes} onToggle={() => setShowNotes((v) => !v)} />
                    <CopyButton field="notes" value={notes} copied={copied} copyToClipboard={copyToClipboard} />
                </div>
            </div>
        </Field>
    );
}
