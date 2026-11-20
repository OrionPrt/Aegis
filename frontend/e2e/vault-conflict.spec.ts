import { test, expect } from "@playwright/test";
import { uniqueEmail, registerViaUi, loginViaUi, addLoginEntry } from "./helpers.js";

test("a save from a stale device reloads the newer vault instead of erasing it", async ({ browser }) => {
    const email = uniqueEmail("vault-conflict");
    const password = "VaultConflictPassw0rd!";

    // Deux navigateurs distincts = deux appareils, chacun avec sa propre clé en mémoire.
    const deviceA = await (await browser.newContext()).newPage();
    const deviceB = await (await browser.newContext()).newPage();

    await registerViaUi(deviceA, email, password);
    await loginViaUi(deviceB, email, password);
    await deviceB.waitForURL("**/vault", { timeout: 15_000 });

    // A sauvegarde en premier ; B part encore de la version d'avant.
    await addLoginEntry(deviceA, "Depuis A", "a@example.com", "PasswordFromA1!");
    await expect(deviceA.locator(".entry-label", { hasText: "Depuis A" })).toBeVisible();

    await addLoginEntry(deviceB, "Depuis B", "b@example.com", "PasswordFromB1!");

    // B est prévenu et voit l'entrée de A au lieu de l'écraser.
    await expect(deviceB.locator(".vault-save-error")).toContainText("modifié sur un autre appareil");
    await expect(deviceB.locator(".entry-label", { hasText: "Depuis A" })).toBeVisible();

    // Le modal est resté ouvert avec la saisie de B : un nouvel envoi l'ajoute à la dernière version.
    await deviceB.click('button[type="submit"]:has-text("Ajouter")');
    await expect(deviceB.locator(".entry-label", { hasText: "Depuis B" })).toBeVisible();
    await expect(deviceB.locator(".vault-save-error")).toHaveCount(0);

    await deviceA.reload();
    await loginViaUi(deviceA, email, password);
    await deviceA.waitForURL("**/vault", { timeout: 15_000 });
    await expect(deviceA.locator(".entry-label", { hasText: "Depuis A" })).toBeVisible();
    await expect(deviceA.locator(".entry-label", { hasText: "Depuis B" })).toBeVisible();
});
