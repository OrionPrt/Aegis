/**
 * ╔═══════════════════════════════════════════════════════╗
 * ║           AEGIS — Interface du Vault (finale)         ║
 * ║           src/pages/VaultPage.tsx                     ║
 * ╚═══════════════════════════════════════════════════════╝
 */

import { useState, useMemo, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
    Shield, Search, LayoutGrid, KeyRound, CreditCard, StickyNote,
    RefreshCw, ShieldCheck, ShieldAlert, LogOut, Trash2, Plus, Copy, Check,
    Eye, EyeOff, ExternalLink, Pencil, AlertTriangle, X, ArrowLeft, GripVertical,
} from "lucide-react";
import { generatePassword, evaluatePasswordStrength } from "../lib/crypto";
import {
    digitsOnly, detectBrand, brandLabel, cvvLength, maxPanLength,
    formatCardNumber, maskCardNumber, last4, luhn, formatExpiry, checkExpiry,
} from "../lib/card";
import type { CardBrand } from "../lib/card";
import {
    generateTotpCode, totpTimeRemaining, normalizeSecretInput, isValidTotpSecret,
} from "../lib/totp";
import type { TotpAlgorithm } from "../lib/totp";
import { getSession, logout, changeMasterPassword, AuthError } from "../lib/auth-client";
import { useVault } from "../hooks/useVault";
import type { VaultEntry } from "../lib/crypto";
import "./VaultPage.css";

// ─────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────

type Category = "all" | "login" | "card" | "note";

export interface VaultEntryExtended extends VaultEntry {
    category: Category;
    url?:     string;
    tags?:    string[];
    favicon?: string;

    // ── Champ 2FA / TOTP (login uniquement) ─────────────
    totpSecret?:    string;         // base32 normalisé
    totpAlgorithm?: TotpAlgorithm;  // omis = "SHA-1"
    totpDigits?:    number;         // omis = 6
    totpPeriod?:    number;         // omis = 30

    // ── Champs carte bancaire ──────────────────────────
    cardholder?: string;              // Titulaire, tel qu'imprimé, en majuscules
    cardNumber?: string;              // PAN stocké SANS espaces (chiffres uniquement)
    cardExpiry?: string;              // 4 chiffres "MMYY", sans slash
    cardCvv?:    string;              // 3 chiffres, 4 pour Amex
    cardPin?:    string;              // optionnel, 4 à 6 chiffres
    cardBank?:   string;              // banque émettrice, texte libre
    cardBrand?:  CardBrand;           // dérivé à la sauvegarde, mis en cache
    cardType?:   "credit" | "debit";
}

// ─────────────────────────────────────────────────────────
// COMPOSANT PRINCIPAL
// ─────────────────────────────────────────────────────────

export default function VaultPage() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();

    // ── Hook vault — chargement, chiffrement, sauvegarde ───
    const { entries, status, error: vaultError, saveVault, deleteVault } = useVault();
    const typedEntries = entries as VaultEntryExtended[];

    // ── État local UI ──────────────────────────────────────
    const [selected,     setSelected]     = useState<VaultEntryExtended | null>(null);
    const [category,     setCategory]     = useState<Category>("all");
    // Préremplit la recherche si on arrive depuis l'audit de sécurité (?q=...)
    const [search,       setSearch]       = useState(() => searchParams.get("q") ?? "");

    const [showModal,    setShowModal]    = useState(false);
    const [showGenerator, setShowGenerator] = useState(false);
    const [editEntry,    setEditEntry]    = useState<VaultEntryExtended | null>(null);
    const [showPassword, setShowPassword] = useState(false);
    const [showNotes,    setShowNotes]    = useState(false);
    const [copied,       setCopied]       = useState<string | null>(null);
    const [showConfirmDelete,        setShowConfirmDelete]        = useState(false);
    const [showConfirmDeleteAccount, setShowConfirmDeleteAccount] = useState(false);
    const [deleteAccountInput,       setDeleteAccountInput]       = useState("");
    const [showChangePassword,       setShowChangePassword]       = useState(false);
    const [draggedId,   setDraggedId]   = useState<string | null>(null);
    const [dragOverId,  setDragOverId]  = useState<string | null>(null);

    const saving  = status === "saving";
    const loading = status === "loading";

    // ── Filtrage ───────────────────────────────────────────

    const filtered = useMemo(() => {
        return typedEntries.filter((e) => {
            const matchCat = category === "all" || e.category === category;
            const q = search.toLowerCase();
            const matchSearch =
                !q ||
                e.label.toLowerCase().includes(q) ||
                e.username?.toLowerCase().includes(q) ||
                e.url?.toLowerCase().includes(q) ||
                e.tags?.some((t) => t.toLowerCase().includes(q)) ||
                e.cardholder?.toLowerCase().includes(q) ||
                e.cardBank?.toLowerCase().includes(q) ||
                last4(e.cardNumber ?? "").includes(q);
            return matchCat && matchSearch;
        });
    }, [typedEntries, category, search]);

    const counts = useMemo(() => ({
        all:   typedEntries.length,
        login: typedEntries.filter((e) => e.category === "login").length,
        card:  typedEntries.filter((e) => e.category === "card").length,
        note:  typedEntries.filter((e) => e.category === "note").length,
    }), [typedEntries]);

    // ── Actions ────────────────────────────────────────────

    async function copyToClipboard(text: string, field: string) {
        await navigator.clipboard.writeText(text);
        setCopied(field);
        setTimeout(() => setCopied(null), 2000);
        // Effacement automatique du presse-papier après 30s
        setTimeout(() => navigator.clipboard.writeText(""), 30_000);
    }

    async function deleteEntry(id: string) {
        const updated = typedEntries.filter((e) => e.id !== id);
        await saveVault(updated);
        if (selected?.id === id) setSelected(null);
    }

    // Réordonne le vault en déplaçant `draggedEntryId` juste avant `targetId`.
    // L'ordre du tableau est ce qui est persisté (chiffré) via saveVault -
    // c'est donc lui qui définit l'ordre d'affichage à la prochaine connexion.
    async function reorderEntries(draggedEntryId: string, targetId: string) {
        if (draggedEntryId === targetId) return;
        const list = [...typedEntries];
        const fromIndex = list.findIndex((e) => e.id === draggedEntryId);
        if (fromIndex === -1) return;
        const [moved] = list.splice(fromIndex, 1);
        const toIndex = list.findIndex((e) => e.id === targetId);
        if (toIndex === -1) return;
        list.splice(toIndex, 0, moved);
        await saveVault(list);
    }

    async function handleLogout() {
        await logout();
        navigate("/login");
    }

    const strengthResult = selected && selected.category === "login" && selected.password
        ? evaluatePasswordStrength(selected.password)
        : null;

    // ── État de chargement ─────────────────────────────────

    if (loading) {
        return (
            <div className="vault-loading">
                <Shield className="loading-mark" size={28} strokeWidth={1.75} />
                <p>Déchiffrement du vault…</p>
            </div>
        );
    }

    if (vaultError && status === "error") {
        return (
            <div className="vault-loading">
                <AlertTriangle className="loading-mark loading-mark-danger" size={28} strokeWidth={1.75} />
                <p className="loading-text-danger">{vaultError}</p>
                <button className="btn-primary" style={{ marginTop: "16px" }} onClick={() => window.location.reload()}>
                    Réessayer
                </button>
            </div>
        );
    }

    return (
        <div className="vault-layout">

            {/* ── SIDEBAR ──────────────────────────────────────── */}
            <aside className="vault-sidebar">
                <div className="sidebar-logo">
                    <span className="logo-mark"><Shield size={17} strokeWidth={2} /></span>
                    <div>
                        <div className="logo-name">Aegis</div>
                        <div className="logo-tagline">Password Vault</div>
                    </div>
                </div>

                <div className="sidebar-search">
                    <Search className="search-icon" size={15} strokeWidth={2} />
                    <input
                        placeholder="Rechercher..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>

                <nav className="sidebar-nav">
                    <div className="nav-section-label">Vault</div>
                    {(["all", "login", "card", "note"] as const).map((cat) => {
                        const CatIcon = CATEGORY_ICONS[cat];
                        return (
                            <button
                                key={cat}
                                className={`nav-item ${category === cat ? "active" : ""}`}
                                onClick={() => setCategory(cat)}
                            >
                                <span className="nav-icon"><CatIcon size={15} strokeWidth={2} /></span>
                                <span className="nav-label">{CATEGORY_LABELS[cat]}</span>
                                <span className="nav-count">{counts[cat]}</span>
                            </button>
                        );
                    })}

                    <div className="nav-section-label">Outils</div>
                    <button
                        className="nav-item nav-item-extra"
                        onClick={() => setShowGenerator(true)}
                    >
                        <span className="nav-icon"><RefreshCw size={15} strokeWidth={2} /></span>
                        <span className="nav-label">Générateur</span>
                    </button>

                    <div className="nav-section-label">Audit</div>
                    <button
                        className="nav-item nav-item-extra"
                        onClick={() => navigate("/security")}
                    >
                        <span className="nav-icon"><ShieldAlert size={15} strokeWidth={2} /></span>
                        <span className="nav-label">Analyse du vault</span>
                    </button>

                    <div className="nav-section-label">Sessions</div>
                    <button
                        className="nav-item nav-item-extra"
                        onClick={() => navigate("/sessions")}
                    >
                        <span className="nav-icon"><ShieldCheck size={15} strokeWidth={2} /></span>
                        <span className="nav-label">Sécurité</span>
                    </button>
                </nav>

                <div className="sidebar-footer">
                    <div className="user-pill">
                        <div className="user-avatar">
                            {getSession()?.email?.[0]?.toUpperCase() ?? "?"}
                        </div>
                        <span className="user-email">{getSession()?.email}</span>
                        <button
                            className="icon-btn sidebar-logout-btn"
                            title="Déconnexion"
                            onClick={handleLogout}
                        >
                            <LogOut size={14} strokeWidth={2} />
                        </button>
                    </div>
                    <button
                        className="btn-change-password"
                        onClick={() => setShowChangePassword(true)}
                    >
                        <KeyRound size={13} strokeWidth={2} /> Changer le mot de passe
                    </button>
                    <button
                        className="btn-delete-account"
                        onClick={() => { setDeleteAccountInput(""); setShowConfirmDeleteAccount(true); }}
                    >
                        <Trash2 size={13} strokeWidth={2} /> Supprimer le compte
                    </button>
                </div>
            </aside>

            {/* ── LISTE DES ENTRÉES ─────────────────────────────── */}
            <main className="vault-main">
                <div className="main-topbar">
                    <h1 className="topbar-title">{CATEGORY_LABELS[category]}</h1>
                    <div className="topbar-actions">
                        {saving  && <span className="saving-indicator">Sauvegarde…</span>}
                        {vaultError && !saving && (
                            <span className="saving-indicator saving-indicator-danger">
                                <AlertTriangle size={12} strokeWidth={2} /> Erreur de sauvegarde
                            </span>
                        )}
                        <button
                            className="btn-primary"
                            onClick={() => { setEditEntry(null); setShowModal(true); }}
                            disabled={saving}
                        >
                            <Plus size={15} strokeWidth={2.25} /> <span>Ajouter</span>
                        </button>
                        <button
                            className="icon-btn mobile-tool-btn"
                            title="Générateur"
                            onClick={() => setShowGenerator(true)}
                        >
                            <RefreshCw size={16} strokeWidth={2} />
                        </button>
                        <button
                            className="icon-btn mobile-tool-btn"
                            title="Analyse du vault"
                            onClick={() => navigate("/security")}
                        >
                            <ShieldAlert size={16} strokeWidth={2} />
                        </button>
                        <button
                            className="icon-btn mobile-tool-btn"
                            title="Sécurité"
                            onClick={() => navigate("/sessions")}
                        >
                            <ShieldCheck size={16} strokeWidth={2} />
                        </button>
                        <button
                            className="icon-btn mobile-logout-btn"
                            title="Déconnexion"
                            onClick={handleLogout}
                        >
                            <LogOut size={16} strokeWidth={2} />
                        </button>
                    </div>
                </div>

                <div className="topbar-search-mobile">
                    <Search className="search-icon" size={14} strokeWidth={2} />
                    <input
                        placeholder="Rechercher..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>

                <div className="entry-list">
                    {filtered.length === 0 ? (
                        <EmptyState search={search} />
                    ) : (
                        filtered.map((entry) => (
                            <EntryCard
                                key={entry.id}
                                entry={entry}
                                active={selected?.id === entry.id}
                                onClick={() => { setSelected(entry); setShowPassword(false); setShowNotes(false); }}
                                reorderable={!search}
                                dragging={draggedId === entry.id}
                                dragOver={dragOverId === entry.id && draggedId !== entry.id}
                                onDragStart={() => setDraggedId(entry.id)}
                                onDragEnter={() => { if (draggedId) setDragOverId(entry.id); }}
                                onDragEnd={() => { setDraggedId(null); setDragOverId(null); }}
                                onDrop={() => {
                                    if (draggedId) reorderEntries(draggedId, entry.id);
                                    setDraggedId(null);
                                    setDragOverId(null);
                                }}
                            />
                        ))
                    )}
                </div>
            </main>

            {/* ── PANNEAU DE DÉTAIL ─────────────────────────────── */}
            {selected ? (
                <aside className="vault-detail">
                    <button
                        className="mobile-back-btn"
                        onClick={() => setSelected(null)}
                    >
                        <ArrowLeft size={15} strokeWidth={2} /> Retour
                    </button>
                    <div className="detail-header">
                        <div className="detail-icon-wrap">
                            <div className={`detail-icon cat-${selected.category}`}>{getInitial(selected)}</div>
                            <div>
                                <div className="detail-name">{selected.label}</div>
                                {selected.url && (() => {
                                    try { return <div className="detail-url">{new URL(selected.url).hostname}</div>; }
                                    catch { return <div className="detail-url">{selected.url}</div>; }
                                })()}
                            </div>
                        </div>
                    </div>

                    <div className="detail-body">
                        {selected.category === "login" && (
                            <>
                                <Field label="Identifiant">
                                    <div className="field-value-row">
                                        <span className="field-mono">{selected.username}</span>
                                        <button
                                            className={`icon-btn ${copied === "user" ? "copied" : ""}`}
                                            onClick={() => copyToClipboard(selected.username ?? "", "user")}
                                            title="Copier"
                                        >
                                            {copied === "user" ? <Check size={14} strokeWidth={2.25} /> : <Copy size={14} strokeWidth={2} />}
                                        </button>
                                    </div>
                                </Field>

                                <Field label="Mot de passe">
                                    <div className="field-value-row">
                        <span className={`field-mono ${showPassword ? "password-visible" : "password-hidden"}`}>
                          {showPassword
                              ? selected.password
                              : "•".repeat(Math.min((selected.password ?? "").length, 16))}
                        </span>
                                        <div className="icon-btn-group">
                                            <button
                                                className="icon-btn"
                                                onClick={() => setShowPassword((v) => !v)}
                                                title={showPassword ? "Masquer" : "Afficher"}
                                            >
                                                {showPassword ? <EyeOff size={14} strokeWidth={2} /> : <Eye size={14} strokeWidth={2} />}
                                            </button>
                                            <button
                                                className={`icon-btn ${copied === "pass" ? "copied" : ""}`}
                                                onClick={() => copyToClipboard(selected.password ?? "", "pass")}
                                                title="Copier"
                                            >
                                                {copied === "pass" ? <Check size={14} strokeWidth={2.25} /> : <Copy size={14} strokeWidth={2} />}
                                            </button>
                                        </div>
                                    </div>
                                    {strengthResult && (
                                        <StrengthBar score={strengthResult.score} entropy={strengthResult.entropy} />
                                    )}
                                </Field>

                                {selected.totpSecret && (
                                    <TotpField
                                        key={selected.id}
                                        entry={selected}
                                        copied={copied}
                                        copyToClipboard={copyToClipboard}
                                    />
                                )}

                                {selected.url && (
                                    <Field label="URL">
                                        <div className="field-value-row">
                                            <a
                                                className="field-link"
                                                href={selected.url}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                            >
                                                {selected.url}
                                            </a>
                                            <button className="icon-btn"><ExternalLink size={13} strokeWidth={2} /></button>
                                        </div>
                                    </Field>
                                )}
                            </>
                        )}

                        {selected.category === "card" && (
                            <CardDetail
                                key={selected.id}
                                entry={selected}
                                copied={copied}
                                copyToClipboard={copyToClipboard}
                            />
                        )}

                        {selected.notes && (
                            <Field label="Notes">
                                <div className="field-notes-row">
                                    <div className="field-notes-box">
                                        {showNotes ? (
                                            <p className="field-notes">{selected.notes}</p>
                                        ) : (
                                            <p className="field-notes field-notes-hidden">Contenu masqué</p>
                                        )}
                                    </div>
                                    <div className="icon-btn-group field-notes-actions">
                                        <button
                                            className="icon-btn"
                                            onClick={() => setShowNotes((v) => !v)}
                                            title={showNotes ? "Masquer" : "Afficher"}
                                        >
                                            {showNotes ? <EyeOff size={14} strokeWidth={2} /> : <Eye size={14} strokeWidth={2} />}
                                        </button>
                                        <button
                                            className={`icon-btn ${copied === "notes" ? "copied" : ""}`}
                                            onClick={() => copyToClipboard(selected.notes ?? "", "notes")}
                                            title="Copier"
                                        >
                                            {copied === "notes" ? <Check size={14} strokeWidth={2.25} /> : <Copy size={14} strokeWidth={2} />}
                                        </button>
                                    </div>
                                </div>
                            </Field>
                        )}

                        {selected.tags && selected.tags.length > 0 && (
                            <Field label="Tags">
                                <div className="tag-list">
                                    {selected.tags.map((tag) => (
                                        <span key={tag} className="tag">{tag}</span>
                                    ))}
                                </div>
                            </Field>
                        )}

                        <div className="detail-meta">
                            <span>Créé le {formatDate(selected.createdAt)}</span>
                            <span>Modifié le {formatDate(selected.updatedAt)}</span>
                        </div>
                    </div>

                    <div className="detail-footer">
                        <button
                            className="btn-edit"
                            onClick={() => { setEditEntry(selected); setShowModal(true); }}
                            disabled={saving}
                        >
                            <Pencil size={13} strokeWidth={2} /> Modifier
                        </button>
                        <button
                            className="btn-delete"
                            onClick={() => setShowConfirmDelete(true)}
                            title="Supprimer"
                            disabled={saving}
                        >
                            <Trash2 size={14} strokeWidth={2} />
                        </button>
                    </div>
                </aside>
            ) : (
                <aside className="vault-detail vault-detail-empty">
                    <div className="detail-placeholder">
                        <Shield className="placeholder-icon" size={30} strokeWidth={1.5} />
                        <p>Sélectionne une entrée</p>
                    </div>
                </aside>
            )}

            {/* ── MODAL AJOUT / ÉDITION ─────────────────────────── */}
            {showModal && (
                <EntryModal
                    entry={editEntry}
                    defaultCategory={category === "card" ? "card" : category === "note" ? "note" : "login"}
                    onClose={() => setShowModal(false)}
                    onSave={async (data) => {
                        const now = Date.now();
                        let updated: VaultEntryExtended[];
                        if (editEntry) {
                            updated = typedEntries.map((e) =>
                                e.id === editEntry.id ? { ...e, ...data, updatedAt: now } : e
                            );
                            setSelected(updated.find((e) => e.id === editEntry.id) ?? null);
                        } else {
                            const newEntry: VaultEntryExtended = {
                                ...data,
                                id:        crypto.randomUUID(),
                                createdAt: now,
                                updatedAt: now,
                            };
                            updated = [...typedEntries, newEntry];
                            setSelected(newEntry);
                        }
                        await saveVault(updated);
                        setShowModal(false);
                    }}
                />
            )}

            {/* ── MODAL CHANGEMENT DE MOT DE PASSE MAÎTRE ───────── */}
            {showChangePassword && (
                <ChangePasswordModal
                    vaultEntries={typedEntries}
                    onClose={() => setShowChangePassword(false)}
                    onSuccess={() => navigate("/login")}
                />
            )}

            {/* ── MODAL GÉNÉRATEUR DE MOT DE PASSE ──────────────── */}
            {showGenerator && (
                <PasswordGeneratorModal onClose={() => setShowGenerator(false)} />
            )}

            {/* ── MODAL CONFIRMATION SUPPRESSION ───────────────── */}
            {showConfirmDelete && selected && (
                <div className="modal-overlay" onClick={() => setShowConfirmDelete(false)}>
                    <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Supprimer cette entrée ?</h2>
                            <button className="modal-close" onClick={() => setShowConfirmDelete(false)}><X size={15} strokeWidth={2} /></button>
                        </div>
                        <div className="modal-body">
                            <p className="confirm-text">
                                <strong>{selected.label}</strong> sera supprimé définitivement.
                                Cette action est irréversible.
                            </p>
                            <div className="modal-actions">
                                <button className="btn-secondary" onClick={() => setShowConfirmDelete(false)}>
                                    Annuler
                                </button>
                                <button
                                    className="btn-delete btn-delete-solid"
                                    onClick={async () => {
                                        await deleteEntry(selected.id);
                                        setShowConfirmDelete(false);
                                    }}
                                >
                                    Supprimer
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* ── MODAL CONFIRMATION SUPPRESSION COMPTE ─────────── */}
            {showConfirmDeleteAccount && (
                <div className="modal-overlay" onClick={() => setShowConfirmDeleteAccount(false)}>
                    <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2 className="modal-title-danger">
                                <AlertTriangle size={16} strokeWidth={2} /> Supprimer le compte
                            </h2>
                            <button className="modal-close" onClick={() => setShowConfirmDeleteAccount(false)}><X size={15} strokeWidth={2} /></button>
                        </div>
                        <div className="modal-body">
                            <p className="confirm-text">
                                Cette action supprime <strong>définitivement</strong> votre
                                compte et l'intégralité de votre vault. Aucune récupération n'est possible - le serveur
                                ne conserve aucune copie de vos données en clair.
                            </p>
                            <p className="confirm-subtext">
                                Tapez <strong className="confirm-keyword">SUPPRIMER</strong> pour confirmer.
                            </p>
                            <input
                                className="confirm-input"
                                value={deleteAccountInput}
                                onChange={(e) => setDeleteAccountInput(e.target.value)}
                                placeholder="SUPPRIMER"
                                autoFocus
                            />
                            <div className="modal-actions">
                                <button className="btn-secondary" onClick={() => setShowConfirmDeleteAccount(false)}>
                                    Annuler
                                </button>
                                <button
                                    className="btn-delete btn-delete-solid"
                                    disabled={deleteAccountInput !== "SUPPRIMER"}
                                    onClick={async () => {
                                        await deleteVault();
                                        navigate("/login");
                                    }}
                                >
                                    Supprimer définitivement
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
}

// ─────────────────────────────────────────────────────────
// SOUS-COMPOSANTS
// ─────────────────────────────────────────────────────────

function EntryCard({
                       entry, active, onClick,
                       reorderable, dragging, dragOver,
                       onDragStart, onDragEnter, onDragEnd, onDrop,
                   }: {
    entry: VaultEntryExtended;
    active: boolean;
    onClick: () => void;
    reorderable: boolean;
    dragging: boolean;
    dragOver: boolean;
    onDragStart: () => void;
    onDragEnter: () => void;
    onDragEnd: () => void;
    onDrop: () => void;
}) {
    return (
        <div
            className={`entry-card ${active ? "active" : ""} ${dragging ? "dragging" : ""} ${dragOver ? "drag-over" : ""}`}
            onClick={onClick}
            draggable={reorderable}
            onDragStart={onDragStart}
            onDragEnter={onDragEnter}
            onDragOver={(e) => e.preventDefault()}
            onDragEnd={onDragEnd}
            onDrop={(e) => { e.preventDefault(); onDrop(); }}
        >
            {reorderable && (
                <span className="entry-drag-handle" title="Glisser pour réordonner">
                    <GripVertical size={14} strokeWidth={2} />
                </span>
            )}
            <div className={`entry-icon-wrap cat-${entry.category}`}>
                {getInitial(entry)}
            </div>
            <div className="entry-info">
                <div className="entry-label">{entry.label}</div>
                <div className="entry-username">
                    {entrySubtitle(entry)}
                    {entry.category === "login" && entry.totpSecret && (
                        <ShieldCheck size={11} strokeWidth={2} className="entry-2fa-badge" />
                    )}
                </div>
            </div>
            <div className="entry-date">{formatDate(entry.updatedAt, true)}</div>
        </div>
    );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <div className="detail-field">
            <div className="field-label">{label}</div>
            <div className="field-content">{children}</div>
        </div>
    );
}

function TotpField({
                        entry, copied, copyToClipboard,
                    }: {
    entry: VaultEntryExtended;
    copied: string | null;
    copyToClipboard: (text: string, field: string) => void;
}) {
    const [code, setCode] = useState("------");
    const [remaining, setRemaining] = useState(0);

    const period = entry.totpPeriod ?? 30;

    useEffect(() => {
        let cancelled = false;
        const config = {
            secret:    entry.totpSecret!,
            algorithm: entry.totpAlgorithm ?? "SHA-1" as const,
            digits:    entry.totpDigits ?? 6,
            period,
        };

        async function tick() {
            try {
                const c = await generateTotpCode(config);
                if (!cancelled) setCode(c);
            } catch {
                if (!cancelled) setCode("------");
            }
            if (!cancelled) setRemaining(totpTimeRemaining(config));
        }

        tick();
        const interval = setInterval(tick, 1000);
        return () => { cancelled = true; clearInterval(interval); };
    }, [entry.totpSecret, entry.totpAlgorithm, entry.totpDigits, period]);

    return (
        <Field label="Code d'authentification (2FA)">
            <div className="field-value-row">
                <span className="field-mono totp-code">
                    {code.match(/.{1,3}/g)?.join(" ") ?? code}
                </span>
                <div className="icon-btn-group">
                    <button
                        className={`icon-btn ${copied === "totp" ? "copied" : ""}`}
                        onClick={() => copyToClipboard(code, "totp")}
                        title="Copier"
                    >
                        {copied === "totp" ? <Check size={14} strokeWidth={2.25} /> : <Copy size={14} strokeWidth={2} />}
                    </button>
                </div>
            </div>
            <div className="totp-countdown">
                <div className="totp-countdown-bar" style={{ width: `${(remaining / period) * 100}%` }} />
            </div>
        </Field>
    );
}

function CardDetail({
                         entry, copied, copyToClipboard,
                     }: {
    entry: VaultEntryExtended;
    copied: string | null;
    copyToClipboard: (text: string, field: string) => void;
}) {
    const [revealed, setRevealed] = useState(false);

    // Re-masquage automatique après 30 secondes
    useEffect(() => {
        if (!revealed) return;
        const timer = setTimeout(() => setRevealed(false), 30_000);
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
                        <button
                            className={`icon-btn ${copied === "cardNumber" ? "copied" : ""}`}
                            onClick={() => copyToClipboard(digitsOnly(pan), "cardNumber")}
                            title="Copier"
                        >
                            {copied === "cardNumber" ? <Check size={14} strokeWidth={2.25} /> : <Copy size={14} strokeWidth={2} />}
                        </button>
                    </div>
                </div>
            </Field>

            {entry.cardCvv && (
                <Field label="Cryptogramme">
                    <div className="field-value-row">
                        <span className="field-mono">
                            {revealed ? entry.cardCvv : "•".repeat(entry.cardCvv.length)}
                        </span>
                        <button
                            className={`icon-btn ${copied === "cvv" ? "copied" : ""}`}
                            onClick={() => copyToClipboard(entry.cardCvv ?? "", "cvv")}
                            title="Copier"
                        >
                            {copied === "cvv" ? <Check size={14} strokeWidth={2.25} /> : <Copy size={14} strokeWidth={2} />}
                        </button>
                    </div>
                </Field>
            )}

            {entry.cardPin && (
                <Field label="Code PIN">
                    <div className="field-value-row">
                        <span className="field-mono">
                            {revealed ? entry.cardPin : "•".repeat(entry.cardPin.length)}
                        </span>
                        <button
                            className={`icon-btn ${copied === "pin" ? "copied" : ""}`}
                            onClick={() => copyToClipboard(entry.cardPin ?? "", "pin")}
                            title="Copier"
                        >
                            {copied === "pin" ? <Check size={14} strokeWidth={2.25} /> : <Copy size={14} strokeWidth={2} />}
                        </button>
                    </div>
                </Field>
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

function StrengthBar({ score, entropy }: { score: number; entropy: number }) {
    const labels = ["Très faible", "Faible", "Correct", "Fort", "Très fort"];
    const colors = ["#C85050", "#E8803A", "#C9A84C", "#70B870", "#50C890"];
    return (
        <div className="strength-wrap">
            <div className="strength-bars">
                {[0, 1, 2, 3, 4].map((i) => (
                    <div
                        key={i}
                        className="strength-bar"
                        style={{ background: i <= score ? colors[score] : "#1E2233" }}
                    />
                ))}
            </div>
            <span className="strength-label" style={{ color: colors[score] }}>
        {labels[score]} · {entropy} bits
      </span>
        </div>
    );
}

function EmptyState({ search }: { search: string }) {
    return (
        <div className="empty-state">
            <Shield className="empty-icon" size={30} strokeWidth={1.5} />
            <p>{search ? `Aucun résultat pour "${search}"` : "Aucune entrée dans cette catégorie"}</p>
        </div>
    );
}

// ─────────────────────────────────────────────────────────
// MODAL CHANGEMENT DE MOT DE PASSE MAÎTRE
// ─────────────────────────────────────────────────────────

function ChangePasswordModal({
                                  vaultEntries, onClose, onSuccess,
                              }: {
    vaultEntries: VaultEntry[];
    onClose: () => void;
    onSuccess: () => void;
}) {
    const [currentPassword, setCurrentPassword] = useState("");
    const [newPassword,     setNewPassword]     = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [loading, setLoading] = useState(false);
    const [error,   setError]   = useState<string | null>(null);

    const strength = newPassword ? evaluatePasswordStrength(newPassword) : null;

    function validate(): string | null {
        if (!currentPassword) return "Le mot de passe actuel est requis.";
        if (newPassword.length < 12) return "Le nouveau mot de passe doit faire au moins 12 caractères.";
        if (strength && strength.score < 2) return "Nouveau mot de passe trop faible - ajoutez majuscules, chiffres et symboles.";
        if (newPassword !== confirmPassword) return "Les mots de passe ne correspondent pas.";
        if (newPassword === currentPassword) return "Le nouveau mot de passe doit être différent de l'actuel.";
        return null;
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        const validationError = validate();
        if (validationError) { setError(validationError); return; }

        setLoading(true);
        setError(null);
        try {
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
                        {newPassword && strength && (
                            <StrengthBar score={strength.score} entropy={strength.entropy} />
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

// ─────────────────────────────────────────────────────────
// MODAL GÉNÉRATEUR DE MOT DE PASSE (outil autonome)
// ─────────────────────────────────────────────────────────

function PasswordGeneratorModal({ onClose }: { onClose: () => void }) {
    const [length,           setLength]           = useState(20);
    const [uppercase,        setUppercase]        = useState(true);
    const [lowercase,        setLowercase]        = useState(true);
    const [numbers,          setNumbers]          = useState(true);
    const [symbols,          setSymbols]          = useState(true);
    const [excludeAmbiguous, setExcludeAmbiguous] = useState(false);
    const [nonce,            setNonce]            = useState(0);
    const [copiedPassword,   setCopiedPassword]   = useState<string | null>(null);

    const activeCharsets = [uppercase, lowercase, numbers, symbols].filter(Boolean).length;

    // `nonce` n'est pas lu dans le callback : il force juste une nouvelle valeur au clic sur "Régénérer"
    const password = useMemo(
        () => generatePassword({ length, uppercase, lowercase, numbers, symbols, excludeAmbiguous }),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [length, uppercase, lowercase, numbers, symbols, excludeAmbiguous, nonce],
    );
    const copied = copiedPassword === password;

    function regenerate() {
        setNonce((n) => n + 1);
    }

    async function handleCopy() {
        await navigator.clipboard.writeText(password);
        setCopiedPassword(password);
        setTimeout(() => setCopiedPassword((p) => (p === password ? null : p)), 2000);
        setTimeout(() => navigator.clipboard.writeText(""), 30_000);
    }

    function toggleCharset(current: boolean, setter: (v: boolean) => void) {
        if (current && activeCharsets <= 1) return; // au moins un jeu de caractères actif
        setter(!current);
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

                    <div className="form-row">
                        <label>Longueur - {length} caractères</label>
                        <input
                            type="range"
                            min={8}
                            max={64}
                            value={length}
                            className="generator-range"
                            onChange={(e) => setLength(Number(e.target.value))}
                        />
                    </div>

                    <div className="generator-options">
                        <label className="generator-toggle">
                            <input
                                type="checkbox"
                                checked={uppercase}
                                onChange={() => toggleCharset(uppercase, setUppercase)}
                            />
                            Majuscules (A-Z)
                        </label>
                        <label className="generator-toggle">
                            <input
                                type="checkbox"
                                checked={lowercase}
                                onChange={() => toggleCharset(lowercase, setLowercase)}
                            />
                            Minuscules (a-z)
                        </label>
                        <label className="generator-toggle">
                            <input
                                type="checkbox"
                                checked={numbers}
                                onChange={() => toggleCharset(numbers, setNumbers)}
                            />
                            Chiffres (0-9)
                        </label>
                        <label className="generator-toggle">
                            <input
                                type="checkbox"
                                checked={symbols}
                                onChange={() => toggleCharset(symbols, setSymbols)}
                            />
                            Symboles (!@#$…)
                        </label>
                        <label className="generator-toggle">
                            <input
                                type="checkbox"
                                checked={excludeAmbiguous}
                                onChange={() => setExcludeAmbiguous((v) => !v)}
                            />
                            Exclure les caractères ambigus (0, O, l, 1, I)
                        </label>
                    </div>

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

// ─────────────────────────────────────────────────────────
// MODAL AJOUT / ÉDITION
// ─────────────────────────────────────────────────────────

type EntryFormData = Omit<VaultEntryExtended, "id" | "createdAt" | "updatedAt">;

function EntryModal({
                        entry, defaultCategory, onClose, onSave,
                    }: {
    entry: VaultEntryExtended | null;
    defaultCategory: "login" | "card" | "note";
    onClose: () => void;
    onSave: (data: EntryFormData) => Promise<void>;
}) {
    const [form, setForm] = useState<EntryFormData>({
        label:      entry?.label      ?? "",
        username:   entry?.username   ?? "",
        password:   entry?.password   ?? "",
        url:        entry?.url        ?? "",
        notes:      entry?.notes      ?? "",
        category:   entry?.category   ?? defaultCategory,
        tags:       entry?.tags       ?? [],
        totpSecret: entry?.totpSecret ?? "",
        cardholder: entry?.cardholder ?? "",
        cardNumber: entry?.cardNumber ?? "",
        cardExpiry: entry?.cardExpiry ?? "",
        cardCvv:    entry?.cardCvv    ?? "",
        cardPin:    entry?.cardPin    ?? "",
        cardBank:   entry?.cardBank   ?? "",
        cardType:   entry?.cardType   ?? "credit",
    });
    const [showPass,   setShowPass]   = useState(false);
    const [showSecret, setShowSecret] = useState(false); // CVV + PIN, œil partagé
    const [saving,     setSaving]     = useState(false);
    const [tagsInput,  setTagsInput]  = useState(entry?.tags?.join(", ") ?? "");
    const [formError,  setFormError]  = useState<string | null>(null);
    const [totpInputError, setTotpInputError] = useState<string | null>(null);

    const strength = form.category === "login" ? evaluatePasswordStrength(form.password ?? "") : null;

    const panDigits    = digitsOnly(form.cardNumber ?? "");
    const brand        = detectBrand(panDigits);
    const panInvalid   = panDigits.length >= 12 && !luhn(panDigits);
    const expiryStatus = checkExpiry(form.cardExpiry ?? "");

    function handleGenerate() {
        const pwd = generatePassword({ length: 20, symbols: true });
        setForm((f) => ({ ...f, password: pwd }));
        setShowPass(true);
    }

    function validate(): string | null {
        if (!form.label.trim()) return "Le nom est requis.";

        if (form.category === "login") {
            if (!form.username?.trim()) return "L'identifiant est requis.";
            if (!form.password)         return "Le mot de passe est requis.";
            if (form.totpSecret?.trim() && !isValidTotpSecret(form.totpSecret)) {
                return "La clé secrète 2FA est invalide.";
            }
        }

        if (form.category === "card") {
            if (!panDigits)   return "Le numéro de carte est requis.";
            if (!luhn(panDigits)) return "Numéro de carte invalide.";

            const expiry = digitsOnly(form.cardExpiry ?? "");
            if (!expiry)             return "La date d'expiration est requise.";
            if (expiry.length !== 4) return "Date d'expiration invalide (format MM/AA).";
            const month = Number(expiry.slice(0, 2));
            if (month < 1 || month > 12) return "Le mois d'expiration doit être compris entre 01 et 12.";

            if (form.cardCvv && form.cardCvv.length !== cvvLength(brand)) {
                return `Le cryptogramme doit contenir ${cvvLength(brand)} chiffres.`;
            }
        }

        if (form.category === "note" && !form.notes?.trim()) return "Le contenu de la note est requis.";

        return null;
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        const err = validate();
        if (err) { setFormError(err); return; }
        setFormError(null);
        setSaving(true);

        const isLogin = form.category === "login";
        const isCard  = form.category === "card";

        const totpNormalized = isLogin && form.totpSecret?.trim()
            ? (() => { try { return normalizeSecretInput(form.totpSecret!); } catch { return null; } })()
            : null;

        try {
            await onSave({
                ...form,
                tags:          tagsInput.split(",").map((t) => t.trim()).filter(Boolean),
                username:      isLogin ? form.username : undefined,
                password:      isLogin ? form.password : undefined,
                url:           isLogin ? form.url : undefined,
                totpSecret:    totpNormalized?.secret,
                totpAlgorithm: totpNormalized?.algorithm,
                totpDigits:    totpNormalized?.digits,
                totpPeriod:    totpNormalized?.period,
                cardholder: isCard ? ((form.cardholder ?? "").trim().toUpperCase() || undefined) : undefined,
                cardNumber: isCard ? (panDigits || undefined) : undefined,
                cardExpiry: isCard ? (digitsOnly(form.cardExpiry ?? "") || undefined) : undefined,
                cardCvv:    isCard ? (form.cardCvv || undefined) : undefined,
                cardPin:    isCard ? (form.cardPin || undefined) : undefined,
                cardBank:   isCard ? (form.cardBank || undefined) : undefined,
                cardBrand:  isCard ? brand : undefined,
                cardType:   isCard ? form.cardType : undefined,
            });
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
                            {(["login", "card", "note"] as const).map((cat) => {
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
                                    <button type="button" className="icon-btn" onClick={() => setShowPass((v) => !v)}>
                                        {showPass ? <EyeOff size={14} strokeWidth={2} /> : <Eye size={14} strokeWidth={2} />}
                                    </button>
                                    <button
                                        type="button"
                                        className="icon-btn generate-btn"
                                        onClick={handleGenerate}
                                        title="Générer un mot de passe fort"
                                    >
                                        <RefreshCw size={14} strokeWidth={2} />
                                    </button>
                                </div>
                                {form.password && strength && (
                                    <StrengthBar score={strength.score} entropy={strength.entropy} />
                                )}
                            </div>

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
                                    onBlur={() => {
                                        if (!form.totpSecret?.trim()) return;
                                        try {
                                            const norm = normalizeSecretInput(form.totpSecret);
                                            setForm((f) => ({ ...f, totpSecret: norm.secret }));
                                            setTotpInputError(null);
                                        } catch {
                                            setTotpInputError("Clé secrète invalide.");
                                        }
                                    }}
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
                    )}

                    {form.category === "card" && (
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
                                        <button type="button" className="icon-btn" onClick={() => setShowSecret((v) => !v)}>
                                            {showSecret ? <EyeOff size={14} strokeWidth={2} /> : <Eye size={14} strokeWidth={2} />}
                                        </button>
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
                                                ...f, cardPin: digitsOnly(e.target.value).slice(0, 6),
                                            }))}
                                            placeholder="Optionnel"
                                            inputMode="numeric"
                                            maxLength={6}
                                            autoComplete="off"
                                        />
                                        <button type="button" className="icon-btn" onClick={() => setShowSecret((v) => !v)}>
                                            {showSecret ? <EyeOff size={14} strokeWidth={2} /> : <Eye size={14} strokeWidth={2} />}
                                        </button>
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

// ─────────────────────────────────────────────────────────
// UTILITAIRES
// ─────────────────────────────────────────────────────────

const CATEGORY_ICONS: Record<Category, typeof LayoutGrid> = {
    all:   LayoutGrid,
    login: KeyRound,
    card:  CreditCard,
    note:  StickyNote,
};

const CATEGORY_LABELS: Record<Category, string> = {
    all:   "Tous les identifiants",
    login: "Connexions",
    card:  "Cartes",
    note:  "Notes",
};

function getInitial(entry: VaultEntryExtended): string {
    return entry.label.trim().charAt(0).toUpperCase() || "?";
}

function entrySubtitle(entry: VaultEntryExtended): string {
    if (entry.category === "card") {
        const l4  = last4(entry.cardNumber ?? "");
        const exp = entry.cardExpiry ? ` · ${formatExpiry(entry.cardExpiry)}` : "";
        return l4 ? `•••• ${l4}${exp}` : "Carte";
    }
    if (entry.category === "note") {
        return entry.notes?.split("\n")[0].slice(0, 48) || "Note vide";
    }
    return entry.username ?? "";
}

function formatDate(ts: number, short = false): string {
    const d   = new Date(ts);
    const now = new Date();
    if (short) {
        const diff = now.getTime() - d.getTime();
        if (diff < 86_400_000)  return "Auj.";
        if (diff < 172_800_000) return "Hier";
    }
    return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}
