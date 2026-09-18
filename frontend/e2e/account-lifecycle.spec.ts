import { test, expect } from "@playwright/test";
import { uniqueEmail, registerViaUi, loginViaUi } from "./helpers.js";

test("changing the master password revokes the session and the old password stops working", async ({ page }) => {
    const email = uniqueEmail("changepw");
    const oldPassword = "OldMasterPassw0rd!";
    const newPassword = "NewMasterPassw0rd!2";

    await registerViaUi(page, email, oldPassword);

    await page.click('button:has-text("Changer le mot de passe")');
    await page.fill("#cp-current", oldPassword);
    await page.fill("#cp-new", newPassword);
    await page.fill("#cp-confirm", newPassword);
    await page.click('button[type="submit"]:has-text("Changer le mot de passe")');

    await page.waitForURL("**/login", { timeout: 15_000 });

    // L'ancien mot de passe ne doit plus fonctionner...
    await loginViaUi(page, email, oldPassword);
    await expect(page.locator("text=/incorrect/i")).toBeVisible({ timeout: 10_000 });

    // ...mais le nouveau doit permettre une reconnexion normale.
    await page.reload();
    await loginViaUi(page, email, newPassword);
    await page.waitForURL("**/vault", { timeout: 15_000 });
});

test("deleting the account requires the master password and is permanent", async ({ page }) => {
    const email = uniqueEmail("delete");
    const password = "DeleteAccountPassw0rd!";

    await registerViaUi(page, email, password);

    await page.click('button:has-text("Supprimer le compte")');

    // Un mauvais mot de passe ne doit pas supprimer le compte.
    await page.fill(".confirm-input", "WrongPassword!");
    await page.click('button:has-text("Supprimer définitivement")');
    await expect(page.locator("text=/incorrect/i")).toBeVisible({ timeout: 10_000 });

    // Le bon mot de passe supprime bien le compte et renvoie à /login.
    await page.fill(".confirm-input", password);
    await page.click('button:has-text("Supprimer définitivement")');
    await page.waitForURL("**/login", { timeout: 15_000 });

    // Le compte n'existe plus - une reconnexion doit échouer.
    await loginViaUi(page, email, password);
    await expect(page.locator("text=/incorrects/i")).toBeVisible({ timeout: 10_000 });
});
