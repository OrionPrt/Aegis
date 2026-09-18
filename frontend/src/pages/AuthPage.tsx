/**
 * ╔═══════════════════════════════════════════════════════╗
 * ║           AEGIS — Page Login / Register               ║
 * ║           src/pages/AuthPage.tsx                      ║
 * ╚═══════════════════════════════════════════════════════╝
 */

import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Shield, Eye, EyeOff, Loader2, AlertTriangle, KeyRound, Lock, ShieldCheck, Code2 } from "lucide-react";
import { login, register, AuthError } from "../lib/auth-client";
import { evaluatePasswordStrength } from "../lib/crypto";
import "./AuthPage.css";

// ─────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────

type Mode = "login" | "register";

interface FormState {
    email: string;
    password: string;
    confirmPassword: string;
}

// ─────────────────────────────────────────────────────────
// COMPOSANT PRINCIPAL
// ─────────────────────────────────────────────────────────

export default function AuthPage() {
    const navigate = useNavigate();

    const [mode, setMode]           = useState<Mode>("login");
    const [form, setForm]           = useState<FormState>({ email: "", password: "", confirmPassword: "" });
    const [showPassword, setShow]   = useState(false);
    const [loading, setLoading]     = useState(false);
    const [error, setError]         = useState<string | null>(null);
    const [argonStep, setArgonStep] = useState<string | null>(null);

    const strength = form.password ? evaluatePasswordStrength(form.password) : null;
    const strengthColors = ["#C85050", "#E8803A", "#C9A84C", "#70B870", "#50C890"];

    function update(field: keyof FormState, value: string) {
        setForm((f) => ({ ...f, [field]: value }));
        setError(null);
    }

    function switchMode(next: Mode) {
        setMode(next);
        setError(null);
        setForm({ email: form.email, password: "", confirmPassword: "" });
    }

    // ── Validation ─────────────────────────────────────────

    function validate(): string | null {
        if (!form.email.trim())    return "L'email est requis.";
        if (!form.password)        return "Le mot de passe maître est requis.";
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) return "Email invalide.";

        if (mode === "register") {
            if (form.password.length < 12)
                return "Le mot de passe maître doit faire au moins 12 caractères.";
            if (strength && strength.score < 2)
                return "Mot de passe trop faible. Ajoutez des majuscules, chiffres et symboles.";
            if (form.password !== form.confirmPassword)
                return "Les mots de passe ne correspondent pas.";
        }

        return null;
    }

    // ── Soumission ─────────────────────────────────────────

    async function handleSubmit(e: React.FormEvent) {
        e.preventDefault();

        const validationError = validate();
        if (validationError) { setError(validationError); return; }

        setLoading(true);
        setError(null);

        try {
            if (mode === "login") {
                // Argon2id prend ~1-3s — on informe l'utilisateur
                setArgonStep("Dérivation de la clé en cours…");
                await login(form.email, form.password);
            } else {
                setArgonStep("Génération de votre clé de chiffrement…");
                await register(form.email, form.password);
            }
            navigate("/vault");
        } catch (err) {
            if (err instanceof AuthError) {
                setError(err.message);
            } else {
                setError("Une erreur inattendue est survenue.");
            }
        } finally {
            setLoading(false);
            setArgonStep(null);
        }
    }

    return (
        <div className="auth-layout">

            {/* ── PANNEAU GAUCHE — Branding ─────────────────────── */}
            <div className="auth-left">
                <div className="auth-brand">
                    <span className="brand-mark"><Shield size={18} strokeWidth={2} /></span>
                    <div>
                        <div className="brand-name">Aegis</div>
                        <div className="brand-tagline">Gestionnaire de mots de passe</div>
                    </div>
                </div>

                <h1 className="auth-headline">
                    Vos mots de passe,<br />en sécurité pour de bon.
                </h1>

                <p className="auth-sub">
                    Chiffrement zero-knowledge : vos identifiants ne quittent jamais
                    votre appareil en clair, même Aegis ne peut pas les lire.
                </p>

                <ul className="auth-pillars">
                    <li>
                        <span className="pillar-icon"><KeyRound size={15} strokeWidth={2} /></span>
                        Argon2id - dérivation de clé résistante au brute-force GPU
                    </li>
                    <li>
                        <span className="pillar-icon"><Lock size={15} strokeWidth={2} /></span>
                        AES-256-GCM - chiffrement authentifié de bout en bout
                    </li>
                    <li>
                        <span className="pillar-icon"><ShieldCheck size={15} strokeWidth={2} /></span>
                        Zero-knowledge - le serveur ne voit jamais vos données en clair
                    </li>
                    <li>
                        <span className="pillar-icon"><Code2 size={15} strokeWidth={2} /></span>
                        Open-source - code source public et auditable
                    </li>
                </ul>
            </div>

            {/* ── PANNEAU DROIT — Formulaire ────────────────────── */}
            <div className="auth-right">
                <div className="auth-card">

                    {/* Onglets Login / Register */}
                    <div className="auth-tabs">
                        <button
                            className={`auth-tab ${mode === "login" ? "active" : ""}`}
                            onClick={() => switchMode("login")}
                            type="button"
                        >
                            Connexion
                        </button>
                        <button
                            className={`auth-tab ${mode === "register" ? "active" : ""}`}
                            onClick={() => switchMode("register")}
                            type="button"
                        >
                            Inscription
                        </button>
                    </div>

                    <form onSubmit={handleSubmit} noValidate>

                        {/* Email */}
                        <div className="auth-field">
                            <label htmlFor="email">Email</label>
                            <input
                                id="email"
                                type="email"
                                value={form.email}
                                onChange={(e) => update("email", e.target.value)}
                                placeholder="vous@exemple.com"
                                autoComplete="email"
                                disabled={loading}
                            />
                        </div>

                        {/* Mot de passe maître */}
                        <div className="auth-field">
                            <div className="field-label-row">
                                <label htmlFor="password">Mot de passe maître</label>
                                <button
                                    type="button"
                                    className="toggle-pass"
                                    onClick={() => setShow((v) => !v)}
                                    tabIndex={-1}
                                >
                                    {showPassword ? <EyeOff size={13} strokeWidth={2} /> : <Eye size={13} strokeWidth={2} />}
                                    {showPassword ? "Masquer" : "Afficher"}
                                </button>
                            </div>
                            <input
                                id="password"
                                type={showPassword ? "text" : "password"}
                                value={form.password}
                                onChange={(e) => update("password", e.target.value)}
                                placeholder={mode === "login" ? "Votre mot de passe maître" : "Choisissez un mot de passe fort"}
                                autoComplete={mode === "login" ? "current-password" : "new-password"}
                                disabled={loading}
                            />

                            {/* Jauge de force — seulement à l'inscription */}
                            {mode === "register" && form.password && strength && (
                                <div className="strength-wrap">
                                    <div className="strength-bars">
                                        {[0, 1, 2, 3, 4].map((i) => (
                                            <div
                                                key={i}
                                                className="strength-bar"
                                                style={{
                                                    background: i <= strength.score
                                                        ? strengthColors[strength.score]
                                                        : "#1E2233",
                                                }}
                                            />
                                        ))}
                                    </div>
                                    <span
                                        className="strength-label"
                                        style={{ color: strengthColors[strength.score] }}
                                    >
                    {STRENGTH_LABELS[strength.score]} · {strength.entropy} bits
                  </span>
                                </div>
                            )}
                        </div>

                        {/* Confirmation mot de passe — inscription uniquement */}
                        {mode === "register" && (
                            <div className="auth-field">
                                <label htmlFor="confirm">Confirmer le mot de passe</label>
                                <input
                                    id="confirm"
                                    type={showPassword ? "text" : "password"}
                                    value={form.confirmPassword}
                                    onChange={(e) => update("confirmPassword", e.target.value)}
                                    placeholder="Répétez le mot de passe"
                                    autoComplete="new-password"
                                    disabled={loading}
                                />
                            </div>
                        )}

                        {/* Notice Argon2id — pendant le chargement */}
                        {argonStep && (
                            <div className="argon-notice">
                                <Loader2 size={14} strokeWidth={2} className="argon-spinner" />
                                <span>{argonStep} (~2s)</span>
                            </div>
                        )}

                        {/* Message d'erreur */}
                        {error && (
                            <div className="auth-error" role="alert">
                                <AlertTriangle size={14} strokeWidth={2} /> {error}
                            </div>
                        )}

                        {/* Avertissement master password — inscription uniquement */}
                        {mode === "register" && (
                            <div className="master-warning">
                                <AlertTriangle size={14} strokeWidth={2} className="warning-icon" />
                                <p>
                                    <strong>Important :</strong> ce mot de passe maître est la seule clé
                                    de votre vault. Il ne peut pas être réinitialisé - notez-le en lieu sûr.
                                </p>
                            </div>
                        )}

                        <button
                            type="submit"
                            className="btn-submit"
                            disabled={loading}
                        >
                            {loading
                                ? argonStep ?? "Chargement…"
                                : mode === "login"
                                    ? "Déverrouiller le vault"
                                    : "Créer mon vault"}
                        </button>

                        {mode === "register" && (
                            <p className="auth-legal-consent">
                                En créant un compte, vous acceptez les{" "}
                                <Link to="/terms">conditions d'utilisation</Link> et la{" "}
                                <Link to="/privacy">politique de confidentialité</Link>.
                            </p>
                        )}

                    </form>

                    <div className="auth-switch">
                        {mode === "login" ? (
                            <>Pas encore de compte ?{" "}
                                <button onClick={() => switchMode("register")} type="button">
                                    Créer un compte
                                </button>
                            </>
                        ) : (
                            <>Déjà un compte ?{" "}
                                <button onClick={() => switchMode("login")} type="button">
                                    Se connecter
                                </button>
                            </>
                        )}
                    </div>

                    <div className="auth-legal-footer">
                        <Link to="/privacy">Confidentialité</Link>
                        <Link to="/terms">CGU</Link>
                        <Link to="/cookies">Cookies</Link>
                    </div>

                </div>
            </div>
        </div>
    );
}

// ─────────────────────────────────────────────────────────
// CONSTANTES
// ─────────────────────────────────────────────────────────

const STRENGTH_LABELS = ["Très faible", "Faible", "Correct", "Fort", "Très fort"];
