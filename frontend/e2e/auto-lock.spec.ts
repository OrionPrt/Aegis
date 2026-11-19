import { test, expect } from "@playwright/test";
import { uniqueEmail, registerViaUi, addLoginEntry } from "./helpers.js";

test("the vault locks itself after 10 minutes of inactivity", async ({ page }) => {
    // Horloge contrôlée par le test : le temps s'écoule normalement jusqu'au
    // saut de 11 minutes, qui déclenche les minuteurs de la page.
    await page.clock.install();
    await registerViaUi(page, uniqueEmail("auto-lock"), "AutoLockTestPassw0rd!");
    await addLoginEntry(page, "Banque", "me@example.com", "BankSecretPassw0rd!");
    await expect(page.locator(".entry-label", { hasText: "Banque" })).toBeVisible();

    await page.clock.fastForward("11:00");

    await page.waitForURL("**/login");
    await expect(page.getByRole("status")).toContainText("verrouillé après une période d'inactivité");
    // Le coffre déchiffré n'est plus à l'écran, et y revenir exige le mot de passe.
    await expect(page.locator(".entry-label")).toHaveCount(0);
    await page.goto("/vault");
    await page.waitForURL("**/login");
});
