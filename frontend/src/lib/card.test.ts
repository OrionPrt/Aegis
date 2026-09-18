import { describe, it, expect } from "vitest";
import {
    detectBrand, brandLabel, cvvLength, maxPanLength,
    formatCardNumber, maskCardNumber, last4, formatExpiry,
    luhn, checkExpiry, validateCard, digitsOnly,
} from "./card.js";

describe("digitsOnly", () => {
    it("strips everything but digits", () => {
        expect(digitsOnly("4242 4242-4242.4242")).toBe("4242424242424242");
    });
});

describe("detectBrand", () => {
    it.each([
        ["4242424242424242", "visa"],
        ["5555555555554444", "mastercard"],
        ["378282246310005", "amex"],
        ["6011111111111117", "discover"],
        ["3530111333300000", "jcb"],
        ["6221260000000000", "unionpay"],
        ["9999999999999999", "unknown"],
    ] as const)("detects %s as %s", (pan, brand) => {
        expect(detectBrand(pan)).toBe(brand);
    });
});

describe("brandLabel / cvvLength / maxPanLength", () => {
    it("amex uses a 4-digit CVV and a 15-digit max length", () => {
        expect(cvvLength("amex")).toBe(4);
        expect(maxPanLength("amex")).toBe(15);
        expect(brandLabel("amex")).toBe("American Express");
    });

    it("visa uses a 3-digit CVV", () => {
        expect(cvvLength("visa")).toBe(3);
    });

    it("falls back gracefully for unknown", () => {
        expect(brandLabel("unknown")).toBe("Carte");
    });
});

describe("formatCardNumber / maskCardNumber", () => {
    it("groups visa numbers in blocks of 4", () => {
        expect(formatCardNumber("4242424242424242")).toBe("4242 4242 4242 4242");
    });

    it("groups amex numbers as 4-6-5", () => {
        expect(formatCardNumber("378282246310005")).toBe("3782 822463 10005");
    });

    it("masks all but the last 4 digits", () => {
        const masked = maskCardNumber("4242424242424242");
        expect(masked.replace(/\s/g, "")).toBe("••••••••••••4242");
    });

    it("does not mask a short/partial number (<=4 digits)", () => {
        expect(maskCardNumber("42")).toBe("42");
    });
});

describe("last4", () => {
    it("returns the last 4 digits regardless of formatting", () => {
        expect(last4("4242 4242 4242 4242")).toBe("4242");
    });
});

describe("formatExpiry", () => {
    it("inserts a slash after the month", () => {
        expect(formatExpiry("1225")).toBe("12/25");
    });

    it("auto-pads a single-digit month greater than 1 (e.g. '2' -> '02')", () => {
        expect(formatExpiry("2")).toBe("02");
    });

    it("does not pad '1' since a second digit might follow (10, 11, 12)", () => {
        expect(formatExpiry("1")).toBe("1");
    });
});

describe("luhn", () => {
    it("validates a known-good card number", () => {
        expect(luhn("4242424242424242")).toBe(true);
    });

    it("rejects a number with a single digit flipped", () => {
        expect(luhn("4242424242424241")).toBe(false);
    });

    it("rejects numbers shorter than 12 digits", () => {
        expect(luhn("4242")).toBe(false);
    });
});

describe("checkExpiry", () => {
    it("returns 'empty' for an empty string", () => {
        expect(checkExpiry("")).toBe("empty");
    });

    it("returns 'invalid' for a bad month", () => {
        expect(checkExpiry("1325")).toBe("invalid");
    });

    it("returns 'expired' for a date in the past", () => {
        expect(checkExpiry("0120")).toBe("expired");
    });

    it("returns 'valid' for a date far in the future", () => {
        expect(checkExpiry("1299")).toBe("valid");
    });

    it("returns 'soon' for a date within 60 days", () => {
        const soon = new Date();
        soon.setDate(soon.getDate() + 10);
        const mm = String(soon.getMonth() + 1).padStart(2, "0");
        const yy = String(soon.getFullYear() % 100).padStart(2, "0");
        expect(checkExpiry(`${mm}${yy}`)).toBe("soon");
    });
});

describe("validateCard", () => {
    it("requires a card number", () => {
        expect(validateCard({})).toMatch(/requis/i);
    });

    it("rejects a Luhn-invalid number", () => {
        expect(validateCard({ cardNumber: "4242424242424241", cardExpiry: "1299" })).toMatch(/invalide/i);
    });

    it("rejects a CVV of the wrong length for the detected brand", () => {
        const res = validateCard({ cardNumber: "4242424242424242", cardExpiry: "1299", cardCvv: "12345" });
        expect(res).toMatch(/3 chiffres/);
    });

    it("returns null (valid) for a well-formed card", () => {
        expect(validateCard({ cardNumber: "4242424242424242", cardExpiry: "1299", cardCvv: "123" })).toBeNull();
    });
});
