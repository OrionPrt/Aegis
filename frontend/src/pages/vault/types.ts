import type { CardBrand } from "../../lib/card";
import type { TotpAlgorithm } from "../../lib/totp";
import type { VaultEntry } from "../../lib/crypto";

export type Category = "all" | "login" | "card" | "note";

/** Catégorie d'une entrée (« all » n'est qu'un filtre d'affichage). */
export type EntryCategory = Exclude<Category, "all">;

export interface VaultEntryExtended extends VaultEntry {
    category: Category;
    url?:     string;
    tags?:    string[];
    favicon?: string;

    // ── Champ 2FA / TOTP (login uniquement) ─────────────
    totpSecret?:    string;         // base32 normalisé
    totpAlgorithm?: TotpAlgorithm;  // omis = "SHA-1"
    totpDigits?:    number;         // omis = 6
    totpPeriod?:    number;         // omis = 30

    // ── Champs carte bancaire ──────────────────────────
    cardholder?: string;              // Titulaire, tel qu'imprimé, en majuscules
    cardNumber?: string;              // PAN stocké SANS espaces (chiffres uniquement)
    cardExpiry?: string;              // 4 chiffres "MMYY", sans slash
    cardCvv?:    string;              // 3 chiffres, 4 pour Amex
    cardPin?:    string;              // optionnel, 4 à 6 chiffres
    cardBank?:   string;              // banque émettrice, texte libre
    cardBrand?:  CardBrand;           // dérivé à la sauvegarde, mis en cache
    cardType?:   "credit" | "debit";
}

export type EntryFormData = Omit<VaultEntryExtended, "id" | "createdAt" | "updatedAt">;

/** Copie `text` et affiche le retour visuel sur le bouton identifié par `field`. */
export type CopyToClipboard = (text: string, field: string) => void;
