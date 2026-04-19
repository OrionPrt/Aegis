/**
 * ╔═══════════════════════════════════════════════════════╗
 * ║         AEGIS — Authentification Client               ║
 * ║              src/lib/auth-client.ts                   ║
 * ╚═══════════════════════════════════════════════════════╝
 *
 * Flux Zero-Knowledge :
 *
 *  REGISTER
 *  ─────────────────────────────────────────────────────
 *  1. Génère un sel aléatoire côté client
 *  2. Dérive masterKey + authKey via Argon2id
 *  3. Envoie { email, authKey, salt } au serveur
 *  4. Le serveur stocke bcrypt(authKey) — jamais le master password
 *
 *  LOGIN
 *  ─────────────────────────────────────────────────────
 *  1. Récupère le sel de l'utilisateur depuis le serveur
 *  2. Dérive masterKey + authKey via Argon2id
 *  3. Envoie { email, authKey } au serveur pour vérification
 *  4. Reçoit accessToken (mémoire) + refreshToken (cookie httpOnly)
 *  5. masterKey reste uniquement en mémoire, jamais persistée
 */

import { deriveKeys, generateSalt, type DerivedKeys } from "./crypto";

// ─────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────

export interface RegisterPayload {
    email: string;
    authKeyHex: string;
    saltBase64: string;
}

export interface LoginPayload {
    email: string;
    authKeyHex: string;
}

export interface AuthTokens {
    accessToken: string;  // JWT court-terme (15 min) — stocké en mémoire
    expiresAt: number;    // timestamp unix
}

export interface AuthSession {
    tokens: AuthTokens;
    keys: DerivedKeys;    // masterKey en mémoire (jamais persistée)
    email: string;
}

export interface SaltResponse {
    saltBase64: string;
}

// ─────────────────────────────────────────────────────────
// GESTIONNAIRE DE SESSION EN MÉMOIRE
// (aucune persistance localStorage/sessionStorage)
// ─────────────────────────────────────────────────────────

let _session: AuthSession | null = null;

export function getSession(): AuthSession | null {
    return _session;
}

export function isAuthenticated(): boolean {
    if (!_session) return false;
    return Date.now() < _session.tokens.expiresAt;
}

export function clearSession(): void {
    _session = null;
}

// ─────────────────────────────────────────────────────────
// INSCRIPTION
// ─────────────────────────────────────────────────────────

/**
 * Inscrit un nouvel utilisateur.
 *
 * Étapes :
 *  1. Génère un sel fort côté client
 *  2. Dérive masterKey + authKey (Argon2id)
 *  3. Envoie email + authKey + sel au serveur
 *  4. Conserve la session en mémoire
 *
 * @returns AuthSession prête à l'emploi si succès
 */
export async function register(
    email: string,
    masterPassword: string
): Promise<AuthSession> {
    // 1. Sel généré côté client (32 bytes, base64)
    const saltBase64 = generateSalt();

    // 2. Dérivation des clés — peut prendre ~1-3s (c'est voulu : Argon2id)
    const keys = await deriveKeys(masterPassword, email, saltBase64);

    // 3. Envoi au serveur — le master password NE TRANSITE PAS
    const payload: RegisterPayload = {
        email: email.toLowerCase().trim(),
        authKeyHex: keys.authKeyHex,
        saltBase64,
    };

    const response = await apiFetch("/auth/register", {
        method: "POST",
        body: JSON.stringify(payload),
    });

    const { accessToken, expiresAt } = response as AuthTokens & { expiresAt: number };

    // 4. Session en mémoire uniquement
    _session = {
        tokens: { accessToken, expiresAt },
        keys,
        email: email.toLowerCase().trim(),
    };

    return _session;
}

// ─────────────────────────────────────────────────────────
// CONNEXION
// ─────────────────────────────────────────────────────────

/**
 * Connecte un utilisateur existant.
 *
 * Étapes :
 *  1. Récupère le sel de l'utilisateur depuis le serveur
 *     (sans révéler si l'email existe : timing attack mitigation)
 *  2. Dérive masterKey + authKey avec ce sel
 *  3. Envoie authKey pour vérification
 *  4. Stocke la session en mémoire
 */
export async function login(
    email: string,
    masterPassword: string
): Promise<AuthSession> {
    const normalizedEmail = email.toLowerCase().trim();

    // 1. Récupération du sel (le serveur retourne toujours un sel,
    //    même si l'email n'existe pas — évite l'énumération d'emails)
    const { saltBase64 } = await apiFetch(
        `/auth/salt?email=${encodeURIComponent(normalizedEmail)}`
    ) as SaltResponse;

    // 2. Dérivation des clés
    const keys = await deriveKeys(masterPassword, normalizedEmail, saltBase64);

    // 3. Vérification de l'authKey côté serveur
    const payload: LoginPayload = {
        email: normalizedEmail,
        authKeyHex: keys.authKeyHex,
    };

    const response = await apiFetch("/auth/login", {
        method: "POST",
        body: JSON.stringify(payload),
    });

    const { accessToken, expiresAt } = response as AuthTokens & { expiresAt: number };

    // 4. Session en mémoire
    _session = {
        tokens: { accessToken, expiresAt },
        keys,
        email: normalizedEmail,
    };

    return _session;
}

// ─────────────────────────────────────────────────────────
// DÉCONNEXION
// ─────────────────────────────────────────────────────────

/**
 * Révoque les tokens et efface la session mémoire.
 * Le refreshToken (httpOnly cookie) est effacé par le serveur.
 */
export async function logout(): Promise<void> {
    try {
        await apiFetch("/auth/logout", { method: "POST" });
    } finally {
        // Toujours effacer la session locale, même si le réseau échoue
        clearSession();
    }
}

// ─────────────────────────────────────────────────────────
// RAFRAÎCHISSEMENT DU TOKEN
// ─────────────────────────────────────────────────────────

/**
 * Rafraîchit l'access token via le refresh token (cookie httpOnly).
 * Appelé automatiquement par apiFetch() quand l'access token expire.
 */
async function refreshAccessToken(): Promise<string> {
    const response = await fetch("/api/auth/refresh", {
        method: "POST",
        credentials: "include", // envoie le cookie httpOnly
    });

    if (!response.ok) {
        clearSession();
        throw new AuthError("Session expirée. Veuillez vous reconnecter.", 401);
    }

    const { accessToken, expiresAt } = await response.json();

    if (_session) {
        _session.tokens = { accessToken, expiresAt };
    }

    return accessToken;
}

// ─────────────────────────────────────────────────────────
// CLIENT HTTP SÉCURISÉ
// ─────────────────────────────────────────────────────────

const API_BASE = import.meta.env.VITE_API_URL ?? "/api";

/**
 * Wrapper fetch avec :
 *  - Injection automatique du Bearer token
 *  - Rafraîchissement automatique si token expiré (401)
 *  - Gestion d'erreurs typée
 */
export async function apiFetch(
    path: string,
    options: RequestInit = {}
): Promise<unknown> {
    // Rafraîchissement proactif (si expiré dans < 60s)
    if (_session && Date.now() > _session.tokens.expiresAt - 60_000) {
        await refreshAccessToken();
    }

    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        ...(options.headers as Record<string, string>),
    };

    if (_session?.tokens.accessToken) {
        headers["Authorization"] = `Bearer ${_session.tokens.accessToken}`;
    }

    const response = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers,
        credentials: "include", // pour les cookies httpOnly
    });

    // Retry automatique après rafraîchissement du token
    if (response.status === 401 && _session) {
        const newToken = await refreshAccessToken();
        headers["Authorization"] = `Bearer ${newToken}`;
        const retryResponse = await fetch(`${API_BASE}${path}`, {
            ...options,
            headers,
            credentials: "include",
        });
        return handleResponse(retryResponse);
    }

    return handleResponse(response);
}

async function handleResponse(response: Response): Promise<unknown> {
    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new AuthError(
            body.message ?? "Une erreur est survenue.",
            response.status
        );
    }

    return body;
}

// ─────────────────────────────────────────────────────────
// ERREURS TYPÉES
// ─────────────────────────────────────────────────────────

export class AuthError extends Error {
    readonly status: number;
    constructor(message: string, status: number) {
        super(message);
        this.name = "AuthError";
        this.status = status;
    }
}
