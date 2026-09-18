import { test, expect } from "@playwright/test";
import { uniqueEmail, registerViaUi, loginViaUi } from "./helpers.js";

test("re-logging in on the same browser leaves exactly one active session (no ghosts)", async ({ page }) => {
    const email = uniqueEmail("dedup");
    const password = "DedupTestPassw0rd!";

    await registerViaUi(page, email, password);

    // Simule un rechargement de page (perd la session mémoire, garde le
    // cookie httpOnly) puis une reconnexion sur le MÊME navigateur.
    await page.goto("/login");
    await loginViaUi(page, email, password);
    await page.waitForURL("**/vault", { timeout: 15_000 });

    await page.locator('.nav-item:has-text("Sécurité")').click();
    await page.waitForURL("**/sessions");

    await expect(page.locator("text=/^1 session active$/")).toBeVisible();
});

test("locks the account after 3 failed login attempts", async ({ page }) => {
    const email = uniqueEmail("lockout");
    const password = "LockoutTestPassw0rd!";

    await registerViaUi(page, email, password);
    await page.locator('button[title="Déconnexion"]').first().click();
    await page.waitForURL("**/login");

    for (let i = 0; i < 3; i++) {
        await loginViaUi(page, email, "WrongPassword!123");
    }

    await loginViaUi(page, email, password); // même le bon mot de passe...
    await expect(page.locator("text=/bloqué/i")).toBeVisible({ timeout: 10_000 });
});
