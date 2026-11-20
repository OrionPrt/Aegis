import type { ReactNode } from "react";
import { KeyRound, LogOut, RefreshCw, Search, Shield, ShieldAlert, ShieldCheck, Trash2 } from "lucide-react";
import { CATEGORY_ICONS, CATEGORY_LABELS } from "./format";
import type { Category, VaultView } from "./types";

const SIDEBAR_CATEGORIES = ["all", "login", "card", "note"] as const;

interface VaultSidebarProps {
    email: string | undefined;
    search: string;
    onSearchChange: (value: string) => void;
    view: VaultView;
    onCategoryChange: (category: Category) => void;
    counts: Record<Category, number>;
    /** Section « Dossiers », placée sous les catégories (voir SidebarFolders). */
    folderSection: ReactNode;
    onOpenGenerator: () => void;
    onOpenSecurityAudit: () => void;
    onOpenSessions: () => void;
    onLogout: () => void;
    onChangePassword: () => void;
    onDeleteAccount: () => void;
}

export default function VaultSidebar({
    email, search, onSearchChange, view, onCategoryChange, counts, folderSection,
    onOpenGenerator, onOpenSecurityAudit, onOpenSessions, onLogout, onChangePassword, onDeleteAccount,
}: VaultSidebarProps) {
    return (
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
                    onChange={(e) => onSearchChange(e.target.value)}
                />
            </div>

            <nav className="sidebar-nav">
                <div className="nav-section-label">Vault</div>
                {SIDEBAR_CATEGORIES.map((cat) => {
                    const CatIcon = CATEGORY_ICONS[cat];
                    return (
                        <button
                            key={cat}
                            className={`nav-item ${view.kind === "category" && view.category === cat ? "active" : ""}`}
                            onClick={() => onCategoryChange(cat)}
                        >
                            <span className="nav-icon"><CatIcon size={15} strokeWidth={2} /></span>
                            <span className="nav-label">{CATEGORY_LABELS[cat]}</span>
                            <span className="nav-count">{counts[cat]}</span>
                        </button>
                    );
                })}

                {folderSection}

                <div className="nav-section-label">Outils</div>
                <button className="nav-item nav-item-extra" onClick={onOpenGenerator}>
                    <span className="nav-icon"><RefreshCw size={15} strokeWidth={2} /></span>
                    <span className="nav-label">Générateur</span>
                </button>

                <div className="nav-section-label">Audit</div>
                <button className="nav-item nav-item-extra" onClick={onOpenSecurityAudit}>
                    <span className="nav-icon"><ShieldAlert size={15} strokeWidth={2} /></span>
                    <span className="nav-label">Analyse du vault</span>
                </button>

                <div className="nav-section-label">Sessions</div>
                <button className="nav-item nav-item-extra" onClick={onOpenSessions}>
                    <span className="nav-icon"><ShieldCheck size={15} strokeWidth={2} /></span>
                    <span className="nav-label">Sécurité</span>
                </button>
            </nav>

            <div className="sidebar-footer">
                <div className="user-pill">
                    <div className="user-avatar">
                        {email?.[0]?.toUpperCase() ?? "?"}
                    </div>
                    <span className="user-email">{email}</span>
                    <button className="icon-btn sidebar-logout-btn" title="Déconnexion" aria-label="Déconnexion" onClick={onLogout}>
                        <LogOut size={14} strokeWidth={2} />
                    </button>
                </div>
                <button className="btn-change-password" onClick={onChangePassword}>
                    <KeyRound size={13} strokeWidth={2} /> Changer le mot de passe
                </button>
                <button className="btn-delete-account" onClick={onDeleteAccount}>
                    <Trash2 size={13} strokeWidth={2} /> Supprimer le compte
                </button>
            </div>
        </aside>
    );
}
