/**
 * ╔═══════════════════════════════════════════════════════╗
 * ║           AEGIS — Interface du Vault (finale)         ║
 * ║           src/pages/VaultPage.tsx                     ║
 * ╚═══════════════════════════════════════════════════════╝
 *
 * Ajoute dans index.html <head> :
 * <link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
 */

import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { generatePassword, evaluatePasswordStrength } from "../lib/crypto";
import { getSession, logout } from "../lib/auth-client";
import { useVault } from "../hooks/useVault";
import type { VaultEntry } from "../lib/crypto";
import "./VaultPage.css";

// ─────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────

type Category = "all" | "login" | "card" | "note";

interface VaultEntryExtended extends VaultEntry {
    category: Category;
    url?: string;
    tags?: string[];
    favicon?: string;
}

// ─────────────────────────────────────────────────────────
// COMPOSANT PRINCIPAL
// ─────────────────────────────────────────────────────────

export default function VaultPage() {
    const navigate = useNavigate();

    // ── Hook vault — chargement, chiffrement, sauvegarde ───
    const { entries, status, error: vaultError, saveVault, deleteVault } = useVault();
    const typedEntries = entries as VaultEntryExtended[];

    // ── État local UI ──────────────────────────────────────
    const [selected,     setSelected]     = useState<VaultEntryExtended | null>(null);
    const [category,     setCategory]     = useState<Category>("all");
    const [search,       setSearch]       = useState("");
    const [showModal,    setShowModal]    = useState(false);
    const [editEntry,    setEditEntry]    = useState<VaultEntryExtended | null>(null);
    const [showPassword, setShowPassword] = useState(false);
    const [copied,       setCopied]       = useState<string | null>(null);
    const [showConfirmDelete,        setShowConfirmDelete]        = useState(false);
    const [showConfirmDeleteAccount, setShowConfirmDeleteAccount] = useState(false);
    const [deleteAccountInput,       setDeleteAccountInput]       = useState("");

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
                e.username.toLowerCase().includes(q) ||
                e.url?.toLowerCase().includes(q) ||
                e.tags?.some((t) => t.toLowerCase().includes(q));
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

    async function handleLogout() {
        await logout();
        navigate("/login");
    }

    const strengthResult = selected ? evaluatePasswordStrength(selected.password) : null;

    // ── État de chargement ─────────────────────────────────

    if (loading) {
        return (
            <div className="vault-loading">
                <span className="loading-hex">⬡</span>
                <p>Déchiffrement du vault…</p>
            </div>
        );
    }

    if (vaultError && status === "error") {
        return (
            <div className="vault-loading">
                <span className="loading-hex" style={{ color: "#C85050" }}>⚠</span>
                <p style={{ color: "#C85050" }}>{vaultError}</p>
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
                    <span className="logo-mark">⬡</span>
                    <div>
                        <div className="logo-name">AEGIS</div>
                        <div className="logo-tagline">Password Vault</div>
                    </div>
                </div>

                <div className="sidebar-search">
                    <span className="search-icon">⌕</span>
                    <input
                        placeholder="Rechercher..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>

                <nav className="sidebar-nav">
                    <div className="nav-section-label">Vault</div>
                    {(["all", "login", "card", "note"] as const).map((cat) => (
                        <button
                            key={cat}
                            className={`nav-item ${category === cat ? "active" : ""}`}
                            onClick={() => setCategory(cat)}
                        >
                            <span className="nav-icon">{CATEGORY_ICONS[cat]}</span>
                            <span className="nav-label">{CATEGORY_LABELS[cat]}</span>
                            <span className="nav-count">{counts[cat]}</span>
                        </button>
                    ))}

                    <div className="nav-section-label" style={{ marginTop: "20px" }}>Outils</div>
                    <button
                        className="nav-item"
                        onClick={() => { setEditEntry(null); setShowModal(true); }}
                    >
                        <span className="nav-icon">⟳</span>
                        <span className="nav-label">Générateur</span>
                    </button>

                    <div className="nav-section-label" style={{ marginTop: "20px" }}>Sessions</div>
                    <button
                        className="nav-item"
                        onClick={() => navigate("/sessions")}
                    >
                        <span className="nav-icon">⊙</span>
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
                            className="icon-btn"
                            title="Déconnexion"
                            onClick={handleLogout}
                            style={{ marginLeft: "auto", fontSize: "14px" }}
                        >
                            ⏻
                        </button>
                    </div>
                    <button
                        className="btn-delete-account"
                        onClick={() => { setDeleteAccountInput(""); setShowConfirmDeleteAccount(true); }}
                    >
                        ⊗ Supprimer le compte
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
                            <span className="saving-indicator" style={{ color: "#C85050" }}>
                ⚠ Erreur de sauvegarde
              </span>
                        )}
                        <button
                            className="btn-primary"
                            onClick={() => { setEditEntry(null); setShowModal(true); }}
                            disabled={saving}
                        >
                            + Ajouter
                        </button>
                    </div>
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
                                onClick={() => { setSelected(entry); setShowPassword(false); }}
                            />
                        ))
                    )}
                </div>
            </main>

            {/* ── PANNEAU DE DÉTAIL ─────────────────────────────── */}
            {selected ? (
                <aside className="vault-detail">
                    <div className="detail-header">
                        <div className="detail-icon-wrap">
                            <div className="detail-icon">{getFavicon(selected)}</div>
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
                        <Field label="Identifiant">
                            <div className="field-value-row">
                                <span className="field-mono">{selected.username}</span>
                                <button
                                    className={`icon-btn ${copied === "user" ? "copied" : ""}`}
                                    onClick={() => copyToClipboard(selected.username, "user")}
                                    title="Copier"
                                >
                                    {copied === "user" ? "✓" : "⎘"}
                                </button>
                            </div>
                        </Field>

                        <Field label="Mot de passe">
                            <div className="field-value-row">
                <span className={`field-mono ${showPassword ? "password-visible" : "password-hidden"}`}>
                  {showPassword
                      ? selected.password
                      : "•".repeat(Math.min(selected.password.length, 16))}
                </span>
                                <div className="icon-btn-group">
                                    <button
                                        className="icon-btn"
                                        onClick={() => setShowPassword((v) => !v)}
                                        title={showPassword ? "Masquer" : "Afficher"}
                                    >
                                        {showPassword ? "◉" : "○"}
                                    </button>
                                    <button
                                        className={`icon-btn ${copied === "pass" ? "copied" : ""}`}
                                        onClick={() => copyToClipboard(selected.password, "pass")}
                                        title="Copier"
                                    >
                                        {copied === "pass" ? "✓" : "⎘"}
                                    </button>
                                </div>
                            </div>
                            {strengthResult && (
                                <StrengthBar score={strengthResult.score} entropy={strengthResult.entropy} />
                            )}
                        </Field>

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
                                    <button className="icon-btn">↗</button>
                                </div>
                            </Field>
                        )}

                        {selected.notes && (
                            <Field label="Notes">
                                <p className="field-notes">{selected.notes}</p>
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
                            ✎ Modifier
                        </button>
                        <button
                            className="btn-delete"
                            onClick={() => setShowConfirmDelete(true)}
                            title="Supprimer"
                            disabled={saving}
                        >
                            ⊗
                        </button>
                    </div>
                </aside>
            ) : (
                <aside className="vault-detail vault-detail-empty">
                    <div className="detail-placeholder">
                        <div className="placeholder-icon">⬡</div>
                        <p>Sélectionne une entrée</p>
                    </div>
                </aside>
            )}

            {/* ── MODAL AJOUT / ÉDITION ─────────────────────────── */}
            {showModal && (
                <EntryModal
                    entry={editEntry}
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

            {/* ── MODAL CONFIRMATION SUPPRESSION ───────────────── */}
            {showConfirmDelete && selected && (
                <div className="modal-overlay" onClick={() => setShowConfirmDelete(false)}>
                    <div className="modal" style={{ maxWidth: "360px" }} onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2>Supprimer cette entrée ?</h2>
                            <button className="modal-close" onClick={() => setShowConfirmDelete(false)}>✕</button>
                        </div>
                        <div style={{ padding: "16px 24px 24px" }}>
                            <p style={{ fontSize: "13px", color: "#6B7490", marginBottom: "20px" }}>
                                <strong style={{ color: "#E8E6E0" }}>{selected.label}</strong> sera supprimé définitivement.
                                Cette action est irréversible.
                            </p>
                            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                                <button className="btn-secondary" onClick={() => setShowConfirmDelete(false)}>
                                    Annuler
                                </button>
                                <button
                                    className="btn-delete"
                                    style={{ padding: "8px 16px" }}
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
                    <div className="modal" style={{ maxWidth: "400px" }} onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h2 style={{ color: "#C85050" }}>⚠ Supprimer le compte</h2>
                            <button className="modal-close" onClick={() => setShowConfirmDeleteAccount(false)}>✕</button>
                        </div>
                        <div style={{ padding: "16px 24px 24px" }}>
                            <p style={{ fontSize: "13px", color: "#6B7490", marginBottom: "8px", lineHeight: "1.6" }}>
                                Cette action supprime <strong style={{ color: "#E8E6E0" }}>définitivement</strong> votre
                                compte et l'intégralité de votre vault. Aucune récupération n'est possible — le serveur
                                ne conserve aucune copie de vos données en clair.
                            </p>
                            <p style={{ fontSize: "12px", color: "#4A5068", marginBottom: "16px" }}>
                                Tapez <strong style={{ color: "#C85050", fontFamily: "JetBrains Mono, monospace" }}>SUPPRIMER</strong> pour confirmer.
                            </p>
                            <input
                                value={deleteAccountInput}
                                onChange={(e) => setDeleteAccountInput(e.target.value)}
                                placeholder="SUPPRIMER"
                                style={{
                                    width: "100%", background: "#10121A", border: "1px solid #3A1515",
                                    borderRadius: "6px", padding: "10px 12px", color: "#C85050",
                                    fontFamily: "JetBrains Mono, monospace", fontSize: "13px",
                                    outline: "none", boxSizing: "border-box" as const, marginBottom: "16px",
                                }}
                                autoFocus
                            />
                            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                                <button className="btn-secondary" onClick={() => setShowConfirmDeleteAccount(false)}>
                                    Annuler
                                </button>
                                <button
                                    className="btn-delete"
                                    style={{
                                        padding: "8px 16px",
                                        opacity: deleteAccountInput === "SUPPRIMER" ? 1 : 0.4,
                                        cursor:  deleteAccountInput === "SUPPRIMER" ? "pointer" : "not-allowed",
                                    }}
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
                   }: {
    entry: VaultEntryExtended;
    active: boolean;
    onClick: () => void;
}) {
    return (
        <div className={`entry-card ${active ? "active" : ""}`} onClick={onClick}>
            <div className={`entry-icon-wrap cat-${entry.category}`}>
                {getFavicon(entry)}
            </div>
            <div className="entry-info">
                <div className="entry-label">{entry.label}</div>
                <div className="entry-username">{entry.username}</div>
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
            <div className="empty-icon">⬡</div>
            <p>{search ? `Aucun résultat pour "${search}"` : "Aucune entrée dans cette catégorie"}</p>
        </div>
    );
}

// ─────────────────────────────────────────────────────────
// MODAL AJOUT / ÉDITION
// ─────────────────────────────────────────────────────────

type EntryFormData = Omit<VaultEntryExtended, "id" | "createdAt" | "updatedAt">;

function EntryModal({
                        entry, onClose, onSave,
                    }: {
    entry: VaultEntryExtended | null;
    onClose: () => void;
    onSave: (data: EntryFormData) => Promise<void>;
}) {
    const [form, setForm] = useState<EntryFormData>({
        label:    entry?.label    ?? "",
        username: entry?.username ?? "",
        password: entry?.password ?? "",
        url:      entry?.url      ?? "",
        notes:    entry?.notes    ?? "",
        category: entry?.category ?? "login",
        tags:     entry?.tags     ?? [],
    });
    const [showPass,  setShowPass]  = useState(false);
    const [saving,    setSaving]    = useState(false);
    const [tagsInput, setTagsInput] = useState(entry?.tags?.join(", ") ?? "");

    const strength = evaluatePasswordStrength(form.password);

    function handleGenerate() {
        const pwd = generatePassword({ length: 20, symbols: true });
        setForm((f) => ({ ...f, password: pwd }));
        setShowPass(true);
    }

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();
        setSaving(true);
        try {
            await onSave({
                ...form,
                tags: tagsInput.split(",").map((t) => t.trim()).filter(Boolean),
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
                    <button className="modal-close" onClick={onClose}>✕</button>
                </div>

                <form className="modal-form" onSubmit={handleSubmit}>
                    <div className="form-row">
                        <label>Catégorie</label>
                        <div className="category-selector">
                            {(["login", "card", "note"] as const).map((cat) => (
                                <button
                                    key={cat}
                                    type="button"
                                    className={`cat-btn ${form.category === cat ? "active" : ""}`}
                                    onClick={() => setForm((f) => ({ ...f, category: cat }))}
                                >
                                    {CATEGORY_ICONS[cat]} {CATEGORY_LABELS[cat]}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="form-row">
                        <label htmlFor="modal-label">Nom</label>
                        <input
                            id="modal-label"
                            required
                            value={form.label}
                            onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                            placeholder="ex: GitHub"
                        />
                    </div>

                    <div className="form-row">
                        <label htmlFor="modal-username">Identifiant / Email</label>
                        <input
                            id="modal-username"
                            required
                            value={form.username}
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
                                required
                                type={showPass ? "text" : "password"}
                                value={form.password}
                                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
                                placeholder="Mot de passe"
                                autoComplete="new-password"
                                className="password-input"
                            />
                            <button type="button" className="icon-btn" onClick={() => setShowPass((v) => !v)}>
                                {showPass ? "○" : "◉"}
                            </button>
                            <button
                                type="button"
                                className="icon-btn generate-btn"
                                onClick={handleGenerate}
                                title="Générer un mot de passe fort"
                            >
                                ⟳
                            </button>
                        </div>
                        {form.password && (
                            <StrengthBar score={strength.score} entropy={strength.entropy} />
                        )}
                    </div>

                    <div className="form-row">
                        <label htmlFor="modal-url">URL</label>
                        <input
                            id="modal-url"
                            type="url"
                            value={form.url}
                            onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))}
                            placeholder="https://..."
                        />
                    </div>

                    <div className="form-row">
                        <label htmlFor="modal-notes">Notes</label>
                        <textarea
                            id="modal-notes"
                            value={form.notes}
                            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                            placeholder="Notes optionnelles..."
                            rows={3}
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

const CATEGORY_ICONS: Record<Category, string> = {
    all:   "▦",
    login: "◉",
    card:  "▭",
    note:  "≡",
};

const CATEGORY_LABELS: Record<Category, string> = {
    all:   "Tous les identifiants",
    login: "Connexions",
    card:  "Cartes",
    note:  "Notes",
};

function getFavicon(entry: VaultEntryExtended): string {
    if (entry.favicon) return entry.favicon;
    const icons: Record<string, string> = {
        github: "🐙", google: "🟦", netflix: "🎬", figma: "🎨",
        cloudflare: "☁", hetzner: "🖥", discord: "💬", stripe: "💳",
        vercel: "▲", railway: "🚂", notion: "◻", slack: "💬",
    };
    const key = Object.keys(icons).find((k) =>
        entry.label.toLowerCase().includes(k)
    );
    return key ? icons[key] : "🔑";
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
