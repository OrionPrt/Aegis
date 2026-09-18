import type { Page } from "@playwright/test";

export function uniqueEmail(prefix = "e2e"): string {
    return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

export async function registerViaUi(page: Page, email: string, password: string): Promise<void> {
    await page.goto("/login");
    await page.click('button:has-text("Créer un compte")');
    await page.fill("#email", email);
    await page.fill("#password", password);
    await page.fill("#confirm", password);
    await page.click('button[type="submit"]');
    await page.waitForURL("**/vault", { timeout: 15_000 });
}

export async function loginViaUi(page: Page, email: string, password: string): Promise<void> {
    // Ne navigue que si nécessaire - un goto() vers une route déjà active
    // déclenche un vrai rechargement de page, qui peut couper une requête de
    // connexion précédente encore en vol avant qu'elle n'atteigne le serveur
    // (critique pour les tests qui enchaînent plusieurs tentatives).
    if (!page.url().endsWith("/login")) {
        await page.goto("/login");
    }
    await page.fill("#email", email);
    await page.fill("#password", password);
    await page.click('button[type="submit"]');
    // Attend que la tentative aboutisse (redirection) ou échoue (message
    // d'erreur affiché) avant de rendre la main à l'appelant.
    await Promise.race([
        page.waitForURL("**/vault", { timeout: 10_000 }),
        page.locator(".auth-error").waitFor({ state: "visible", timeout: 10_000 }),
    ]).catch(() => {});
}

export async function addLoginEntry(page: Page, label: string, username: string, password: string): Promise<void> {
    await page.click('button:has-text("Ajouter")');
    await page.fill("#modal-label", label);
    await page.fill("#modal-username", username);
    await page.fill("#modal-password", password);
    await page.click('button[type="submit"]:has-text("Ajouter")');
}
