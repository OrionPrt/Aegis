import { AlertTriangle, LogOut, Pencil, Plus, RefreshCw, Search, ShieldAlert, ShieldCheck, Trash2 } from "lucide-react";

/** Actions proposées quand la liste affiche un dossier. */
export interface FolderActions {
    onRename: () => void;
    onDelete: () => void;
}

interface VaultTopbarProps {
    title: string;
    /** Présent quand un dossier est affiché. */
    folderActions?: FolderActions;
    saving: boolean;
    /** Dernière erreur de sauvegarde, affichée sous la barre. */
    errorMessage: string | null;
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
    title, folderActions, saving, errorMessage, search, onSearchChange,
    onAdd, onOpenGenerator, onOpenSecurityAudit, onOpenSessions, onLogout,
}: VaultTopbarProps) {
    return (
        <>
            <div className="main-topbar">
                <div className="topbar-heading">
                    <h1 className="topbar-title" title={title}>{title}</h1>
                    {folderActions && (
                        <div className="icon-btn-group">
                            <button
                                className="icon-btn"
                                title="Renommer le dossier"
                                aria-label="Renommer le dossier"
                                onClick={folderActions.onRename}
                                disabled={saving}
                            >
                                <Pencil size={14} strokeWidth={2} />
                            </button>
                            <button
                                className="icon-btn icon-btn-danger"
                                title="Supprimer le dossier"
                                aria-label="Supprimer le dossier"
                                onClick={folderActions.onDelete}
                                disabled={saving}
                            >
                                <Trash2 size={14} strokeWidth={2} />
                            </button>
                        </div>
                    )}
                </div>
                <div className="topbar-actions">
                    {saving && <span className="saving-indicator">Sauvegarde…</span>}
                    {errorMessage && !saving && (
                        <span className="saving-indicator saving-indicator-danger">
                            <AlertTriangle size={12} strokeWidth={2} /> Erreur de sauvegarde
                        </span>
                    )}
                    <button className="btn-primary" onClick={onAdd} disabled={saving}>
                        <Plus size={15} strokeWidth={2.25} /> <span>Ajouter</span>
                    </button>
                    <button className="icon-btn mobile-tool-btn" title="Générateur" aria-label="Générateur" onClick={onOpenGenerator}>
                        <RefreshCw size={16} strokeWidth={2} />
                    </button>
                    <button className="icon-btn mobile-tool-btn" title="Analyse du vault" aria-label="Analyse du vault" onClick={onOpenSecurityAudit}>
                        <ShieldAlert size={16} strokeWidth={2} />
                    </button>
                    <button className="icon-btn mobile-tool-btn" title="Sécurité" aria-label="Sécurité" onClick={onOpenSessions}>
                        <ShieldCheck size={16} strokeWidth={2} />
                    </button>
                    <button className="icon-btn mobile-logout-btn" title="Déconnexion" aria-label="Déconnexion" onClick={onLogout}>
                        <LogOut size={16} strokeWidth={2} />
                    </button>
                </div>
            </div>

            {errorMessage && !saving && (
                <div className="form-error vault-save-error" role="alert">
                    <AlertTriangle size={14} strokeWidth={2} /> {errorMessage}
                </div>
            )}

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
