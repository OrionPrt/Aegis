import { useState } from "react";
import { AlertTriangle, ArrowLeft, Check, Copy, ExternalLink, Eye, EyeOff, Folder, FolderInput, Pencil, Shield, Trash2 } from "lucide-react";
import { evaluatePasswordStrength } from "../../lib/crypto";
import { safeHttpUrl } from "../../lib/url";
import CardDetail from "./CardDetail";
import Field from "./Field";
import StrengthBar from "./StrengthBar";
import TotpField from "./TotpField";
import { formatDate, getInitial } from "./format";
import type { CopyToClipboard, VaultEntryExtended } from "./types";
import { useCopyFeedback } from "./useCopyFeedback";

interface EntryDetailProps {
    entry: VaultEntryExtended;
    /** Nom du dossier de l'entrée, absent si elle n'en a pas. */
    folderName?: string;
    saving: boolean;
    onBack: () => void;
    onEdit: () => void;
    onMove: () => void;
    onDelete: () => void;
}

export default function EntryDetail({ entry, folderName, saving, onBack, onEdit, onMove, onDelete }: EntryDetailProps) {
    // Presse-papiers effacé automatiquement 30 s après la dernière copie (lib/clipboard.ts).
    const { copied, copyError, copy: copyToClipboard } = useCopyFeedback();

    return (
        <aside className="vault-detail">
            <button className="mobile-back-btn" onClick={onBack}>
                <ArrowLeft size={15} strokeWidth={2} /> Retour
            </button>
            <DetailHeader entry={entry} />

            <div className="detail-body">
                {copyError && (
                    <div className="form-error" role="alert">
                        <AlertTriangle size={14} strokeWidth={2} /> {copyError}
                    </div>
                )}

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

                {folderName && (
                    <Field label="Dossier">
                        <span className="detail-folder">
                            <Folder size={13} strokeWidth={2} aria-hidden="true" /> {folderName}
                        </span>
                    </Field>
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
                <button className="btn-move" onClick={onMove} title="Déplacer vers…" aria-label="Déplacer vers un dossier" disabled={saving}>
                    <FolderInput size={14} strokeWidth={2} />
                </button>
                <button className="btn-delete" onClick={onDelete} title="Supprimer" aria-label="Supprimer l'entrée" disabled={saving}>
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
                    {entry.url && (
                        <div className="detail-url">{hostnameOf(entry.url) ?? entry.url}</div>
                    )}
                </div>
            </div>
        </div>
    );
}

interface CopyableProps {
    copied: string | null;
    copyToClipboard: CopyToClipboard;
}

function CopyButton({ field, label, value, copied, copyToClipboard }: CopyableProps & { field: string; label: string; value: string }) {
    return (
        <button
            className={`icon-btn ${copied === field ? "copied" : ""}`}
            onClick={() => copyToClipboard(value, field)}
            title="Copier"
            aria-label={copied === field ? `${label} copié` : `Copier ${label}`}
        >
            {copied === field ? <Check size={14} strokeWidth={2.25} /> : <Copy size={14} strokeWidth={2} />}
        </button>
    );
}

function RevealButton({ revealed, label, onToggle }: { revealed: boolean; label: string; onToggle: () => void }) {
    return (
        <button
            className="icon-btn"
            onClick={onToggle}
            title={revealed ? "Masquer" : "Afficher"}
            aria-label={`${revealed ? "Masquer" : "Afficher"} ${label}`}
            aria-pressed={revealed}
        >
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
                    <CopyButton field="user" label="l'identifiant" value={entry.username ?? ""} copied={copied} copyToClipboard={copyToClipboard} />
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
                        <RevealButton revealed={showPassword} label="le mot de passe" onToggle={() => setShowPassword((v) => !v)} />
                        <CopyButton field="pass" label="le mot de passe" value={entry.password ?? ""} copied={copied} copyToClipboard={copyToClipboard} />
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

            {entry.url && <UrlField url={entry.url} />}
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
                    <RevealButton revealed={showNotes} label="les notes" onToggle={() => setShowNotes((v) => !v)} />
                    <CopyButton field="notes" label="les notes" value={notes} copied={copied} copyToClipboard={copyToClipboard} />
                </div>
            </div>
        </Field>
    );
}

/** Nom d'hôte d'une adresse web, ou null si ce n'en est pas une. */
function hostnameOf(url: string): string | null {
    const safe = safeHttpUrl(url);
    return safe ? new URL(safe).hostname : null;
}

/**
 * Seules les adresses http(s) deviennent des liens : toute autre valeur
 * (javascript:, data:…) reste du texte.
 */
function UrlField({ url }: { url: string }) {
    const safe = safeHttpUrl(url);
    return (
        <Field label="URL">
            <div className="field-value-row">
                {safe ? (
                    <>
                        <a className="field-link" href={safe} target="_blank" rel="noopener noreferrer">
                            {url}
                        </a>
                        <button
                            className="icon-btn"
                            title="Ouvrir le site"
                            aria-label="Ouvrir le site"
                            onClick={() => window.open(safe, "_blank", "noopener,noreferrer")}
                        >
                            <ExternalLink size={13} strokeWidth={2} />
                        </button>
                    </>
                ) : (
                    <span className="field-mono">{url}</span>
                )}
            </div>
        </Field>
    );
}
