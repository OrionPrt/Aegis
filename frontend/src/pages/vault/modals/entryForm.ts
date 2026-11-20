/**
 * Logique pure du formulaire d'ajout / d'édition d'une entrée :
 * valeurs initiales, validation et conversion en données d'entrée.
 */
import { cvvLength, digitsOnly, luhn } from "../../../lib/card";
import type { CardBrand } from "../../../lib/card";
import { isValidTotpSecret, normalizeSecretInput } from "../../../lib/totp";
import { normalizeEntryUrl } from "../../../lib/url";
import type { EntryCategory, EntryFormData, VaultEntryExtended } from "../types";

export function initialFormData(entry: VaultEntryExtended | null, defaultCategory: EntryCategory): EntryFormData {
    return {
        label:      entry?.label      ?? "",
        username:   entry?.username   ?? "",
        password:   entry?.password   ?? "",
        url:        entry?.url        ?? "",
        notes:      entry?.notes      ?? "",
        category:   entry?.category   ?? defaultCategory,
        tags:       entry?.tags       ?? [],
        totpSecret: entry?.totpSecret ?? "",
        cardholder: entry?.cardholder ?? "",
        cardNumber: entry?.cardNumber ?? "",
        cardExpiry: entry?.cardExpiry ?? "",
        cardCvv:    entry?.cardCvv    ?? "",
        cardPin:    entry?.cardPin    ?? "",
        cardBank:   entry?.cardBank   ?? "",
        cardType:   entry?.cardType   ?? "credit",
    };
}

function validateLogin(form: EntryFormData): string | null {
    if (!form.username?.trim()) return "L'identifiant est requis.";
    if (!form.password)         return "Le mot de passe est requis.";
    if (form.totpSecret?.trim() && !isValidTotpSecret(form.totpSecret)) {
        return "La clé secrète 2FA est invalide.";
    }
    return normalizeEntryUrl(form.url ?? "").error ?? null;
}

function validateCard(form: EntryFormData, panDigits: string, brand: CardBrand): string | null {
    if (!panDigits)   return "Le numéro de carte est requis.";
    if (!luhn(panDigits)) return "Numéro de carte invalide.";

    const expiry = digitsOnly(form.cardExpiry ?? "");
    if (!expiry)             return "La date d'expiration est requise.";
    if (expiry.length !== 4) return "Date d'expiration invalide (format MM/AA).";
    const month = Number(expiry.slice(0, 2));
    if (month < 1 || month > 12) return "Le mois d'expiration doit être compris entre 01 et 12.";

    if (form.cardCvv && form.cardCvv.length !== cvvLength(brand)) {
        return `Le cryptogramme doit contenir ${cvvLength(brand)} chiffres.`;
    }
    return null;
}

/** Premier message d'erreur du formulaire, ou null s'il est valide. */
export function validateEntryForm(form: EntryFormData, panDigits: string, brand: CardBrand): string | null {
    if (!form.label.trim()) return "Le nom est requis.";
    if (form.category === "login") return validateLogin(form);
    if (form.category === "card") return validateCard(form, panDigits, brand);
    if (form.category === "note" && !form.notes?.trim()) return "Le contenu de la note est requis.";
    return null;
}

function normalizedTotp(form: EntryFormData) {
    if (form.category !== "login" || !form.totpSecret?.trim()) return null;
    try {
        return normalizeSecretInput(form.totpSecret);
    } catch {
        return null;
    }
}

/**
 * Données à enregistrer : seuls les champs de la catégorie choisie sont
 * conservés (un identifiant saisi puis passé en « Carte » n'est pas gardé).
 */
export function toEntryData(
    form: EntryFormData,
    tagsInput: string,
    panDigits: string,
    brand: CardBrand,
): EntryFormData {
    const isLogin = form.category === "login";
    const isCard  = form.category === "card";
    const totp    = normalizedTotp(form);

    return {
        ...form,
        tags:          tagsInput.split(",").map((t) => t.trim()).filter(Boolean),
        username:      isLogin ? form.username : undefined,
        password:      isLogin ? form.password : undefined,
        url:           isLogin ? normalizeEntryUrl(form.url ?? "").url : undefined,
        totpSecret:    totp?.secret,
        totpAlgorithm: totp?.algorithm,
        totpDigits:    totp?.digits,
        totpPeriod:    totp?.period,
        cardholder: isCard ? ((form.cardholder ?? "").trim().toUpperCase() || undefined) : undefined,
        cardNumber: isCard ? (panDigits || undefined) : undefined,
        cardExpiry: isCard ? (digitsOnly(form.cardExpiry ?? "") || undefined) : undefined,
        cardCvv:    isCard ? (form.cardCvv || undefined) : undefined,
        cardPin:    isCard ? (form.cardPin || undefined) : undefined,
        cardBank:   isCard ? (form.cardBank || undefined) : undefined,
        cardBrand:  isCard ? brand : undefined,
        cardType:   isCard ? form.cardType : undefined,
    };
}
