import { test, expect } from "@playwright/test";
import { uniqueEmail, registerViaUi, loginViaUi, addLoginEntry } from "./helpers.js";

test("register, add an entry, logout, log back in, and the entry decrypts correctly", async ({ page }) => {
    const email = uniqueEmail("vault-flow");
    const password = "VaultFlowPassw0rd!";

    await registerViaUi(page, email, password);
    await addLoginEntry(page, "GitHub", "me@example.com", "GhSecretPassw0rd!");

    await expect(page.locator("text=GitHub")).toBeVisible();

    await page.locator('.nav-item:has-text("Sécurité")').click();
    await page.waitForURL("**/sessions");
    await page.click('button:has-text("Retour au vault")');
    await page.waitForURL("**/vault");

    // Toujours pas d'erreur de déchiffrement en revenant sur le vault sans
    // s'être reconnecté (navigation SPA, même session en mémoire).
    await expect(page.locator("text=/decryption failed/i")).toHaveCount(0);
    await expect(page.locator("text=GitHub")).toBeVisible();

    await page.locator('button[title="Déconnexion"]').first().click();
    await page.waitForURL("**/login");

    // Reconnexion fraîche (nouvelle dérivation de clé) - l'entrée doit
    // toujours être là et se déchiffrer avec la même clé qu'à la création.
    await loginViaUi(page, email, password);
    await page.waitForURL("**/vault", { timeout: 15_000 });

    await expect(page.locator("text=/decryption failed/i")).toHaveCount(0);
    await expect(page.locator("text=GitHub")).toBeVisible();
});
