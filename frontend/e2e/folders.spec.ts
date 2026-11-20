import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { uniqueEmail, registerViaUi, loginViaUi, addLoginEntry } from "./helpers.js";

const PASSWORD = "Ardoise-Tilleul-Rangement-47!";

const folderNav = (page: Page, name: string) => page.locator(".nav-item-folder", { hasText: name });
const entry = (page: Page, label: string) => page.locator(".entry-label", { hasText: label });
const title = (page: Page) => page.locator("h1.topbar-title");

/** Attend la fin de la sauvegarde en cours (indicateur « Sauvegarde… » disparu). */
async function waitForSave(page: Page): Promise<void> {
    await expect(page.locator(".saving-indicator")).toHaveCount(0, { timeout: 10_000 });
}

async function createFolderViaUi(page: Page, name: string): Promise<void> {
    await page.getByRole("button", { name: "Nouveau dossier" }).click();
    await page.fill("#folder-name", name);
    await page.getByRole("dialog").getByRole("button", { name: "Créer" }).click();
    await expect(title(page)).toHaveText(name);
    await waitForSave(page);
}

async function showAllEntries(page: Page): Promise<void> {
    await page.locator('.nav-item:has-text("Tous les identifiants")').click();
    await expect(title(page)).toHaveText("Tous les identifiants");
}

async function logoutAndLogBackIn(page: Page, email: string, password: string): Promise<void> {
    await page.locator('button[title="Déconnexion"]').first().click();
    await page.waitForURL("**/login");
    await loginViaUi(page, email, password);
    await page.waitForURL("**/vault", { timeout: 15_000 });
}

test("files entries in a folder from the form and « Déplacer vers… », and finds them after logging back in", async ({ page }) => {
    const email = uniqueEmail("folders");
    await registerViaUi(page, email, PASSWORD);

    // Créé depuis la barre latérale, le dossier s'ouvre : une entrée ajoutée
    // maintenant y va par défaut.
    await createFolderViaUi(page, "Perso");
    await page.click('button:has-text("Ajouter")');
    await expect(page.locator("#modal-folder")).toHaveValue(/.+/);
    await page.fill("#modal-label", "GitHub");
    await page.fill("#modal-username", "me@example.com");
    await page.fill("#modal-password", "GhSecretPassw0rd!");
    await page.click('button[type="submit"]:has-text("Ajouter")');
    await waitForSave(page);
    await expect(entry(page, "GitHub")).toBeVisible();

    // Une entrée sans dossier, rangée ensuite depuis son panneau de détail.
    await showAllEntries(page);
    await addLoginEntry(page, "Banque", "me@bank.example", "BankPassw0rd!");
    await waitForSave(page);
    await entry(page, "Banque").click();
    await page.getByRole("button", { name: "Déplacer vers un dossier" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Perso" }).click();
    await waitForSave(page);
    await expect(folderNav(page, "Perso").locator(".nav-count")).toHaveText("2");

    await logoutAndLogBackIn(page, email, PASSWORD);

    await folderNav(page, "Perso").click();
    await expect(title(page)).toHaveText("Perso");
    await expect(entry(page, "GitHub")).toBeVisible();
    await expect(entry(page, "Banque")).toBeVisible();
});

test("deleting a folder keeps its entries, without a folder", async ({ page }) => {
    const email = uniqueEmail("folders-delete");
    await registerViaUi(page, email, PASSWORD);

    await createFolderViaUi(page, "Perso");
    await addLoginEntry(page, "GitHub", "me@example.com", "GhSecretPassw0rd!");
    await waitForSave(page);

    await page.getByRole("button", { name: "Supprimer le dossier" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("Son entrée restera dans le coffre, sans dossier.");
    await dialog.getByRole("button", { name: "Supprimer le dossier" }).click();
    await waitForSave(page);

    await expect(title(page)).toHaveText("Tous les identifiants");
    await expect(folderNav(page, "Perso")).toHaveCount(0);
    await expect(entry(page, "GitHub")).toBeVisible();

    // L'entrée ajoutée reste affichée dans le détail : il doit refléter la
    // suppression, sans quoi « Modifier » réécrirait l'ancien dossier.
    const detail = page.locator(".vault-detail");
    await expect(detail).toContainText("GitHub");
    await expect(detail).not.toContainText("Dossier");
    await page.getByRole("button", { name: "Déplacer vers un dossier" }).click();
    await expect(page.getByRole("dialog").getByRole("button", { name: "Aucun dossier" })).toHaveAttribute("aria-current", "true");
    await page.keyboard.press("Escape");

    await logoutAndLogBackIn(page, email, PASSWORD);
    await expect(entry(page, "GitHub")).toBeVisible();
    await expect(folderNav(page, "Perso")).toHaveCount(0);
});

test("changing the master password keeps the folders and what is filed in them", async ({ page }) => {
    const email = uniqueEmail("folders-changepw");
    const newPassword = "Galet-Brume-Classeur-83?";
    await registerViaUi(page, email, PASSWORD);

    await createFolderViaUi(page, "Perso");
    await addLoginEntry(page, "GitHub", "me@example.com", "GhSecretPassw0rd!");
    await waitForSave(page);

    await page.click('button:has-text("Changer le mot de passe")');
    await page.fill("#cp-current", PASSWORD);
    await page.fill("#cp-new", newPassword);
    await page.fill("#cp-confirm", newPassword);
    await page.click('button[type="submit"]:has-text("Changer le mot de passe")');
    await page.waitForURL("**/login", { timeout: 15_000 });

    await loginViaUi(page, email, newPassword);
    await page.waitForURL("**/vault", { timeout: 15_000 });
    await folderNav(page, "Perso").click();
    await expect(entry(page, "GitHub")).toBeVisible();
});

test("dropping an entry card on a folder of the sidebar files it there", async ({ page }) => {
    const email = uniqueEmail("folders-drag");
    await registerViaUi(page, email, PASSWORD);

    await createFolderViaUi(page, "Perso");
    await showAllEntries(page);
    await addLoginEntry(page, "GitHub", "me@example.com", "GhSecretPassw0rd!");
    await waitForSave(page);

    await page.locator(".entry-card", { hasText: "GitHub" }).dragTo(folderNav(page, "Perso"));
    await waitForSave(page);
    await expect(folderNav(page, "Perso").locator(".nav-count")).toHaveText("1");

    await logoutAndLogBackIn(page, email, PASSWORD);
    await folderNav(page, "Perso").click();
    await expect(entry(page, "GitHub")).toBeVisible();
});

test("on mobile, closing « Nouveau dossier » opened from the folder list gives focus back to the Dossiers tab", async ({ page }) => {
    await registerViaUi(page, uniqueEmail("folders-focus"), PASSWORD);
    await page.setViewportSize({ width: 375, height: 760 });

    const foldersTab = page.locator(".nav-item-folders-mobile");
    await foldersTab.click();
    await page.getByRole("dialog", { name: "Dossiers" }).getByRole("button", { name: "Nouveau dossier" }).click();
    await expect(page.getByRole("dialog", { name: "Nouveau dossier" })).toBeVisible();

    await page.keyboard.press("Escape");

    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(foldersTab).toBeFocused();
});
