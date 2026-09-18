/**
 * ╔═══════════════════════════════════════════════════════╗
 * ║         AEGIS — Gabarit pages légales                 ║
 * ║         src/pages/LegalLayout.tsx                     ║
 * ╚═══════════════════════════════════════════════════════╝
 */

import { Link, useNavigate } from "react-router-dom";
import { Shield, ArrowLeft } from "lucide-react";
import "./LegalLayout.css";

export function LegalLayout({
                                 title, updated, children,
                             }: {
    title: string;
    updated: string;
    children: React.ReactNode;
}) {
    const navigate = useNavigate();

    return (
        <div className="legal-layout">
            <div className="legal-container">
                <button className="legal-back" onClick={() => navigate(-1)}>
                    <ArrowLeft size={14} strokeWidth={2} /> Retour
                </button>

                <div className="legal-brand">
                    <span className="legal-brand-mark"><Shield size={16} strokeWidth={2} /></span>
                    <span className="legal-brand-name">Aegis</span>
                </div>

                <nav className="legal-nav">
                    <Link to="/privacy">Confidentialité</Link>
                    <Link to="/terms">Conditions d'utilisation</Link>
                    <Link to="/cookies">Cookies</Link>
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
