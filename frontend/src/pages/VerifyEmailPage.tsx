/**
 * ╔═══════════════════════════════════════════════════════╗
 * ║           AEGIS — Confirmation de l'adresse email     ║
 * ║           src/pages/VerifyEmailPage.tsx               ║
 * ╚═══════════════════════════════════════════════════════╝
 *
 * Page ouverte par le lien de l'email d'inscription (?token=…). La
 * confirmation attend un clic : certains filtres de messagerie ouvrent les
 * liens des emails tout seuls, ils ne doivent pas activer le compte à la
 * place de son titulaire.
 */

import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertTriangle, Shield, ShieldCheck } from "lucide-react";
import { AuthError, verifyEmail } from "../lib/auth-client";
import "./AuthPage.css";

type Step = "ready" | "verifying" | "done" | "failed";

export default function VerifyEmailPage() {
    const [searchParams] = useSearchParams();
    const token = searchParams.get("token") ?? "";

    const [step,    setStep]    = useState<Step>(token ? "ready" : "failed");
    const [message, setMessage] = useState(token ? "" : "Ce lien de confirmation est incomplet.");

    async function handleConfirm() {
        setStep("verifying");
        try {
            setMessage(await verifyEmail(token));
            setStep("done");
        } catch (err) {
            setMessage(err instanceof AuthError ? err.message : "Une erreur inattendue est survenue.");
            setStep("failed");
        }
    }

    return (
        <div className="auth-layout verify-layout">
            <div className="auth-right">
                <div className="auth-card verify-card">
                    <div className="auth-brand verify-brand">
                        <span className="brand-mark"><Shield size={18} strokeWidth={2} /></span>
                        <div className="brand-name">Aegis</div>
                    </div>

                    <h1 className="verify-title">Confirmer votre adresse email</h1>

                    {(step === "ready" || step === "verifying") && (
                        <>
                            <p className="verify-text">
                                Un clic suffit pour activer votre compte. Vous pourrez ensuite vous
                                connecter avec votre mot de passe maître.
                            </p>
                            <button className="btn-submit" onClick={handleConfirm} disabled={step === "verifying"}>
                                {step === "verifying" ? "Confirmation…" : "Confirmer mon adresse"}
                            </button>
                        </>
                    )}

                    {step === "done" && (
                        <>
                            <div className="auth-notice" role="status">
                                <ShieldCheck size={14} strokeWidth={2} /> {message}
                            </div>
                            <Link className="btn-submit verify-action" to="/login">Se connecter</Link>
                        </>
                    )}

                    {step === "failed" && (
                        <>
                            <div className="auth-error" role="alert">
                                <AlertTriangle size={14} strokeWidth={2} /> {message}
                            </div>
                            <p className="verify-text">
                                Le lien est valable 24 heures et ne sert qu'une fois. Pour en recevoir un
                                nouveau, essayez de vous connecter : l'écran de connexion vous le proposera.
                            </p>
                            <Link className="verify-link" to="/login">Aller à la connexion</Link>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
