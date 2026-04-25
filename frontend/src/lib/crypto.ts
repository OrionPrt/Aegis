/**
 * ╔═══════════════════════════════════════════════════════╗
 * ║              AEGIS — Module Cryptographique           ║
 * ║                    Zero-Knowledge Core                ║
 * ╚═══════════════════════════════════════════════════════╝
 *
 * Principes :
 *  - Tout chiffrement/déchiffrement se fait côté CLIENT uniquement
 *  - Le serveur ne voit jamais le master password ni les données en clair
 *  - Deux clés sont dérivées du master password :
 *      • masterKey  → chiffre/déchiffre le vault (AES-256-GCM)
 *      • authKey    → s'authentifie auprès du serveur (ne peut pas déchiffrer)
 *
 * Dépendances :
 *   npm install hash-wasm
 *
 * Algorithmes :
 *   - Dérivation de clé  : Argon2id  (via hash-wasm WASM)
 *   - Chiffrement        : AES-256-GCM (Web Crypto API native)
 *   - Hachage utilitaire : SHA-256    (Web Crypto API native)
 */

import { argon2id } from "hash-wasm";

// ─────────────────────────────────────────────────────────
// CONSTANTES
// ─────────────────────────────────────────────────────────

/** Paramètres Argon2id — OWASP recommande minimum m=19456, t=2, p=1 */
const ARGON2_PARAMS = {
    memorySize: 65536,   // 64 MiB — résistance aux attaques GPU
    iterations: 3,       // 3 passes
    parallelism: 4,      // 4 threads
    outputLen: 64,       // 512 bits → 32 pour masterKey + 32 pour authKey
} as const;

const AES_KEY_LENGTH = 256;   // bits
const IV_LENGTH      = 12;    // bytes — recommandé pour AES-GCM (96 bits)
const SALT_LENGTH    = 32;    // bytes — sel aléatoire pour Argon2

// ─────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────

export interface DerivedKeys {
    /** Clé de chiffrement du vault — ne quitte JAMAIS le client */
    masterKey: CryptoKey;
    /** Clé d'authentification envoyée au serveur — ne peut PAS déchiffrer */
    authKeyHex: string;
}

export interface EncryptedPayload {
    /** Données chiffrées en Base64 */
    ciphertext: string;
    /** Vecteur d'initialisation en Base64 (unique par chiffrement) */
    iv: string;
}

export interface VaultEntry {
    id: string;
    label: string;
    username: string;
    password: string;
    url?: string;
    notes?: string;
    createdAt: number;
    updatedAt: number;
}

// ─────────────────────────────────────────────────────────
// UTILITAIRES
// ─────────────────────────────────────────────────────────

/** Convertit un ArrayBuffer en chaîne Base64 */
function bufferToBase64(buffer: ArrayBufferLike): string {
    return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

/** Convertit une chaîne Base64 en Uint8Array */
function base64ToBuffer(base64: string): Uint8Array {
    return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

/** Convertit un Uint8Array en chaîne hexadécimale */
function bufferToHex(buffer: Uint8Array): string {
    return Array.from(buffer)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
}

/**
 * Génère un sel aléatoire cryptographiquement sûr.
 * À stocker côté serveur, lié au compte utilisateur.
 */
export function generateSalt(): string {
    const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
    return bufferToBase64(salt.buffer);
}

// ─────────────────────────────────────────────────────────
// DÉRIVATION DE CLÉS — Argon2id
// ─────────────────────────────────────────────────────────

/**
 * Dérive deux clés distinctes depuis le master password :
 *
 *   masterPassword + email + salt
 *         │
 *         ▼  Argon2id (64 bytes)
 *   [ 0..31 ] → masterKey  (import AES-256-GCM, non extractible)
 *   [ 32..63] → authKey    (hex, envoyé au serveur pour l'auth)
 *
 * @param masterPassword - Le mot de passe maître de l'utilisateur
 * @param email          - Email de l'utilisateur (personnalise la dérivation)
 * @param saltBase64     - Sel Base64 récupéré depuis le serveur
 */
export async function deriveKeys(
    masterPassword: string,
    email: string,
    saltBase64: string
): Promise<DerivedKeys> {
    // Le "poivre" contextuel évite les collisions inter-utilisateurs
    // même si deux utilisateurs ont le même mot de passe
    const contextualPassword = `aegis:${email.toLowerCase()}:${masterPassword}`;
    const salt = base64ToBuffer(saltBase64);

    // Argon2id → 64 bytes de matériel de clé
    const hashHex = await argon2id({
        password: contextualPassword,
        salt,
        ...ARGON2_PARAMS,
        hashLength: ARGON2_PARAMS.outputLen,
    });

    // Découpage du matériel de clé
    const keyMaterial = new Uint8Array(
        hashHex.match(/.{2}/g)!.map((byte) => parseInt(byte, 16))
    );
    const masterKeyBytes = keyMaterial.slice(0, 32);  // premiers 32 bytes
    const authKeyBytes   = keyMaterial.slice(32, 64); // derniers 32 bytes

    // Import de la masterKey en objet CryptoKey non-extractible
    const masterKey = await crypto.subtle.importKey(
        "raw",
        masterKeyBytes,
        { name: "AES-GCM", length: AES_KEY_LENGTH },
        false,        // ← NON EXTRACTIBLE — la clé ne peut pas être lue en mémoire
        ["encrypt", "decrypt"]
    );

    const authKeyHex = bufferToHex(authKeyBytes);

    // Nettoyage du matériel de clé brut de la mémoire
    keyMaterial.fill(0);
    masterKeyBytes.fill(0);
    authKeyBytes.fill(0);

    return { masterKey, authKeyHex };
}

// ─────────────────────────────────────────────────────────
// CHIFFREMENT — AES-256-GCM
// ─────────────────────────────────────────────────────────

/**
 * Chiffre le vault complet avec AES-256-GCM.
 *
 * GCM garantit à la fois :
 *  - La CONFIDENTIALITÉ (les données sont illisibles sans la clé)
 *  - L'INTÉGRITÉ     (toute modification est détectée — authentication tag)
 *
 * @param data      - Objet vault à chiffrer (sera sérialisé en JSON)
 * @param masterKey - Clé dérivée via deriveKeys()
 * @returns         - { ciphertext, iv } à stocker sur le serveur
 */
export async function encryptVault(
    data: VaultEntry[],
    masterKey: CryptoKey
): Promise<EncryptedPayload> {
    // IV unique et aléatoire pour CHAQUE chiffrement — obligatoire en GCM
    const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(IV_LENGTH)));

    const plaintext = new TextEncoder().encode(JSON.stringify(data));

    const ciphertextBuffer = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        masterKey,
        plaintext
    );

    return {
        ciphertext: bufferToBase64(ciphertextBuffer),
        iv: bufferToBase64(iv.buffer),
    };
}

/**
 * Déchiffre le vault avec AES-256-GCM.
 * Échoue si les données ont été altérées (intégrité GCM).
 *
 * @param payload   - { ciphertext, iv } reçu du serveur
 * @param masterKey - Clé dérivée via deriveKeys()
 * @returns         - Tableau d'entrées vault déchiffrées
 * @throws          - Si la clé est incorrecte ou les données corrompues
 */
export async function decryptVault(
    payload: EncryptedPayload,
    masterKey: CryptoKey
): Promise<VaultEntry[]> {
    const iv         = base64ToBuffer(payload.iv).slice() as Uint8Array<ArrayBuffer>;
    const ciphertext = base64ToBuffer(payload.ciphertext).slice() as Uint8Array<ArrayBuffer>;

    let plaintextBuffer: ArrayBuffer;
    try {
        plaintextBuffer = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv },
            masterKey,
            ciphertext
        );
    } catch {
        // Ne pas révéler si c'est la clé ou les données qui sont mauvaises
        throw new Error("Vault decryption failed: invalid key or corrupted data.");
    }

    const plaintext = new TextDecoder().decode(plaintextBuffer);
    return JSON.parse(plaintext) as VaultEntry[];
}

// ─────────────────────────────────────────────────────────
// GÉNÉRATEUR DE MOTS DE PASSE
// ─────────────────────────────────────────────────────────

export interface PasswordOptions {
    length?: number;        // défaut : 20
    uppercase?: boolean;    // défaut : true
    lowercase?: boolean;    // défaut : true
    numbers?: boolean;      // défaut : true
    symbols?: boolean;      // défaut : true
    excludeAmbiguous?: boolean; // exclut 0, O, l, 1, I — défaut : true
}

/**
 * Génère un mot de passe aléatoire cryptographiquement sûr.
 * Utilise crypto.getRandomValues() — jamais Math.random().
 */
export function generatePassword(options: PasswordOptions = {}): string {
    const {
        length          = 20,
        uppercase       = true,
        lowercase       = true,
        numbers         = true,
        symbols         = true,
        excludeAmbiguous = true,
    } = options;

    let charset = "";
    if (uppercase) charset += excludeAmbiguous ? "ABCDEFGHJKLMNPQRSTUVWXYZ" : "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    if (lowercase) charset += excludeAmbiguous ? "abcdefghjkmnpqrstuvwxyz"  : "abcdefghijklmnopqrstuvwxyz";
    if (numbers)   charset += excludeAmbiguous ? "23456789" : "0123456789";
    if (symbols)   charset += "!@#$%^&*()-_=+[]{}|;:,.<>?";

    if (!charset) throw new Error("At least one character set must be selected.");

    // Rejet uniforme : évite le biais statistique lié au modulo
    const randomValues = new Uint32Array(length * 2);
    crypto.getRandomValues(randomValues);

    let password = "";
    let i = 0;
    while (password.length < length) {
        const randomValue = randomValues[i++];
        const maxValid = Math.floor(0xFFFFFFFF / charset.length) * charset.length;
        if (randomValue < maxValid) {
            password += charset[randomValue % charset.length];
        }
        if (i >= randomValues.length) {
            crypto.getRandomValues(randomValues);
            i = 0;
        }
    }

    return password;
}

// ─────────────────────────────────────────────────────────
// SCORE DE FORCE D'UN MOT DE PASSE
// ─────────────────────────────────────────────────────────

export type PasswordStrength = "very-weak" | "weak" | "fair" | "strong" | "very-strong";

export interface PasswordStrengthResult {
    score: number;           // 0 à 4
    strength: PasswordStrength;
    entropy: number;         // bits d'entropie
    suggestions: string[];
}

/**
 * Évalue la force d'un mot de passe via l'entropie et des heuristiques.
 */
export function evaluatePasswordStrength(password: string): PasswordStrengthResult {
    let charsetSize = 0;
    if (/[a-z]/.test(password)) charsetSize += 26;
    if (/[A-Z]/.test(password)) charsetSize += 26;
    if (/[0-9]/.test(password)) charsetSize += 10;
    if (/[^a-zA-Z0-9]/.test(password)) charsetSize += 32;

    const entropy = password.length * Math.log2(charsetSize || 1);

    const suggestions: string[] = [];
    if (password.length < 12)          suggestions.push("Utilisez au moins 12 caractères.");
    if (!/[A-Z]/.test(password))       suggestions.push("Ajoutez des majuscules.");
    if (!/[a-z]/.test(password))       suggestions.push("Ajoutez des minuscules.");
    if (!/[0-9]/.test(password))       suggestions.push("Ajoutez des chiffres.");
    if (!/[^a-zA-Z0-9]/.test(password)) suggestions.push("Ajoutez des symboles.");

    let score: number;
    if      (entropy < 28) score = 0;
    else if (entropy < 36) score = 1;
    else if (entropy < 60) score = 2;
    else if (entropy < 80) score = 3;
    else                   score = 4;

    const strengths: PasswordStrength[] = ["very-weak", "weak", "fair", "strong", "very-strong"];

    return { score, strength: strengths[score], entropy: Math.round(entropy), suggestions };
}
