/**
 * ╔═══════════════════════════════════════════════════════╗
 * ║         AEGIS — Analyse du vault (audit sécurité)     ║
 * ║         src/pages/SecurityAuditPage.tsx               ║
 * ╚═══════════════════════════════════════════════════════╝
 *
 * Analyse purement locale : les entrées sont déjà déchiffrées en mémoire
 * (via useVault) — rien n'est envoyé où que ce soit, on ne fait que lire
 * ce que l'utilisateur a déjà sous les yeux dans son vault.
 */

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
    ArrowLeft, Shield, ShieldOff, AlertTriangle, Copy, Clock, CreditCard, Flame,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { evaluatePasswordStrength } from "../lib/crypto";
import { checkExpiry } from "../lib/card";
import { checkPasswordPwned } from "../lib/pwned";
import { useVault } from "../hooks/useVault";
import type { VaultEntryExtended } from "./VaultPage";
import "./SecurityAuditPage.css";

const STALE_DAYS = 365;

// ─────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────

type Severity = "danger" | "warn";

interface Finding {
    id:     string;
    label:  string;
    reason: string;
}

interface AuditReport {
    weak:     Finding[];
    reused:   Finding[];
    stale:    Finding[];
    expired:  Finding[];
    soon:     Finding[];
    no2fa:    Finding[];
}

// ─────────────────────────────────────────────────────────
// CALCUL DE L'AUDIT
// ─────────────────────────────────────────────────────────

function computeAudit(entries: VaultEntryExtended[]): AuditReport {
    const logins = entries.filter((e) => e.category === "login");
    const cards  = entries.filter((e) => e.category === "card");

    const weak: Finding[] = logins
        .filter((e) => e.password && evaluatePasswordStrength(e.password).score <= 1)
        .map((e) => ({
            id: e.id, label: e.label,
            reason: `Mot de passe ${evaluatePasswordStrength(e.password!).strength === "very-weak" ? "très faible" : "faible"}`,
        }));

    const byPassword = new Map<string, VaultEntryExtended[]>();
    for (const e of logins) {
        if (!e.password) continue;
        byPassword.set(e.password, [...(byPassword.get(e.password) ?? []), e]);
    }
    const reused: Finding[] = [...byPassword.values()]
        .filter((group) => group.length > 1)
        .flatMap((group) =>
            group.map((e) => ({
                id: e.id, label: e.label,
                reason: `Mot de passe réutilisé sur ${group.length} entrées`,
            }))
        );

    const staleThreshold = Date.now() - STALE_DAYS * 86_400_000;
    const stale: Finding[] = logins
        .filter((e) => e.password && e.updatedAt < staleThreshold)
        .map((e) => ({
            id: e.id, label: e.label,
            reason: "Non modifié depuis plus d'un an",
        }));

    const expired: Finding[] = [];
    const soon: Finding[] = [];
    for (const e of cards) {
        const status = checkExpiry(e.cardExpiry ?? "");
        if (status === "expired") expired.push({ id: e.id, label: e.label, reason: "Carte expirée" });
        if (status === "soon")    soon.push({ id: e.id, label: e.label, reason: "Expire dans moins de 60 jours" });
    }

    const no2fa: Finding[] = logins
        .filter((e) => !e.totpSecret)
        .map((e) => ({ id: e.id, label: e.label, reason: "Aucune clé 2FA enregistrée" }));

    return { weak, reused, stale, expired, soon, no2fa };
}

// ─────────────────────────────────────────────────────────
// COMPOSANT PRINCIPAL
// ─────────────────────────────────────────────────────────

type PwnedStatus = "idle" | "checking" | "done" | "error";

export default function SecurityAuditPage() {
    const navigate = useNavigate();
    const { entries, status } = useVault();
    const typedEntries = entries as VaultEntryExtended[];

    const report = useMemo(() => computeAudit(typedEntries), [typedEntries]);

    // ── Vérification des fuites (opt-in, appel réseau vers HIBP) ────
    const [pwnedStatus, setPwnedStatus] = useState<PwnedStatus>("idle");
    const [pwnedResults, setPwnedResults] = useState<Map<string, number>>(new Map());

    const uniqueLoginPasswords = useMemo(
        () => [...new Set(
            typedEntries.filter((e) => e.category === "login" && e.password).map((e) => e.password!)
        )],
        [typedEntries]
    );

    const leaked: Finding[] = useMemo(() => {
        if (pwnedStatus !== "done") return [];
        return typedEntries
            .filter((e) => e.category === "login" && e.password && (pwnedResults.get(e.password) ?? 0) > 0)
            .map((e) => ({
                id: e.id, label: e.label,
                reason: `Vu ${pwnedResults.get(e.password!)!.toLocaleString("fr-FR")} fois dans des fuites de données`,
            }));
    }, [typedEntries, pwnedResults, pwnedStatus]);

    async function runPwnedCheck() {
        setPwnedStatus("checking");
        try {
            const results = new Map<string, number>();
            for (const pwd of uniqueLoginPasswords) {
                results.set(pwd, await checkPasswordPwned(pwd));
            }
            setPwnedResults(results);
            setPwnedStatus("done");
        } catch {
            setPwnedStatus("error");
        }
    }

    function goToEntry(label: string) {
        navigate(`/vault?q=${encodeURIComponent(label)}`);
    }

    function scrollToSection(id: string) {
        document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    const loading = status === "loading" || status === "idle";

    return (
        <div className="sp-layout">

            <div className="sp-header">
                <button className="sp-back" onClick={() => navigate("/vault")}>
                    <ArrowLeft size={14} strokeWidth={2} /> Retour au vault
                </button>
                <h1 className="sp-title">Analyse du vault</h1>
                <p className="sp-sub">
                    Une analyse locale de vos entrées - rien n'est envoyé, sauf si vous activez la
                    vérification des fuites ci-dessous, qui interroge Have I Been Pwned.
                </p>
            </div>

            {loading ? (
                <div className="sp-loading">
                    <Shield className="loading-mark" size={26} strokeWidth={1.75} />
                    <p>Chargement…</p>
                </div>
            ) : (
                <div className="sp-content">

                    {/* ── RÉSUMÉ ───────────────────────────────────── */}
                    <section className="sp-section">
                        <div className="section-header">
                            <div>
                                <h2 className="section-title">Résumé</h2>
                                <p className="section-sub">Vue d'ensemble des points à vérifier</p>
                            </div>
                        </div>
                        <div className="summary-chips">
                            <SummaryChip icon={AlertTriangle} count={report.weak.length} label="mot(s) de passe faible(s)" severity="danger" onClick={() => scrollToSection("section-weak")} />
                            <SummaryChip icon={Copy} count={report.reused.length} label="mot(s) de passe réutilisé(s)" severity="danger" onClick={() => scrollToSection("section-reused")} />
                            <SummaryChip icon={Clock} count={report.stale.length} label="entrée(s) ancienne(s)" severity="warn" onClick={() => scrollToSection("section-stale")} />
                            <SummaryChip icon={CreditCard} count={report.expired.length + report.soon.length} label="carte(s) à vérifier" severity="warn" onClick={() => scrollToSection("section-cards")} />
                            <SummaryChip icon={ShieldOff} count={report.no2fa.length} label="connexion(s) sans 2FA" severity="warn" onClick={() => scrollToSection("section-2fa")} />
                            <SummaryChip icon={Flame} count={leaked.length} label="mot(s) de passe compromis" severity="danger" onClick={() => scrollToSection("section-leaked")} />
                        </div>
                    </section>

                    <section className="sp-section" id="section-leaked">
                        <div className="section-header">
                            <div>
                                <h2 className="section-title">Mots de passe compromis</h2>
                                <p className="section-sub">
                                    Vérifie si vos mots de passe sont déjà apparus dans des fuites de données
                                    connues (API Have I Been Pwned, méthode k-anonymat : seuls 5 caractères
                                    d'un hash sont envoyés, jamais votre mot de passe).
                                </p>
                            </div>
                            {pwnedStatus !== "checking" && uniqueLoginPasswords.length > 0 && (
                                <button className="pwned-check-btn" onClick={runPwnedCheck}>
                                    {pwnedStatus === "idle" ? "Vérifier" : "Revérifier"}
                                </button>
                            )}
                        </div>
                        {uniqueLoginPasswords.length === 0 ? (
                            <p className="empty-finding">Aucun mot de passe à vérifier.</p>
                        ) : pwnedStatus === "idle" ? (
                            <p className="empty-finding">Vérification non lancée - cliquez sur "Vérifier".</p>
                        ) : pwnedStatus === "checking" ? (
                            <p className="empty-finding">Vérification en cours…</p>
                        ) : pwnedStatus === "error" ? (
                            <p className="empty-finding">Vérification indisponible (hors ligne ou API injoignable). Réessayez plus tard.</p>
                        ) : leaked.length === 0 ? (
                            <p className="empty-finding">Aucun mot de passe compromis détecté.</p>
                        ) : (
                            <div className="finding-list">
                                {leaked.map((f, i) => (
                                    <div key={`${f.id}-${i}`} className="finding-row" onClick={() => goToEntry(f.label)}>
                                        <div className="finding-icon severity-danger">
                                            <Flame size={14} strokeWidth={2} />
                                        </div>
                                        <div className="finding-info">
                                            <div className="finding-label">{f.label}</div>
                                            <div className="finding-reason">{f.reason}</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </section>

                    <FindingSection
                        id="section-weak"
                        icon={AlertTriangle}
                        title="Mots de passe faibles"
                        subtitle="Entropie insuffisante - faciles à deviner ou à casser par force brute"
                        severity="danger"
                        findings={report.weak}
                        emptyLabel="Aucun mot de passe faible détecté."
                        onSelect={goToEntry}
                    />

                    <FindingSection
                        id="section-reused"
                        icon={Copy}
                        title="Mots de passe réutilisés"
                        subtitle="Le même mot de passe protège plusieurs comptes"
                        severity="danger"
                        findings={report.reused}
                        emptyLabel="Aucun mot de passe réutilisé détecté."
                        onSelect={goToEntry}
                    />

                    <FindingSection
                        id="section-stale"
                        icon={Clock}
                        title="Entrées anciennes"
                        subtitle={`Non modifiées depuis plus de ${STALE_DAYS} jours`}
                        severity="warn"
                        findings={report.stale}
                        emptyLabel="Aucune entrée ancienne détectée."
                        onSelect={goToEntry}
                    />

                    <FindingSection
                        id="section-cards"
                        icon={CreditCard}
                        title="Cartes à vérifier"
                        subtitle="Cartes expirées ou arrivant à expiration"
                        severity="warn"
                        findings={[...report.expired, ...report.soon]}
                        emptyLabel="Aucune carte expirée ou bientôt expirée."
                        onSelect={goToEntry}
                    />

                    <FindingSection
                        id="section-2fa"
                        icon={ShieldOff}
                        title="Connexions sans 2FA"
                        subtitle="Ajoutez une clé secrète TOTP pour renforcer ces comptes"
                        severity="warn"
                        findings={report.no2fa}
                        emptyLabel="Toutes vos connexions ont une clé 2FA enregistrée."
                        onSelect={goToEntry}
                    />

                </div>
            )}
        </div>
    );
}

// ─────────────────────────────────────────────────────────
// SOUS-COMPOSANTS
// ─────────────────────────────────────────────────────────

function SummaryChip({
                          icon: Icon, count, label, severity, onClick,
                      }: {
    icon: LucideIcon;
    count: number;
    label: string;
    severity: Severity;
    onClick: () => void;
}) {
    return (
        <button className={`summary-chip severity-${severity}`} onClick={onClick}>
            <Icon size={13} strokeWidth={2} />
            <span className="summary-chip-count">{count}</span>
            {label}
        </button>
    );
}

function FindingSection({
                             id, icon: Icon, title, subtitle, severity, findings, emptyLabel, onSelect,
                         }: {
    id: string;
    icon: LucideIcon;
    title: string;
    subtitle: string;
    severity: Severity;
    findings: Finding[];
    emptyLabel: string;
    onSelect: (label: string) => void;
}) {
    return (
        <section className="sp-section" id={id}>
            <div className="section-header">
                <div>
                    <h2 className="section-title">{title}</h2>
                    <p className="section-sub">{subtitle}</p>
                </div>
            </div>
            {findings.length === 0 ? (
                <p className="empty-finding">{emptyLabel}</p>
            ) : (
                <div className="finding-list">
                    {findings.map((f, i) => (
                        <div key={`${f.id}-${i}`} className="finding-row" onClick={() => onSelect(f.label)}>
                            <div className={`finding-icon severity-${severity}`}>
                                <Icon size={14} strokeWidth={2} />
                            </div>
                            <div className="finding-info">
                                <div className="finding-label">{f.label}</div>
                                <div className="finding-reason">{f.reason}</div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </section>
    );
}
