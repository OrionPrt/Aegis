/**
 * ╔═══════════════════════════════════════════════════════╗
 * ║           AEGIS — Utilitaires cartes bancaires        ║
 * ║           src/lib/card.ts                             ║
 * ╚═══════════════════════════════════════════════════════╝
 */

export type CardBrand =
    | "visa" | "mastercard" | "amex" | "discover"
    | "diners" | "jcb" | "unionpay" | "unknown";

interface BrandSpec {
    brand:     CardBrand;
    label:     string;
    test:      RegExp;
    maxLength: number;
    cvvLength: number;
    gaps:      number[] | null; // null = un espace tous les 4 chiffres
}

const BRANDS: BrandSpec[] = [
    { brand: "visa",       label: "Visa",             test: /^4/,                                    maxLength: 19, cvvLength: 3, gaps: null },
    { brand: "mastercard", label: "Mastercard",       test: /^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/, maxLength: 16, cvvLength: 3, gaps: null },
    { brand: "amex",       label: "American Express", test: /^3[47]/,                                maxLength: 15, cvvLength: 4, gaps: [4, 10] },
    { brand: "diners",     label: "Diners Club",      test: /^3(0[0-5]|[68])/,                       maxLength: 19, cvvLength: 3, gaps: [4, 10] },
    { brand: "discover",   label: "Discover",         test: /^(6011|64[4-9]|65)/,                    maxLength: 19, cvvLength: 3, gaps: null },
    { brand: "jcb",        label: "JCB",              test: /^35(2[89]|[3-8]\d)/,                    maxLength: 19, cvvLength: 3, gaps: null },
    { brand: "unionpay",   label: "UnionPay",         test: /^62/,                                   maxLength: 19, cvvLength: 3, gaps: null },
];

const FALLBACK: BrandSpec = {
    brand: "unknown", label: "Carte", test: /.^/, maxLength: 19, cvvLength: 3, gaps: null,
};

// ── Détection ────────────────────────────────────────────

export const digitsOnly = (value: string): string => value.replace(/\D/g, "");

function specOf(value: string): BrandSpec {
    const n = digitsOnly(value);
    return BRANDS.find((b) => b.test.test(n)) ?? FALLBACK;
}

export function detectBrand(value: string): CardBrand {
    return specOf(value).brand;
}

export function brandLabel(brand: CardBrand): string {
    return (BRANDS.find((b) => b.brand === brand) ?? FALLBACK).label;
}

export function cvvLength(brand: CardBrand): number {
    return (BRANDS.find((b) => b.brand === brand) ?? FALLBACK).cvvLength;
}

export function maxPanLength(brand: CardBrand): number {
    return (BRANDS.find((b) => b.brand === brand) ?? FALLBACK).maxLength;
}

// ── Formatage ────────────────────────────────────────────

function group(chars: string, spec: BrandSpec): string {
    let out = "";
    for (let i = 0; i < chars.length; i++) {
        if (i > 0 && (spec.gaps ? spec.gaps.includes(i) : i % 4 === 0)) out += " ";
        out += chars[i];
    }
    return out;
}

export function formatCardNumber(value: string): string {
    const spec = specOf(value);
    return group(digitsOnly(value).slice(0, spec.maxLength), spec);
}

export function maskCardNumber(value: string): string {
    const n = digitsOnly(value);
    if (n.length <= 4) return n;
    return group("•".repeat(n.length - 4) + n.slice(-4), specOf(n));
}

export function last4(value: string): string {
    return digitsOnly(value).slice(-4);
}

export function formatExpiry(value: string): string {
    let n = digitsOnly(value).slice(0, 4);
    if (n.length === 1 && Number(n) > 1) n = "0" + n;
    return n.length >= 3 ? `${n.slice(0, 2)}/${n.slice(2)}` : n;
}

// ── Validation ───────────────────────────────────────────

export function luhn(value: string): boolean {
    const n = digitsOnly(value);
    if (n.length < 12) return false;

    let sum = 0;
    let dbl = false;
    for (let i = n.length - 1; i >= 0; i--) {
        let d = n.charCodeAt(i) - 48;
        if (dbl) {
            d *= 2;
            if (d > 9) d -= 9;
        }
        sum += d;
        dbl = !dbl;
    }
    return sum % 10 === 0;
}

export type ExpiryStatus = "empty" | "invalid" | "expired" | "soon" | "valid";

export function checkExpiry(value: string): ExpiryStatus {
    const n = digitsOnly(value);
    if (!n)             return "empty";
    if (n.length !== 4) return "invalid";

    const month = Number(n.slice(0, 2));
    const year  = 2000 + Number(n.slice(2));
    if (month < 1 || month > 12) return "invalid";

    const endOfValidity = new Date(year, month, 1); // 1er du mois suivant
    const now = new Date();
    if (endOfValidity <= now) return "expired";

    const soon = new Date();
    soon.setDate(soon.getDate() + 60);
    return endOfValidity <= soon ? "soon" : "valid";
}

export function validateCard(input: {
    cardNumber?: string;
    cardExpiry?: string;
    cardCvv?:    string;
}): string | null {
    const pan = digitsOnly(input.cardNumber ?? "");
    if (!pan)       return "Le numéro de carte est requis.";
    if (!luhn(pan)) return "Numéro de carte invalide - vérifiez la saisie.";

    const expiry = checkExpiry(input.cardExpiry ?? "");
    if (expiry === "empty")   return "La date d'expiration est requise.";
    if (expiry === "invalid") return "Date d'expiration invalide (format MM/AA).";

    const brand = detectBrand(pan);
    const cvv   = digitsOnly(input.cardCvv ?? "");
    if (cvv && cvv.length !== cvvLength(brand))
        return `Le cryptogramme doit contenir ${cvvLength(brand)} chiffres.`;

    return null;
}
