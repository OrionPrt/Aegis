import { test, expect } from "@playwright/test";
import { uniqueEmail, registerViaUi } from "./helpers.js";

test("the add-entry modal generates a password honoring the chosen options (no special characters)", async ({ page }) => {
    await registerViaUi(page, uniqueEmail("gen-modal"), "GeneratorModalPassw0rd!");

    await page.click('button:has-text("Ajouter")');
    await page.click('button[title="Options du générateur"]');

    // Le panneau d'options est bien celui du générateur partagé.
    await expect(page.locator("#modal-generator-options")).toBeVisible();

    await page.locator("#modal-generator-options .generator-toggle", { hasText: "Symboles" }).click();

    // Décocher une option régénère aussitôt, sans recliquer sur "Générer".
    const password = await page.inputValue("#modal-password");
    expect(password).toHaveLength(20);
    expect(password).toMatch(/^[A-Za-z0-9]+$/);

    // Le réglage est conservé pour les générations suivantes.
    for (let i = 0; i < 5; i++) {
        await page.click('button[title="Générer un mot de passe fort"]');
        expect(await page.inputValue("#modal-password")).toMatch(/^[A-Za-z0-9]{20}$/);
    }
});

test("ambiguous characters are included by default, in the modal and in the standalone generator", async ({ page }) => {
    await registerViaUi(page, uniqueEmail("gen-defaults"), "GeneratorDefaultsPassw0rd!");

    const ambiguousToggle = (scope: string) =>
        page.locator(`${scope} .generator-toggle`, { hasText: "ambigus" }).locator("input");

    await page.click('button:has-text("Ajouter")');
    await page.click('button[title="Options du générateur"]');
    await expect(ambiguousToggle("#modal-generator-options")).not.toBeChecked();
    await page.click('button:has-text("Annuler")');

    await page.locator(".nav-item", { hasText: "Générateur" }).click();
    await expect(ambiguousToggle(".modal")).not.toBeChecked();
});

test("the last remaining character set cannot be unchecked", async ({ page }) => {
    await registerViaUi(page, uniqueEmail("gen-lastset"), "GeneratorLastSetPassw0rd!");

    await page.click('button:has-text("Ajouter")');
    await page.click('button[title="Options du générateur"]');

    const toggles = page.locator("#modal-generator-options .generator-toggle");
    for (const label of ["Majuscules", "Minuscules", "Chiffres"]) {
        await toggles.filter({ hasText: label }).click();
    }

    // Seul "Symboles" reste actif : le décocher doit être ignoré.
    await toggles.filter({ hasText: "Symboles" }).click();
    await expect(toggles.filter({ hasText: "Symboles" }).locator("input")).toBeChecked();
});
