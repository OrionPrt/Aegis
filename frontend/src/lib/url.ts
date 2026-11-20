/**
 * URL enregistrées dans les entrées du coffre : seules les adresses web
 * (http, https) deviennent des liens. Un schéma comme javascript: ou data:
 * exécuterait du code dans l'origine qui détient la clé du coffre - React 19
 * et la CSP bloquent déjà javascript:, ceci ne laisse rien passer d'autre.
 */

const WEB_PROTOCOLS = new Set(["http:", "https:"]);
const HAS_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

/** L'URL normalisée si c'est une adresse http(s), sinon null. */
export function safeHttpUrl(value: string): string | null {
    try {
        const url = new URL(value);
        return WEB_PROTOCOLS.has(url.protocol) ? url.href : null;
    } catch {
        return null;
    }
}

/**
 * Valeur à enregistrer pour le champ URL d'une entrée : un domaine saisi
 * sans schéma (« github.com ») reçoit https://, un autre schéma est refusé.
 */
export function normalizeEntryUrl(input: string): { url?: string; error?: string } {
    const value = input.trim();
    if (!value) return { url: undefined };
    const candidate = HAS_SCHEME.test(value) && !/^[^:]+:\d/.test(value) ? value : `https://${value}`;
    if (!safeHttpUrl(candidate)) {
        return { error: "L'URL doit être une adresse web (http:// ou https://)." };
    }
    return { url: candidate };
}
