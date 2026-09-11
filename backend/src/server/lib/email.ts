/**
 * ╔═══════════════════════════════════════════════════════╗
 * ║         AEGIS - Notifications par email (Resend)      ║
 * ║           src/server/lib/email.ts                     ║
 * ╚═══════════════════════════════════════════════════════╝
 *
 * Notifications de sécurité uniquement - jamais de contenu du vault (le
 * serveur ne le voit jamais en clair de toute façon, zero-knowledge oblige).
 * L'envoi ne doit jamais faire échouer l'action de sécurité qu'il accompagne :
 * toute erreur est journalisée puis avalée, comme pour logAudit().
 */

import { Resend } from "resend";

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM   = process.env.EMAIL_FROM ?? "Aegis <onboarding@resend.dev>";

export interface EmailEventContext {
    ipAddress: string;
    userAgent: string;
}

// ─────────────────────────────────────────────────────────
// GABARIT
// ─────────────────────────────────────────────────────────

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function formatDate(date: Date): string {
    return `${date.toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short", timeZone: "UTC" })} UTC`;
}

function layout(title: string, bodyHtml: string): string {
    return `
        <div style="font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; max-width: 480px; margin: 0 auto; color: #1a1a1a;">
            <div style="padding: 24px 0 16px; border-bottom: 2px solid #1a1a1a;">
                <strong style="font-size: 18px;">🛡️ Aegis</strong>
            </div>
            <div style="padding: 24px 0;">
                <h1 style="font-size: 17px; margin: 0 0 12px;">${escapeHtml(title)}</h1>
                ${bodyHtml}
            </div>
            <div style="padding: 16px 0; border-top: 1px solid #e5e5e5; font-size: 12px; color: #888;">
                Cet email a été envoyé automatiquement suite à une action sur votre compte Aegis.
            </div>
        </div>
    `;
}

function eventDetailsHtml(ctx: EmailEventContext): string {
    return `
        <table style="font-size: 13px; color: #555; margin: 16px 0; border-collapse: collapse;">
            <tr><td style="padding: 2px 12px 2px 0; color: #888;">Date</td><td>${escapeHtml(formatDate(new Date()))}</td></tr>
            <tr><td style="padding: 2px 12px 2px 0; color: #888;">Adresse IP</td><td>${escapeHtml(ctx.ipAddress)}</td></tr>
            <tr><td style="padding: 2px 12px 2px 0; color: #888;">Appareil</td><td>${escapeHtml(ctx.userAgent)}</td></tr>
        </table>
    `;
}

// ─────────────────────────────────────────────────────────
// ENVOI
// ─────────────────────────────────────────────────────────

async function sendEmail(to: string, subject: string, html: string): Promise<void> {
    if (!resend) {
        console.warn(`[email] RESEND_API_KEY manquant - email non envoyé ("${subject}" à ${to})`);
        return;
    }
    try {
        await resend.emails.send({ from: FROM, to, subject, html });
    } catch (err) {
        console.error("[email] Échec d'envoi:", err);
    }
}

// ─────────────────────────────────────────────────────────
// NOTIFICATIONS
// ─────────────────────────────────────────────────────────

export async function sendPasswordChangedEmail(to: string, ctx: EmailEventContext): Promise<void> {
    await sendEmail(
        to,
        "Votre mot de passe maître Aegis a été changé",
        layout("Mot de passe maître changé", `
            <p>Le mot de passe maître de votre compte Aegis vient d'être changé. Toutes vos
            sessions actives ont été déconnectées - une reconnexion avec le nouveau mot de
            passe est nécessaire sur chaque appareil.</p>
            ${eventDetailsHtml(ctx)}
            <p style="color: #b02a2a;"><strong>Ce n'était pas vous ?</strong> Aegis fonctionne
            en zero-knowledge : personne, pas même nous, ne peut réinitialiser ce mot de passe
            à votre place. Si vous ne pouvez plus accéder à votre compte, la seule option est
            de le supprimer et d'en recréer un.</p>
        `)
    );
}

export async function sendNewIpLoginEmail(to: string, ctx: EmailEventContext): Promise<void> {
    await sendEmail(
        to,
        "Nouvelle connexion à votre compte Aegis",
        layout("Nouvelle connexion détectée", `
            <p>Une connexion à votre compte Aegis vient d'être effectuée depuis une adresse IP
            que nous n'avions encore jamais vue pour ce compte.</p>
            ${eventDetailsHtml(ctx)}
            <p style="color: #b02a2a;"><strong>Ce n'était pas vous ?</strong> Changez
            immédiatement votre mot de passe maître depuis l'application, puis déconnectez
            toutes les sessions depuis la page Sécurité.</p>
        `)
    );
}
