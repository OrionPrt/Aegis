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
import { parseVaultPlaintext, serializeVault, type VaultData } from "./vault-format";

// ─────────────────────────────────────────────────────────
// CONSTANTES
// ─────────────────────────────────────────────────────────

interface Argon2Params {
    memorySize: number;  // KiB
    iterations: number;
    parallelism: number;
}

/**
 * Paramètres Argon2id par version de dérivation. La version de chaque compte
 * est stockée côté serveur (User.kdfVersion, renvoyée par /auth/salt) : pour
 * renforcer les paramètres, ajouter une version ici et passer
 * CURRENT_KDF_VERSION dessus (côté client et dans backend/src/server/lib/kdf.ts)
 * - les comptes existants continuent de dériver avec la leur.
 * OWASP recommande au minimum m=19456, t=2, p=1.
 */
const KDF_PARAMS: Readonly<Record<number, Argon2Params>> = {
    1: {
        memorySize: 65536,   // 64 MiB — résistance aux attaques GPU
        iterations: 3,       // 3 passes
        parallelism: 4,      // 4 threads
    },
};

/** Version utilisée pour tout nouveau compte. */
export const CURRENT_KDF_VERSION = 1;

/** 512 bits → 32 pour masterKey + 32 pour authKey */
const DERIVED_KEY_LENGTH = 64;

const AES_KEY_LENGTH = 256;   // bits
const IV_LENGTH      = 12;    // bytes — recommandé pour AES-GCM (96 bits)
const SALT_LENGTH    = 32;    // bytes — sel aléatoire pour Argon2

/**
 * Octets convertis par appel à String.fromCharCode : chaque octet devient un
 * argument de fonction, et les moteurs plafonnent leur nombre (V8 vers
 * 125 000, JavaScriptCore à 65 536). 32 Ko reste sous toutes les limites.
 */
const BASE64_CHUNK_SIZE = 0x8000;

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
    username?: string;
    password?: string;
    url?: string;
    notes?: string;
    /** Dossier de l'entrée (voir vault-format.ts) ; absent = sans dossier. */
    folderId?: string;
    createdAt: number;
    updatedAt: number;
}

// ─────────────────────────────────────────────────────────
// UTILITAIRES
// ─────────────────────────────────────────────────────────

/** Convertit un ArrayBuffer en chaîne Base64, par morceaux (voir BASE64_CHUNK_SIZE) */
function bufferToBase64(buffer: ArrayBufferLike): string {
    const bytes = new Uint8Array(buffer);
    const chunks: string[] = [];
    for (let offset = 0; offset < bytes.length; offset += BASE64_CHUNK_SIZE) {
        chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + BASE64_CHUNK_SIZE)));
    }
    return btoa(chunks.join(""));
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
 * @param kdfVersion     - Version des paramètres Argon2 du compte (/auth/salt)
 */
export async function deriveKeys(
    masterPassword: string,
    email: string,
    saltBase64: string,
    kdfVersion: number = CURRENT_KDF_VERSION
): Promise<DerivedKeys> {
    const params = KDF_PARAMS[kdfVersion];
    if (!params) throw new Error(`Version de dérivation de clé non prise en charge : ${kdfVersion}.`);

    // Le "poivre" contextuel évite les collisions inter-utilisateurs
    // même si deux utilisateurs ont le même mot de passe. L'email est
    // normalisé ici, comme côté serveur : une espace ou une majuscule de
    // plus donnerait sinon d'autres clés, et un coffre indéchiffrable.
    const contextualPassword = `aegis:${email.trim().toLowerCase()}:${masterPassword}`;
    const salt = base64ToBuffer(saltBase64);

    // Argon2id → 64 bytes de matériel de clé
    const hashHex = await argon2id({
        password: contextualPassword,
        salt,
        ...params,
        hashLength: DERIVED_KEY_LENGTH,
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
 * @param data      - Contenu du coffre (entrées + dossiers), sérialisé au format courant
 * @param masterKey - Clé dérivée via deriveKeys()
 * @returns         - { ciphertext, iv } à stocker sur le serveur
 */
export async function encryptVault(
    data: VaultData,
    masterKey: CryptoKey
): Promise<EncryptedPayload> {
    // IV unique et aléatoire pour CHAQUE chiffrement — obligatoire en GCM
    const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(IV_LENGTH)));

    const plaintext = new TextEncoder().encode(serializeVault(data));

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
 * @returns         - Contenu du coffre (un coffre v1 est lu sans dossiers)
 * @throws          - Si la clé est incorrecte, les données corrompues ou le
 *                    format non reconnu
 */
export async function decryptVault(
    payload: EncryptedPayload,
    masterKey: CryptoKey
): Promise<VaultData> {
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

    return parseVaultPlaintext(new TextDecoder().decode(plaintextBuffer));
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

/** Réglages complets du générateur (toutes les options renseignées). */
export type GeneratorSettings = Required<PasswordOptions>;

export const DEFAULT_GENERATOR_SETTINGS: GeneratorSettings = {
    length:           20,
    uppercase:        true,
    lowercase:        true,
    numbers:          true,
    symbols:          true,
    excludeAmbiguous: false,
};

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
