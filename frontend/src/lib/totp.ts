/**
 * ╔═══════════════════════════════════════════════════════╗
 * ║           AEGIS — Utilitaires TOTP (2FA)              ║
 * ║           src/lib/totp.ts                             ║
 * ╚═══════════════════════════════════════════════════════╝
 *
 * Génère les codes à usage unique (RFC 6238 / RFC 4226) pour les clés
 * secrètes 2FA stockées dans une entrée "login" — Aegis se comporte ici
 * comme une appli d'authentification (Google Authenticator, etc.), jamais
 * comme un émetteur : on ne génère pas de secret, on affiche le code
 * courant d'un secret déjà fourni par l'utilisateur.
 *
 * Pas de tolérance de dérive d'horloge (±1 fenêtre) : cette recommandation
 * RFC 6238 concerne un serveur qui valide un code soumis par un client.
 * Ici on ne fait qu'afficher le code courant, sans jamais rien valider.
 */

// ─────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────

export type TotpAlgorithm = "SHA-1" | "SHA-256" | "SHA-512";

export interface TotpConfig {
    secret:    string;         // base32 normalisé (majuscules, sans padding)
    algorithm: TotpAlgorithm;  // défaut "SHA-1"
    digits:    number;         // défaut 6
    period:    number;         // défaut 30 (secondes)
}

export interface ParsedTotpInput {
    secret:    string;
    issuer?:   string;
    algorithm: TotpAlgorithm;
    digits:    number;
    period:    number;
}

// ─────────────────────────────────────────────────────────
// BASE32 (RFC 4648)
// ─────────────────────────────────────────────────────────

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * Décode une chaîne base32 en octets. Rejette toute entrée invalide plutôt
 * que de tronquer silencieusement — un secret mal décodé produirait des
 * codes qui ont l'air valides mais ne correspondent jamais, ce qui est pire
 * qu'une erreur immédiate.
 */
export function base32Decode(input: string): Uint8Array<ArrayBuffer> {
    const cleaned = input.toUpperCase().replace(/[\s-]/g, "").replace(/=+$/, "");
    if (!cleaned || /[^A-Z2-7]/.test(cleaned)) {
        throw new Error("Clé secrète invalide (base32).");
    }

    const bytes: number[] = [];
    let buffer = 0;
    let bitsInBuffer = 0;

    for (const char of cleaned) {
        buffer = (buffer << 5) | BASE32_ALPHABET.indexOf(char);
        bitsInBuffer += 5;
        if (bitsInBuffer >= 8) {
            bitsInBuffer -= 8;
            bytes.push((buffer >>> bitsInBuffer) & 0xff);
        }
    }

    return new Uint8Array(bytes) as Uint8Array<ArrayBuffer>;
}

/** Ré-encode des octets en base32 (majuscules, sans padding). */
export function base32Encode(bytes: Uint8Array): string {
    let output = "";
    let buffer = 0;
    let bitsInBuffer = 0;

    for (const byte of bytes) {
        buffer = (buffer << 8) | byte;
        bitsInBuffer += 8;
        while (bitsInBuffer >= 5) {
            bitsInBuffer -= 5;
            output += BASE32_ALPHABET[(buffer >>> bitsInBuffer) & 0x1f];
        }
    }

    if (bitsInBuffer > 0) {
        output += BASE32_ALPHABET[(buffer << (5 - bitsInBuffer)) & 0x1f];
    }

    return output;
}

// ─────────────────────────────────────────────────────────
// PARSING — secret nu ou URI otpauth://
// ─────────────────────────────────────────────────────────

function parseAlgorithm(value: string | null): TotpAlgorithm {
    switch (value?.toUpperCase()) {
        case "SHA256": return "SHA-256";
        case "SHA512": return "SHA-512";
        default:       return "SHA-1";
    }
}

/**
 * Parse une URI `otpauth://totp/...?secret=...&issuer=...`. Retourne `null`
 * si l'entrée n'est pas une URI otpauth, pour que l'appelant la traite
 * comme un secret nu.
 */
export function parseOtpauthUri(input: string): ParsedTotpInput | null {
    const trimmed = input.trim();
    if (!/^otpauth:\/\//i.test(trimmed)) return null;

    const url = new URL(trimmed);
    const secret = url.searchParams.get("secret");
    if (!secret) throw new Error("Lien otpauth:// invalide (secret manquant).");

    const label = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    const issuer = url.searchParams.get("issuer") ?? label.split(":")[0] ?? undefined;

    return {
        secret,
        issuer: issuer || undefined,
        algorithm: parseAlgorithm(url.searchParams.get("algorithm")),
        digits: Number(url.searchParams.get("digits")) || 6,
        period: Number(url.searchParams.get("period")) || 30,
    };
}

/**
 * Point d'entrée unique côté UI : accepte un secret base32 nu ou une URI
 * otpauth:// complète, et retourne toujours une configuration normalisée
 * (secret ré-encodé proprement — espaces/minuscules/tirets éliminés).
 */
export function normalizeSecretInput(input: string): ParsedTotpInput {
    const parsed = parseOtpauthUri(input) ?? {
        secret: input,
        algorithm: "SHA-1" as TotpAlgorithm,
        digits: 6,
        period: 30,
    };

    const normalizedSecret = base32Encode(base32Decode(parsed.secret));
    if (!normalizedSecret) throw new Error("Clé secrète invalide.");

    return { ...parsed, secret: normalizedSecret };
}

/** Validation live pour le formulaire — ne lève jamais. */
export function isValidTotpSecret(input: string): boolean {
    try {
        normalizeSecretInput(input);
        return true;
    } catch {
        return false;
    }
}

// ─────────────────────────────────────────────────────────
// GÉNÉRATION DU CODE — RFC 6238 (TOTP) / RFC 4226 (HOTP)
// ─────────────────────────────────────────────────────────

function counterToBuffer(counter: number): ArrayBuffer {
    const buffer = new ArrayBuffer(8);
    const view = new DataView(buffer);
    // JS ne gère que 53 bits sûrs — largement suffisant (des millénaires de fenêtres de 30s)
    view.setUint32(0, Math.floor(counter / 2 ** 32));
    view.setUint32(4, counter % 2 ** 32);
    return buffer;
}

async function hotp(secretBytes: Uint8Array<ArrayBuffer>, counter: number, config: Pick<TotpConfig, "algorithm" | "digits">): Promise<string> {
    const key = await crypto.subtle.importKey(
        "raw",
        secretBytes,
        { name: "HMAC", hash: config.algorithm },
        false,
        ["sign"]
    );

    const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, counterToBuffer(counter)));

    const offset = signature[signature.length - 1] & 0x0f;
    const binCode =
        ((signature[offset] & 0x7f) << 24) |
        ((signature[offset + 1] & 0xff) << 16) |
        ((signature[offset + 2] & 0xff) << 8) |
        (signature[offset + 3] & 0xff);

    return (binCode % 10 ** config.digits).toString().padStart(config.digits, "0");
}

/** Calcule le code TOTP courant pour la configuration donnée. */
export async function generateTotpCode(config: TotpConfig, timestampMs: number = Date.now()): Promise<string> {
    const counter = Math.floor(timestampMs / 1000 / config.period);
    const secretBytes = base32Decode(config.secret);
    return hotp(secretBytes, counter, config);
}

/** Secondes restantes avant la rotation du code — synchrone, pilote la barre de progression. */
export function totpTimeRemaining(config: Pick<TotpConfig, "period">, timestampMs: number = Date.now()): number {
    const period = config.period;
    return period - (Math.floor(timestampMs / 1000) % period);
}
