/**
 * ╔═══════════════════════════════════════════════════════╗
 * ║         AEGIS — Gabarit pages légales                 ║
 * ║         src/pages/LegalLayout.tsx                     ║
 * ╚═══════════════════════════════════════════════════════╝
 */

import { Link, useLocation, useNavigate } from "react-router-dom";
import { Shield, ArrowLeft } from "lucide-react";
import "./LegalLayout.css";

// Clé que React Router attribue à la toute première entrée de l'historique :
// la page a été ouverte directement (nouvel onglet, lien externe…), il n'y a
// donc aucune page de l'app vers laquelle revenir.
const INITIAL_HISTORY_KEY = "default";

export function LegalLayout({
                                 title, updated, children,
                             }: {
    title: string;
    updated: string;
    children: React.ReactNode;
}) {
    const navigate = useNavigate();
    const location = useLocation();

    function handleBack() {
        if (location.key === INITIAL_HISTORY_KEY) {
            navigate("/", { replace: true });
            return;
        }
        navigate(-1);
    }

    return (
        <div className="legal-layout">
            <div className="legal-container">
                <button className="legal-back" onClick={handleBack}>
                    <ArrowLeft size={14} strokeWidth={2} /> Retour
                </button>

                <div className="legal-brand">
                    <span className="legal-brand-mark"><Shield size={16} strokeWidth={2} /></span>
                    <span className="legal-brand-name">Aegis</span>
                </div>

                {/* `replace` : passer d'une page légale à l'autre remplace l'entrée
                    courante au lieu d'en empiler une nouvelle, pour que "Retour"
                    (et le bouton retour du navigateur) ramène à la page d'origine. */}
                <nav className="legal-nav">
                    <Link to="/privacy" replace>Confidentialité</Link>
                    <Link to="/terms" replace>Conditions d'utilisation</Link>
                    <Link to="/cookies" replace>Cookies</Link>
                </nav>

                <h1 className="legal-title">{title}</h1>
                <p className="legal-updated">Dernière mise à jour : {updated}</p>

                <div className="legal-content">
                    {children}
                </div>
            </div>
        </div>
    );
}
