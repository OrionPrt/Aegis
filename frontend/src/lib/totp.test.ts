import { describe, it, expect } from "vitest";
import {
    base32Encode, base32Decode, parseOtpauthUri, normalizeSecretInput,
    isValidTotpSecret, generateTotpCode, totpTimeRemaining, type TotpConfig,
} from "./totp.js";

describe("base32Encode / base32Decode", () => {
    it("round-trips arbitrary bytes", () => {
        const original = new Uint8Array([0, 1, 2, 253, 254, 255, 42, 123]);
        const decoded = base32Decode(base32Encode(original));
        expect(Array.from(decoded)).toEqual(Array.from(original));
    });

    it("decode is case-insensitive and ignores spaces/dashes/padding", () => {
        const withNoise = "jb sw y3-dp==";
        const clean = "JBSWY3DP";
        expect(Array.from(base32Decode(withNoise))).toEqual(Array.from(base32Decode(clean)));
    });

    it("throws on invalid base32 characters", () => {
        expect(() => base32Decode("this-is-not-base32-1")).toThrow(/invalide/i);
    });

    it("throws on an empty secret", () => {
        expect(() => base32Decode("")).toThrow();
    });
});

describe("parseOtpauthUri", () => {
    it("returns null for a plain (non-otpauth) secret", () => {
        expect(parseOtpauthUri("JBSWY3DPEHPK3PXP")).toBeNull();
    });

    it("extracts secret, issuer, algorithm, digits and period from a full URI", () => {
        const uri = "otpauth://totp/Aegis:me@example.com?secret=JBSWY3DPEHPK3PXP&issuer=Aegis&algorithm=SHA256&digits=8&period=60";
        const parsed = parseOtpauthUri(uri);
        expect(parsed).toMatchObject({
            secret: "JBSWY3DPEHPK3PXP",
            issuer: "Aegis",
            algorithm: "SHA-256",
            digits: 8,
            period: 60,
        });
    });

    it("defaults to SHA-1 / 6 digits / 30s when unspecified", () => {
        const parsed = parseOtpauthUri("otpauth://totp/Label?secret=JBSWY3DPEHPK3PXP");
        expect(parsed).toMatchObject({ algorithm: "SHA-1", digits: 6, period: 30 });
    });

    it("throws when the otpauth URI is missing its secret", () => {
        expect(() => parseOtpauthUri("otpauth://totp/Label?issuer=Aegis")).toThrow(/secret/i);
    });
});

describe("normalizeSecretInput / isValidTotpSecret", () => {
    it("normalizes a messy raw secret (lowercase, spaces, dashes)", () => {
        const result = normalizeSecretInput("jbsw y3dp-ehpk 3pxp");
        expect(result.secret).toBe("JBSWY3DPEHPK3PXP");
    });

    it("accepts a full otpauth:// URI and normalizes its secret", () => {
        const result = normalizeSecretInput("otpauth://totp/Label?secret=jbswy3dpehpk3pxp");
        expect(result.secret).toBe("JBSWY3DPEHPK3PXP");
    });

    it("isValidTotpSecret returns true for a valid secret and false for garbage", () => {
        expect(isValidTotpSecret("JBSWY3DPEHPK3PXP")).toBe(true);
        expect(isValidTotpSecret("not valid base32!!!")).toBe(false);
        expect(isValidTotpSecret("")).toBe(false);
    });
});

describe("generateTotpCode - RFC 6238 Appendix B test vectors (T=59s, T0=0, X=30)", () => {
    // Les vecteurs officiels utilisent des secrets ASCII de longueurs
    // différentes selon l'algorithme (20/32/64 octets) - on les ré-encode en
    // base32 nous-mêmes puisque generateTotpCode() attend un secret base32,
    // ce qui exerce en même temps base32Encode/Decode contre une sortie
    // externe connue (pas juste un aller-retour auto-cohérent).
    const asciiSecret = (repeats: number) => "1234567890".repeat(repeats);

    it.each([
        ["SHA-1", 20, "94287082"],
        ["SHA-256", 32, "46119246"],
        ["SHA-512", 64, "90693936"],
    ] as const)("matches the official %s vector at T=59s", async (algorithm, secretLen, expected) => {
        const secretBytes = new TextEncoder().encode(asciiSecret(7).slice(0, secretLen));
        const config: TotpConfig = { secret: base32Encode(secretBytes), algorithm, digits: 8, period: 30 };

        const code = await generateTotpCode(config, 59_000);
        expect(code).toBe(expected);
    });

    it("pads the code with leading zeros up to `digits`", async () => {
        const secretBytes = new TextEncoder().encode(asciiSecret(2));
        const config: TotpConfig = { secret: base32Encode(secretBytes), algorithm: "SHA-1", digits: 10, period: 30 };
        const code = await generateTotpCode(config, 59_000);
        expect(code).toHaveLength(10);
    });
});

describe("totpTimeRemaining", () => {
    it("counts down within a 30s period and wraps at the boundary", () => {
        expect(totpTimeRemaining({ period: 30 }, 0)).toBe(30);
        expect(totpTimeRemaining({ period: 30 }, 1_000)).toBe(29);
        expect(totpTimeRemaining({ period: 30 }, 29_000)).toBe(1);
        expect(totpTimeRemaining({ period: 30 }, 30_000)).toBe(30);
    });
});
