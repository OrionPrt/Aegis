import { describe, it, expect } from "vitest";
import {
    deriveKeys,
    generateSalt,
    encryptVault,
    decryptVault,
    generatePassword,
    evaluatePasswordStrength,
    type VaultEntry,
} from "./crypto.js";

const SAMPLE_ENTRIES: VaultEntry[] = [
    { id: "1", label: "GitHub", username: "me@example.com", password: "s3cr3t!", createdAt: 1, updatedAt: 1 },
];

describe("deriveKeys", () => {
    it("is deterministic: same password/email/salt always yields the same authKeyHex", async () => {
        const salt = generateSalt();
        const a = await deriveKeys("MasterPassw0rd!", "user@example.com", salt);
        const b = await deriveKeys("MasterPassw0rd!", "user@example.com", salt);
        expect(a.authKeyHex).toBe(b.authKeyHex);
    });

    it("derives an identical masterKey for identical inputs (verified via encrypt/decrypt across the two)", async () => {
        const salt = generateSalt();
        const a = await deriveKeys("MasterPassw0rd!", "user@example.com", salt);
        const b = await deriveKeys("MasterPassw0rd!", "user@example.com", salt);

        const encrypted = await encryptVault(SAMPLE_ENTRIES, a.masterKey);
        const decrypted = await decryptVault(encrypted, b.masterKey);
        expect(decrypted).toEqual(SAMPLE_ENTRIES);
    });

    it("produces a different authKeyHex when the salt differs", async () => {
        const a = await deriveKeys("MasterPassw0rd!", "user@example.com", generateSalt());
        const b = await deriveKeys("MasterPassw0rd!", "user@example.com", generateSalt());
        expect(a.authKeyHex).not.toBe(b.authKeyHex);
    });

    it("produces a different authKeyHex when the email differs (per-account key separation)", async () => {
        const salt = generateSalt();
        const a = await deriveKeys("MasterPassw0rd!", "alice@example.com", salt);
        const b = await deriveKeys("MasterPassw0rd!", "bob@example.com", salt);
        expect(a.authKeyHex).not.toBe(b.authKeyHex);
    });

    it("produces a different authKeyHex when the password differs", async () => {
        const salt = generateSalt();
        const a = await deriveKeys("MasterPassw0rd!", "user@example.com", salt);
        const b = await deriveKeys("DifferentPassw0rd!", "user@example.com", salt);
        expect(a.authKeyHex).not.toBe(b.authKeyHex);
    });

    it("authKeyHex is 64 lowercase hex characters (server-side format contract)", async () => {
        const { authKeyHex } = await deriveKeys("MasterPassw0rd!", "user@example.com", generateSalt());
        expect(authKeyHex).toMatch(/^[0-9a-f]{64}$/);
    });
});

describe("encryptVault / decryptVault", () => {
    it("round-trips entries exactly", async () => {
        const { masterKey } = await deriveKeys("MasterPassw0rd!", "user@example.com", generateSalt());
        const encrypted = await encryptVault(SAMPLE_ENTRIES, masterKey);
        const decrypted = await decryptVault(encrypted, masterKey);
        expect(decrypted).toEqual(SAMPLE_ENTRIES);
    });

    it("round-trips a vault larger than the engine's function-argument limit (~1 MB of JSON)", async () => {
        // Un octet = un argument de String.fromCharCode si l'encodage base64
        // n'est pas fait par morceaux : V8 lève une RangeError vers 125 000
        // arguments, Safari/iOS plus tôt encore.
        const { masterKey } = await deriveKeys("MasterPassw0rd!", "user@example.com", generateSalt());
        const bigVault: VaultEntry[] = Array.from({ length: 2_000 }, (_, i) => ({
            id: String(i),
            label: `Entry ${i}`,
            username: `user${i}@example.com`,
            password: "p".repeat(32),
            notes: "n".repeat(400),
            createdAt: i,
            updatedAt: i,
        }));

        const encrypted = await encryptVault(bigVault, masterKey);
        expect(encrypted.ciphertext.length).toBeGreaterThan(1_000_000);
        await expect(decryptVault(encrypted, masterKey)).resolves.toEqual(bigVault);
    });

    it("uses a fresh random IV on every call (never reused)", async () => {
        const { masterKey } = await deriveKeys("MasterPassw0rd!", "user@example.com", generateSalt());
        const first = await encryptVault(SAMPLE_ENTRIES, masterKey);
        const second = await encryptVault(SAMPLE_ENTRIES, masterKey);
        expect(first.iv).not.toBe(second.iv);
        // Même clé + IV différent -> ciphertext différent malgré des données identiques.
        expect(first.ciphertext).not.toBe(second.ciphertext);
    });

    it("fails to decrypt with the wrong key (this is the exact production bug this test guards against)", async () => {
        const keysA = await deriveKeys("PasswordA!", "a@example.com", generateSalt());
        const keysB = await deriveKeys("PasswordB!", "b@example.com", generateSalt());
        const encrypted = await encryptVault(SAMPLE_ENTRIES, keysA.masterKey);

        await expect(decryptVault(encrypted, keysB.masterKey)).rejects.toThrow(/decryption failed/i);
    });

    it("fails to decrypt tampered ciphertext (GCM integrity check)", async () => {
        const { masterKey } = await deriveKeys("MasterPassw0rd!", "user@example.com", generateSalt());
        const encrypted = await encryptVault(SAMPLE_ENTRIES, masterKey);

        const tampered = { ...encrypted, ciphertext: encrypted.ciphertext.slice(0, -4) + "AAAA" };
        await expect(decryptVault(tampered, masterKey)).rejects.toThrow();
    });
});

describe("generatePassword", () => {
    it("generates a password of the requested length", () => {
        expect(generatePassword({ length: 32 })).toHaveLength(32);
        expect(generatePassword({ length: 8 })).toHaveLength(8);
    });

    it("defaults to length 20", () => {
        expect(generatePassword()).toHaveLength(20);
    });

    it("only uses digits when every other charset is disabled", () => {
        const pw = generatePassword({ uppercase: false, lowercase: false, symbols: false, numbers: true, length: 50 });
        expect(pw).toMatch(/^[0-9]+$/);
    });

    it("excludes ambiguous characters (0, O, l, 1, I) by default", () => {
        const pw = generatePassword({ length: 500 });
        expect(pw).not.toMatch(/[0O1lI]/);
    });

    it("throws when no character set is selected", () => {
        expect(() => generatePassword({ uppercase: false, lowercase: false, numbers: false, symbols: false })).toThrow();
    });
});

describe("evaluatePasswordStrength", () => {
    it("scores a short, single-case password as weak", () => {
        const result = evaluatePasswordStrength("abc");
        expect(result.score).toBeLessThanOrEqual(1);
    });

    it("scores a long mixed-charset password as strong", () => {
        const result = evaluatePasswordStrength("Tr0ub4dor&3xtra-Long-Passphrase!");
        expect(result.score).toBeGreaterThanOrEqual(3);
    });

    it("suggests adding symbols when the password has none", () => {
        const result = evaluatePasswordStrength("LongPassword123");
        expect(result.suggestions.some((s) => s.toLowerCase().includes("symbole"))).toBe(true);
    });

    it("returns no suggestions for a password satisfying every heuristic", () => {
        const result = evaluatePasswordStrength("Very-L0ng&Complex-Passphrase!42");
        expect(result.suggestions).toHaveLength(0);
    });
});
