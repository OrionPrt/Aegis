import { describe, it, expect } from "vitest";
import { initialFormData, toEntryData, validateEntryForm } from "./entryForm";
import type { EntryFormData } from "../types";

function loginForm(overrides: Partial<EntryFormData> = {}): EntryFormData {
    return { ...initialFormData(null, "login"), label: "GitHub", username: "me", password: "pw", ...overrides };
}

describe("validateEntryForm", () => {
    it("requires a label", () => {
        expect(validateEntryForm(loginForm({ label: " " }), "", "unknown")).toBe("Le nom est requis.");
    });

    it("requires a username and a password for a login", () => {
        expect(validateEntryForm(loginForm({ username: "" }), "", "unknown")).toBe("L'identifiant est requis.");
        expect(validateEntryForm(loginForm({ password: "" }), "", "unknown")).toBe("Le mot de passe est requis.");
    });

    it("rejects an invalid 2FA secret", () => {
        expect(validateEntryForm(loginForm({ totpSecret: "not base32 !!" }), "", "unknown"))
            .toBe("La clé secrète 2FA est invalide.");
    });

    it("checks the card number, the expiry month and the CVV length", () => {
        const card = { ...initialFormData(null, "card"), label: "Visa" };
        expect(validateEntryForm(card, "", "visa")).toBe("Le numéro de carte est requis.");
        expect(validateEntryForm(card, "4111111111111112", "visa")).toBe("Numéro de carte invalide.");
        expect(validateEntryForm({ ...card, cardExpiry: "1330" }, "4111111111111111", "visa"))
            .toBe("Le mois d'expiration doit être compris entre 01 et 12.");
        expect(validateEntryForm({ ...card, cardExpiry: "1230", cardCvv: "12" }, "4111111111111111", "visa"))
            .toBe("Le cryptogramme doit contenir 3 chiffres.");
        expect(validateEntryForm({ ...card, cardExpiry: "1230", cardCvv: "123" }, "4111111111111111", "visa")).toBeNull();
    });

    it("refuses a non-web URL for a login", () => {
        expect(validateEntryForm(loginForm({ url: "javascript:alert(1)" }), "", "unknown")).toMatch(/http/);
        expect(validateEntryForm(loginForm({ url: "github.com" }), "", "unknown")).toBeNull();
    });

    it("requires content for a note", () => {
        const note = { ...initialFormData(null, "note"), label: "Wifi" };
        expect(validateEntryForm(note, "", "unknown")).toBe("Le contenu de la note est requis.");
    });
});

describe("toEntryData", () => {
    it("drops the fields of the other categories and splits tags", () => {
        const data = toEntryData(loginForm({ cardNumber: "4111", cardBank: "BNP" }), "dev, perso ,", "4111", "visa");
        expect(data.tags).toEqual(["dev", "perso"]);
        expect(data.username).toBe("me");
        expect(data.cardNumber).toBeUndefined();
        expect(data.cardBank).toBeUndefined();
    });

    it("stores a bare domain as an https address", () => {
        expect(toEntryData(loginForm({ url: "github.com" }), "", "", "unknown").url).toBe("https://github.com");
    });

    it("upper-cases the cardholder and stores the card digits and brand", () => {
        const card = { ...initialFormData(null, "card"), label: "Visa", cardholder: " jean dupont ", cardExpiry: "12/30" };
        const data = toEntryData(card, "", "4111111111111111", "visa");
        expect(data.cardholder).toBe("JEAN DUPONT");
        expect(data.cardNumber).toBe("4111111111111111");
        expect(data.cardExpiry).toBe("1230");
        expect(data.cardBrand).toBe("visa");
        expect(data.username).toBeUndefined();
    });
});
