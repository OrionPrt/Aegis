import { test, expect } from "@playwright/test";
import { uniqueEmail, registerViaUi, addLoginEntry } from "./helpers.js";

test("the vault can be used from the keyboard: dialogs and reordering", async ({ page }) => {
    await registerViaUi(page, uniqueEmail("keyboard"), "KeyboardAccessPassw0rd!");
    await addLoginEntry(page, "Alpha", "a@example.com", "AlphaSecretPassw0rd!");
    await addLoginEntry(page, "Bravo", "b@example.com", "BravoSecretPassw0rd!");
    await expect(page.locator(".entry-label")).toHaveText(["Alpha", "Bravo"]);

    // Modale : annoncée comme dialogue, focus sur le premier champ, Échap la ferme
    // et rend le focus au bouton qui l'a ouverte.
    const addButton = page.locator(".topbar-actions .btn-primary");
    await addButton.click();
    await expect(page.getByRole("dialog", { name: "Nouvelle entrée" })).toBeVisible();
    await expect(page.locator("#modal-label")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(addButton).toBeFocused();

    // Réordonnancement sans souris : Alt+↓ sur la carte « Alpha ».
    await page.getByRole("button", { name: /Alpha/ }).focus();
    await page.keyboard.press("Alt+ArrowDown");
    await expect(page.locator(".entry-label")).toHaveText(["Bravo", "Alpha"]);
    await expect(page.getByRole("button", { name: /Alpha/ })).toBeFocused();
});
