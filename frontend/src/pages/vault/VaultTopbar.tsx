import { AlertTriangle, LogOut, Plus, RefreshCw, Search, ShieldAlert, ShieldCheck } from "lucide-react";
import { CATEGORY_LABELS } from "./format";
import type { Category } from "./types";

interface VaultTopbarProps {
    category: Category;
    saving: boolean;
    hasError: boolean;
    search: string;
    onSearchChange: (value: string) => void;
    onAdd: () => void;
    onOpenGenerator: () => void;
    onOpenSecurityAudit: () => void;
    onOpenSessions: () => void;
    onLogout: () => void;
}

/** Barre du haut de la liste : titre, état de sauvegarde, actions et recherche mobile. */
export default function VaultTopbar({
    category, saving, hasError, search, onSearchChange,
    onAdd, onOpenGenerator, onOpenSecurityAudit, onOpenSessions, onLogout,
}: VaultTopbarProps) {
    return (
        <>
            <div className="main-topbar">
                <h1 className="topbar-title">{CATEGORY_LABELS[category]}</h1>
                <div className="topbar-actions">
                    {saving && <span className="saving-indicator">Sauvegarde…</span>}
                    {hasError && !saving && (
                        <span className="saving-indicator saving-indicator-danger">
                            <AlertTriangle size={12} strokeWidth={2} /> Erreur de sauvegarde
                        </span>
                    )}
                    <button className="btn-primary" onClick={onAdd} disabled={saving}>
                        <Plus size={15} strokeWidth={2.25} /> <span>Ajouter</span>
                    </button>
                    <button className="icon-btn mobile-tool-btn" title="Générateur" onClick={onOpenGenerator}>
                        <RefreshCw size={16} strokeWidth={2} />
                    </button>
                    <button className="icon-btn mobile-tool-btn" title="Analyse du vault" onClick={onOpenSecurityAudit}>
                        <ShieldAlert size={16} strokeWidth={2} />
                    </button>
                    <button className="icon-btn mobile-tool-btn" title="Sécurité" onClick={onOpenSessions}>
                        <ShieldCheck size={16} strokeWidth={2} />
                    </button>
                    <button className="icon-btn mobile-logout-btn" title="Déconnexion" onClick={onLogout}>
                        <LogOut size={16} strokeWidth={2} />
                    </button>
                </div>
            </div>

            <div className="topbar-search-mobile">
                <Search className="search-icon" size={14} strokeWidth={2} />
                <input
                    placeholder="Rechercher..."
                    value={search}
                    onChange={(e) => onSearchChange(e.target.value)}
                />
            </div>
        </>
    );
}
