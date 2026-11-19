import { describe, it, expect } from "vitest";
import { assessMasterPassword, MIN_MASTER_PASSWORD_LENGTH, rejectionMessage } from "./password-strength";

describe("assessMasterPassword", () => {
    it("rejects predictable passwords that only look complex (keyboard rows, l33t words, years)", async () => {
        for (const weak of ["Azerty123456!", "Password1234!", "Motdepasse2024!", "Qwertyuiop12!"]) {
            const result = await assessMasterPassword(weak);
            expect(result.acceptable, weak).toBe(false);
            expect(rejectionMessage(result, weak), weak).toMatch(/prévisible/);
        }
    });

    it("accepts a long, unpredictable passphrase", async () => {
        const result = await assessMasterPassword("tortue-cerf-volant-27-orage-pivoine");
        expect(result.acceptable).toBe(true);
        expect(result.score).toBeGreaterThanOrEqual(3);
    });

    it("penalises a password built from the account email", async () => {
        const withoutContext = await assessMasterPassword("jean.dupont1988!");
        const withEmail = await assessMasterPassword("jean.dupont1988!", ["jean.dupont@example.com"]);
        expect(withEmail.guessesLog10).toBeLessThanOrEqual(withoutContext.guessesLog10);
        expect(withEmail.acceptable).toBe(false);
    });

    it("always requires the minimum length, whatever the score", async () => {
        const result = await assessMasterPassword("Xq7#vL2!pZ");
        expect("Xq7#vL2!pZ".length).toBeLessThan(MIN_MASTER_PASSWORD_LENGTH);
        expect(result.acceptable).toBe(false);
    });

    it("gives its feedback in French", async () => {
        const result = await assessMasterPassword("azertyuiop");
        expect([result.warning, ...result.suggestions].join(" ")).toMatch(/[éèàç]|mot|clavier|ajout|évit/i);
    });

    it("accepts the master passwords used by the end-to-end tests, with their account email", async () => {
        const cases = [
            ["VaultFlowPassw0rd!", "vault-flow-1795126729213-28445@example.com"],
            ["VaultConflictPassw0rd!", "vault-conflict-1795126729213-28445@example.com"],
            ["OldMasterPassw0rd!", "lifecycle-1795126729213-28445@example.com"],
            ["NewMasterPassw0rd!2", "lifecycle-1795126729213-28445@example.com"],
            ["MobileReorderPassw0rd!", "mobile-reorder-1795126729213-28445@example.com"],
        ];
        for (const [password, email] of cases) {
            expect((await assessMasterPassword(password, [email])).acceptable, password).toBe(true);
        }
    });
});
