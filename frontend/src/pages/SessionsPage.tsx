/**
 * ╔═══════════════════════════════════════════════════════╗
 * ║         AEGIS — Page Sessions & Audit                 ║
 * ║         src/pages/SessionsPage.tsx                    ║
 * ╚═══════════════════════════════════════════════════════╝
 */

import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
    ArrowLeft, Shield, Monitor, Smartphone, LogOut, X,
    CheckCircle2, XCircle, Star, Eye, Pencil, AlertTriangle,
} from "lucide-react";
import { apiFetch, AuthError } from "../lib/auth-client";
import "./SessionsPage.css";

// ─────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────

interface Session {
    id:          string;
    userAgent:   string | null;
    ipAddress:   string | null;
    lastUsedAt:  string;
    createdAt:   string;
    expiresAt:   string;
    isCurrent:   boolean;
}

interface AuditEntry {
    id:        string;
    action:    string;
    ipAddress: string | null;
    userAgent: string | null;
    metadata:  Record<string, unknown> | null;
    createdAt: string;
}

// ─────────────────────────────────────────────────────────
// COMPOSANT PRINCIPAL
// ─────────────────────────────────────────────────────────

export default function SessionsPage() {
    const navigate = useNavigate();

    const [sessions,     setSessions]     = useState<Session[]>([]);
    const [auditLogs,    setAuditLogs]    = useState<AuditEntry[]>([]);
    const [auditTotal,   setAuditTotal]   = useState(0);
    const [auditOffset,  setAuditOffset]  = useState(0);
    const [loading,      setLoading]      = useState(true);
    const [error,        setError]        = useState<string | null>(null);
    const [revoking,     setRevoking]     = useState<string | null>(null);

    const AUDIT_LIMIT = 20;

    // ── Chargement ─────────────────────────────────────────

    async function fetchData(offset = 0) {
        setLoading(true);
        setError(null);
        try {
            const [sessionsRes, auditRes] = await Promise.all([
                apiFetch("/sessions") as Promise<{ sessions: Session[] }>,
                apiFetch(`/sessions/audit?limit=${AUDIT_LIMIT}&offset=${offset}`) as Promise<{
                    logs: AuditEntry[];
                    total: number;
                }>,
            ]);
            setSessions(sessionsRes.sessions);
            setAuditLogs(auditRes.logs);
            setAuditTotal(auditRes.total);
            setAuditOffset(offset);
        } catch (err) {
            // Ne jamais afficher silencieusement "0 session" sur un échec
            // réseau/auth - l'utilisateur doit savoir que le chargement a
            // échoué plutôt que de croire qu'il n'a vraiment aucune session.
            if (err instanceof AuthError && err.status === 401) {
                navigate("/login");
                return;
            }
            setError(err instanceof Error ? err.message : "Erreur de chargement.");
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => { fetchData(); }, []);

    // ── Révoquer une session ────────────────────────────────

    async function revokeOne(id: string, isCurrent: boolean) {
        setRevoking(id);
        try {
            await apiFetch(`/sessions/${id}`, { method: "DELETE" });
            if (isCurrent) {
                navigate("/login");
            } else {
                setSessions((s) => s.filter((sess) => sess.id !== id));
            }
        } finally {
            setRevoking(null);
        }
    }

    async function revokeAll() {
        setRevoking("all");
        try {
            await apiFetch("/sessions", { method: "DELETE" });
            navigate("/login");
        } finally {
            setRevoking(null);
        }
    }

    return (
        <div className="sp-layout">

            {/* ── EN-TÊTE ──────────────────────────────────────── */}
            <div className="sp-header">
                <button className="sp-back" onClick={() => navigate("/vault")}>
                    <ArrowLeft size={14} strokeWidth={2} /> Retour au vault
                </button>
                <h1 className="sp-title">Sécurité du compte</h1>
                <p className="sp-sub">Gérez vos appareils connectés et consultez l'historique d'activité.</p>
            </div>

            {loading ? (
                <div className="sp-loading">
                    <Shield className="loading-mark" size={26} strokeWidth={1.75} />
                    <p>Chargement…</p>
                </div>
            ) : error ? (
                <div className="sp-loading">
                    <AlertTriangle className="loading-mark" size={26} strokeWidth={1.75} />
                    <p>{error}</p>
                    <button className="sp-back" onClick={() => fetchData(auditOffset)}>Réessayer</button>
                </div>
            ) : (
                <div className="sp-content">

                    {/* ── SESSIONS ACTIVES ─────────────────────────── */}
                    <section className="sp-section">
                        <div className="section-header">
                            <div>
                                <h2 className="section-title">Appareils connectés</h2>
                                <p className="section-sub">{sessions.length} session{sessions.length > 1 ? "s" : ""} active{sessions.length > 1 ? "s" : ""}</p>
                            </div>
                            {sessions.length > 1 && (
                                <button
                                    className="btn-revoke-all"
                                    onClick={revokeAll}
                                    disabled={revoking === "all"}
                                >
                                    <LogOut size={13} strokeWidth={2} /> {revoking === "all" ? "Révocation…" : "Tout déconnecter"}
                                </button>
                            )}
                        </div>

                        <div className="sessions-list">
                            {sessions.map((session) => (
                                <div key={session.id} className={`session-card ${session.isCurrent ? "current" : ""}`}>
                                    <div className="session-icon">
                                        {detectDevice(session.userAgent)}
                                    </div>
                                    <div className="session-info">
                                        <div className="session-ua">
                                            {parseUserAgent(session.userAgent)}
                                            {session.isCurrent && <span className="badge-current">Cet appareil</span>}
                                        </div>
                                        <div className="session-meta">
                                            <span>{session.ipAddress ?? "IP inconnue"}</span>
                                            <span className="sep">·</span>
                                            <span>Dernière activité {formatRelative(session.lastUsedAt)}</span>
                                            <span className="sep">·</span>
                                            <span>Expire {formatRelative(session.expiresAt)}</span>
                                        </div>
                                    </div>
                                    <button
                                        className="btn-revoke"
                                        onClick={() => revokeOne(session.id, session.isCurrent)}
                                        disabled={revoking === session.id}
                                        title={session.isCurrent ? "Se déconnecter" : "Révoquer cette session"}
                                    >
                                        {revoking === session.id ? "…" : <X size={14} strokeWidth={2} />}
                                    </button>
                                </div>
                            ))}
                        </div>
                    </section>

                    {/* ── AUDIT LOG ────────────────────────────────── */}
                    <section className="sp-section">
                        <div className="section-header">
                            <div>
                                <h2 className="section-title">Historique d'activité</h2>
                                <p className="section-sub">{auditTotal} événement{auditTotal > 1 ? "s" : ""} enregistré{auditTotal > 1 ? "s" : ""}</p>
                            </div>
                        </div>

                        <div className="audit-list">
                            {auditLogs.map((log) => {
                                const ActionIcon = ACTION_ICONS[log.action] ?? Star;
                                return (
                                    <div key={log.id} className="audit-row">
                                        <div className={`audit-icon action-${log.action.toLowerCase()}`}>
                                            <ActionIcon size={14} strokeWidth={2} />
                                        </div>
                                        <div className="audit-info">
                                            <div className="audit-action">{ACTION_LABELS[log.action] ?? log.action}</div>
                                            <div className="audit-meta">
                                                <span>{log.ipAddress ?? "IP inconnue"}</span>
                                                <span className="sep">·</span>
                                                <span>{parseUserAgent(log.userAgent)}</span>
                                                {log.metadata && Object.keys(log.metadata).length > 0 && (
                                                    <>
                                                        <span className="sep">·</span>
                                                        <span className="audit-meta-extra">{formatMetadata(log.metadata)}</span>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                        <div className="audit-date">{formatRelative(log.createdAt)}</div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Pagination */}
                        {auditTotal > AUDIT_LIMIT && (
                            <div className="audit-pagination">
                                <button
                                    className="btn-page"
                                    disabled={auditOffset === 0}
                                    onClick={() => fetchData(auditOffset - AUDIT_LIMIT)}
                                >
                                    Précédent
                                </button>
                                <span className="page-info">
                  {auditOffset + 1}–{Math.min(auditOffset + AUDIT_LIMIT, auditTotal)} / {auditTotal}
                </span>
                                <button
                                    className="btn-page"
                                    disabled={auditOffset + AUDIT_LIMIT >= auditTotal}
                                    onClick={() => fetchData(auditOffset + AUDIT_LIMIT)}
                                >
                                    Suivant
                                </button>
                            </div>
                        )}
                    </section>

                </div>
            )}
        </div>
    );
}

// ─────────────────────────────────────────────────────────
// UTILITAIRES
// ─────────────────────────────────────────────────────────

function parseUserAgent(ua: string | null): string {
    if (!ua) return "Appareil inconnu";
    if (ua.includes("Firefox"))  return `Firefox · ${detectOS(ua)}`;
    if (ua.includes("Chrome"))   return `Chrome · ${detectOS(ua)}`;
    if (ua.includes("Safari"))   return `Safari · ${detectOS(ua)}`;
    if (ua.includes("Edge"))     return `Edge · ${detectOS(ua)}`;
    return ua.slice(0, 40);
}

function detectOS(ua: string): string {
    if (ua.includes("Windows"))  return "Windows";
    if (ua.includes("Mac OS"))   return "macOS";
    if (ua.includes("Linux"))    return "Linux";
    if (ua.includes("Android"))  return "Android";
    if (ua.includes("iPhone") || ua.includes("iPad")) return "iOS";
    return "Inconnu";
}

function detectDevice(ua: string | null) {
    if (!ua) return <Monitor size={16} strokeWidth={1.75} />;
    if (ua.includes("iPhone") || ua.includes("Android") || ua.includes("iPad")) {
        return <Smartphone size={16} strokeWidth={1.75} />;
    }
    return <Monitor size={16} strokeWidth={1.75} />;
}

function formatRelative(dateStr: string): string {
    const diff  = Date.now() - new Date(dateStr).getTime();
    const abs   = Math.abs(diff);
    const future = diff < 0;

    if (abs < 60_000)        return future ? "dans quelques secondes" : "à l'instant";
    if (abs < 3_600_000)     return `${future ? "dans" : "il y a"} ${Math.floor(abs / 60_000)} min`;
    if (abs < 86_400_000)    return `${future ? "dans" : "il y a"} ${Math.floor(abs / 3_600_000)}h`;
    if (abs < 7 * 86_400_000) return `${future ? "dans" : "il y a"} ${Math.floor(abs / 86_400_000)}j`;
    return new Date(dateStr).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

function formatMetadata(meta: Record<string, unknown>): string {
    if (meta.failedAttempts) return `tentative ${meta.failedAttempts}`;
    if (meta.scope === "all") return "toutes les sessions";
    if (meta.revokedSessionId) return "session distante";
    return "";
}

const ACTION_ICONS: Record<string, typeof Star> = {
    LOGIN_SUCCESS:          CheckCircle2,
    LOGIN_FAILED:           XCircle,
    LOGOUT:                 LogOut,
    REGISTER:               Star,
    VAULT_READ:             Eye,
    VAULT_WRITE:            Pencil,
    SESSION_REVOKED:        X,
    ACCOUNT_DELETED:        X,
    PASSWORD_CHANGE_ATTEMPT:AlertTriangle,
};

const ACTION_LABELS: Record<string, string> = {
    LOGIN_SUCCESS:          "Connexion réussie",
    LOGIN_FAILED:           "Tentative de connexion échouée",
    LOGOUT:                 "Déconnexion",
    REGISTER:               "Création du compte",
    VAULT_READ:             "Vault consulté",
    VAULT_WRITE:            "Vault modifié",
    SESSION_REVOKED:        "Session révoquée",
    ACCOUNT_DELETED:        "Compte supprimé",
    PASSWORD_CHANGE_ATTEMPT:"Tentative de changement de mot de passe",
};
