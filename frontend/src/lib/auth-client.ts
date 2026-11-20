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

import { deriveKeys, generateSalt, encryptVault, CURRENT_KDF_VERSION, type DerivedKeys, type EncryptedPayload, type VaultEntry } from "./crypto";

// ─────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────

export interface RegisterPayload {
    email: string;
    authKeyHex: string;
    saltBase64: string;
    /** Version des paramètres Argon2 utilisés, stockée avec le compte. */
    kdfVersion: number;
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
    /** Version des paramètres Argon2 du compte. */
    kdfVersion: number;
}

// ─────────────────────────────────────────────────────────
// GESTIONNAIRE DE SESSION EN MÉMOIRE
// (aucune persistance localStorage/sessionStorage)
// ─────────────────────────────────────────────────────────

let _session: AuthSession | null = null;

type SessionListener = () => void;
const sessionListeners = new Set<SessionListener>();

/**
 * Prévient `listener` à chaque ouverture ou fermeture de session (pas au
 * simple renouvellement du jeton). Retourne la fonction de désabonnement -
 * forme attendue par useSyncExternalStore.
 */
export function subscribeSession(listener: SessionListener): () => void {
    sessionListeners.add(listener);
    return () => { sessionListeners.delete(listener); };
}

function setSession(next: AuthSession | null): void {
    _session = next;
    for (const listener of sessionListeners) listener();
}

export function getSession(): AuthSession | null {
    return _session;
}

export function isAuthenticated(): boolean {
    if (!_session) return false;
    return Date.now() < _session.tokens.expiresAt;
}

export function clearSession(): void {
    if (_session === null) return;
    setSession(null);
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
    const keys = await deriveKeys(masterPassword, email, saltBase64, CURRENT_KDF_VERSION);

    // 3. Envoi au serveur — le master password NE TRANSITE PAS
    const payload: RegisterPayload = {
        email: email.toLowerCase().trim(),
        authKeyHex: keys.authKeyHex,
        saltBase64,
        kdfVersion: CURRENT_KDF_VERSION,
    };

    const response = await apiFetch("/auth/register", {
        method: "POST",
        body: JSON.stringify(payload),
    });

    const { accessToken, expiresAt } = response as AuthTokens & { expiresAt: number };

    // 4. Session en mémoire uniquement
    const session: AuthSession = {
        tokens: { accessToken, expiresAt },
        keys,
        email: email.toLowerCase().trim(),
    };
    setSession(session);

    return session;
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
    const { saltBase64, kdfVersion } = await apiFetch(
        `/auth/salt?email=${encodeURIComponent(normalizedEmail)}`
    ) as SaltResponse;

    // 2. Dérivation des clés, avec les paramètres propres au compte
    const keys = await deriveKeys(masterPassword, normalizedEmail, saltBase64, kdfVersion);

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
    const session: AuthSession = {
        tokens: { accessToken, expiresAt },
        keys,
        email: normalizedEmail,
    };
    setSession(session);

    return session;
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
// CHANGEMENT DU MOT DE PASSE MAÎTRE
// ─────────────────────────────────────────────────────────

export interface ChangePasswordPayload {
    currentAuthKeyHex: string;
    newAuthKeyHex:     string;
    vault:             EncryptedPayload;
    /** Version du coffre dont viennent les entrées rechiffrées (409 si dépassée). */
    baseVersion:       number;
}

/**
 * Change le mot de passe maître.
 *
 * Étapes :
 *  1. Re-dérive les clés depuis le mot de passe ACTUEL (confirme l'identité)
 *  2. Dérive les nouvelles clés depuis le NOUVEAU mot de passe (même sel -
 *     le sel protège contre le précalcul multi-utilisateurs, pas contre la
 *     réutilisation d'un mot de passe)
 *  3. Rechiffre le vault en mémoire avec la nouvelle masterKey
 *  4. Le serveur vérifie l'ancien authKey puis remplace authKeyHash + vault
 *     en une seule opération, et révoque toutes les sessions actives
 *  5. Efface la session locale — l'utilisateur doit se reconnecter partout
 *
 * @param vaultEntries - Les entrées du vault actuellement en mémoire (déjà
 *                       déchiffrées), à rechiffrer avec la nouvelle clé
 * @param baseVersion  - Version du coffre dont viennent ces entrées : le
 *                       serveur refuse (409) si un autre appareil a sauvegardé
 *                       depuis, plutôt que de perdre ses changements
 */
export async function changeMasterPassword(
    currentPassword: string,
    newPassword: string,
    vaultEntries: VaultEntry[],
    baseVersion: number
): Promise<void> {
    const session = getSession();
    if (!session) throw new AuthError("Session expirée.", 401);
    const { email } = session;

    const { saltBase64, kdfVersion } = await apiFetch(
        `/auth/salt?email=${encodeURIComponent(email)}`
    ) as SaltResponse;

    // Le compte garde sa version de dérivation : le serveur ne la change pas ici.
    const currentKeys = await deriveKeys(currentPassword, email, saltBase64, kdfVersion);
    const newKeys     = await deriveKeys(newPassword, email, saltBase64, kdfVersion);

    const vault = await encryptVault(vaultEntries, newKeys.masterKey);

    const payload: ChangePasswordPayload = {
        currentAuthKeyHex: currentKeys.authKeyHex,
        newAuthKeyHex:     newKeys.authKeyHex,
        vault,
        baseVersion,
    };

    // Requête dédiée (pas apiFetch) : apiFetch relance automatiquement toute
    // requête en 401 après un refresh de token, ce qui, ici, enverrait deux
    // fois le mauvais mot de passe actuel et compterait deux tentatives
    // échouées côté serveur au lieu d'une.
    if (Date.now() > session.tokens.expiresAt - 60_000) {
        await refreshAccessToken();
    }
    const response = await fetch(`${API_BASE}/auth/change-password`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...(getSession()?.tokens.accessToken
                ? { Authorization: `Bearer ${getSession()!.tokens.accessToken}` }
                : {}),
        },
        credentials: "include",
        body: JSON.stringify(payload),
    });
    await handleResponse(response);

    // Le serveur a révoqué toutes les sessions - la session locale n'est
    // plus valable, l'utilisateur doit se reconnecter avec le nouveau mdp.
    clearSession();
}

// ─────────────────────────────────────────────────────────
// SUPPRESSION DU COMPTE
// ─────────────────────────────────────────────────────────

export interface DeleteAccountPayload {
    authKeyHex: string;
}

/**
 * Supprime définitivement le compte et le vault.
 *
 * Exige une re-preuve du mot de passe maître : on ne réutilise jamais
 * `session.keys.authKeyHex` déjà en mémoire, on le re-dérive depuis ce que
 * l'utilisateur vient de taper. Réutiliser la valeur en mémoire annulerait
 * l'intérêt de cette vérification côté serveur - un attaquant qui a volé le
 * token d'accès (XSS, etc.) a généralement accès au même état JS.
 */
export async function deleteAccount(password: string): Promise<void> {
    const session = getSession();
    if (!session) throw new AuthError("Session expirée.", 401);
    const { email } = session;

    const { saltBase64, kdfVersion } = await apiFetch(
        `/auth/salt?email=${encodeURIComponent(email)}`
    ) as SaltResponse;

    const keys = await deriveKeys(password, email, saltBase64, kdfVersion);
    const payload: DeleteAccountPayload = { authKeyHex: keys.authKeyHex };

    // Requête dédiée (pas apiFetch) : même raison que changeMasterPassword -
    // éviter qu'un 401 (mauvais mot de passe) ne relance la requête et ne
    // compte deux tentatives échouées au lieu d'une.
    if (Date.now() > session.tokens.expiresAt - 60_000) {
        await refreshAccessToken();
    }
    const response = await fetch(`${API_BASE}/vault`, {
        method: "DELETE",
        headers: {
            "Content-Type": "application/json",
            ...(getSession()?.tokens.accessToken
                ? { Authorization: `Bearer ${getSession()!.tokens.accessToken}` }
                : {}),
        },
        credentials: "include",
        body: JSON.stringify(payload),
    });
    await handleResponse(response);

    clearSession();
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

    const { accessToken, expiresAt, email } = await response.json();

    // Une requête concurrente (ex: SessionsPage lance /sessions et
    // /sessions/audit en parallèle via Promise.all, ou React StrictMode
    // double-monte un composant en dev) peut avoir déjà détecté un problème
    // et vidé la session pendant que CE rafraîchissement était en vol. Ne
    // jamais adopter un token dans ce cas - la session locale n'existe plus,
    // rien ne garantit que ce token corresponde encore au bon compte.
    if (!_session) {
        throw new AuthError("Session expirée. Veuillez vous reconnecter.", 401);
    }

    // Sécurité anti-mélange de comptes : le cookie aegis_rt est partagé par
    // tout le navigateur (un seul par domaine), alors que masterKey vit en
    // mémoire PAR ONGLET. Si un autre compte a été connecté dans ce même
    // navigateur pendant que cet onglet restait ouvert (le cookie pointe
    // alors vers ce second compte), un rafraîchissement renverrait un
    // accessToken valide mais pour le MAUVAIS compte. Fusionner ce token
    // avec l'ancienne masterKey casserait silencieusement le déchiffrement
    // du vault - on refuse et on force une reconnexion propre à la place.
    if (email && email !== _session.email) {
        clearSession();
        throw new AuthError(
            "Un autre compte a été connecté sur ce navigateur. Reconnectez-vous.",
            401
        );
    }

    _session.tokens = { accessToken, expiresAt };
    return accessToken;
}

// ─────────────────────────────────────────────────────────
// CLIENT HTTP SÉCURISÉ
// ─────────────────────────────────────────────────────────

const API_BASE = (import.meta.env.VITE_API_URL ?? "") + "/api";

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

    // Content-Type uniquement si un corps est envoyé - Fastify rejette
    // (FST_ERR_CTP_EMPTY_JSON_BODY) une requête sans corps avec ce header.
    const headers: Record<string, string> = {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
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
