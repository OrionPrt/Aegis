import { test, expect } from "@playwright/test";
import { uniqueEmail, confirmEmailViaLink, loginViaUi } from "./helpers.js";

test("a new account must confirm its address before it can log in", async ({ page }) => {
    const email = uniqueEmail("email-verification");
    const password = "EmailVerificationPassw0rd!";

    await page.goto("/login");
    await page.click('button:has-text("Créer un compte")');
    await page.fill("#email", email);
    await page.fill("#password", password);
    await page.fill("#confirm", password);
    await page.click('button[type="submit"]');

    // Pas de session : l'écran repasse sur la connexion et explique la suite.
    await expect(page.getByRole("status")).toContainText("email de confirmation");
    await expect(page).toHaveURL(/\/login$/);

    // Tant que l'adresse n'est pas confirmée, la connexion est refusée et
    // l'écran propose de renvoyer le lien.
    await loginViaUi(page, email, password);
    await expect(page.getByRole("alert")).toContainText("Confirmez d'abord votre adresse");
    await page.click('button:has-text("Renvoyer le lien de confirmation")');
    await expect(page.getByRole("status")).toContainText("nouveau lien");

    await confirmEmailViaLink(page, email);
    await loginViaUi(page, email, password);
    await page.waitForURL("**/vault", { timeout: 15_000 });
});
