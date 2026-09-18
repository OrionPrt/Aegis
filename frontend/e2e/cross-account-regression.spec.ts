import { test, expect } from "@playwright/test";
import { uniqueEmail, registerViaUi } from "./helpers.js";

/**
 * Reproduit et vérifie le correctif du bug réel rencontré en production :
 * le cookie aegis_rt est partagé par tout le navigateur, alors que la
 * masterKey vit en mémoire par onglet. Un utilisateur qui connecte un
 * second compte dans le même navigateur pendant qu'un premier onglet reste
 * ouvert peut voir ce premier onglet rafraîchir son token avec le cookie du
 * SECOND compte. Avant le correctif, cela fusionnait silencieusement un
 * accessToken du mauvais compte avec l'ancienne masterKey, causant un
 * "Vault decryption failed" irrécupérable. Le correctif doit à la place
 * afficher une erreur explicite et jamais tenter un déchiffrement croisé.
 */
test("a token refresh racing a second account's login never corrupts the first tab's vault", async ({ context, page }) => {
    const emailA = uniqueEmail("crossacct-a");
    const emailB = uniqueEmail("crossacct-b");
    const password = "CrossAccountPassw0rd!";

    // Onglet 1 : compte A.
    await registerViaUi(page, emailA, password);

    // Onglet 2, MÊME contexte navigateur (donc même cookie aegis_rt) : compte B.
    const page2 = await context.newPage();
    await registerViaUi(page2, emailB, password);
    await page2.close();

    // À ce stade, le cookie aegis_rt de ce navigateur appartient au compte B.
    // On force un rafraîchissement sur l'onglet 1 (toujours en mémoire comme
    // compte A) en faisant échouer TOUT GET /api/vault à partir d'ici avec un
    // 401, pour simuler un accessToken expiré - exactement ce qui arriverait
    // naturellement après 15 minutes d'inactivité de l'access token.
    //
    // Toujours 401 (pas seulement le premier appel) : React StrictMode monte
    // VaultPage deux fois en développement, déclenchant deux GET /api/vault
    // quasi simultanés ; si un seul était intercepté, le second passerait
    // normalement et masquerait le comportement réel qu'on veut vérifier ici.
    // Comme refreshAccessToken() lève avant tout retry en cas de mélange de
    // comptes détecté, aucun de ces GET ne doit jamais atteindre le vrai
    // backend une fois ce point de test dépassé.
    await page.route("**/api/vault", (route) =>
        route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ message: "Session expirée." }) })
    );

    // Force un rechargement de useVault() (GET /api/vault) via une navigation
    // SPA aller-retour, sans perdre l'état mémoire de l'onglet (pas de reload
    // complet de page).
    await page.locator('.nav-item:has-text("Sécurité")').click();
    await page.waitForURL("**/sessions");
    await page.click('button:has-text("Retour au vault")');

    // Ne doit JAMAIS tenter de déchiffrer le vault du compte B avec la clé
    // du compte A - ni afficher l'ancien message d'erreur de déchiffrement.
    await expect(page.locator("text=/decryption failed|invalid key or corrupted/i")).toHaveCount(0);

    // À la place : soit un message explicite invitant à se reconnecter, soit
    // un renvoi propre vers /login - jamais un vault affiché silencieusement
    // avec les mauvaises données. Les deux refresh concurrents (double montage
    // StrictMode) impliquent un bcrypt.compare côté serveur (~500ms chacun) -
    // on laisse une marge confortable plutôt qu'un délai fixe trop court.
    await Promise.race([
        page.waitForURL("**/login", { timeout: 10_000 }),
        page.locator("text=/reconnect|autre compte/i").waitFor({ state: "visible", timeout: 10_000 }),
    ]);

    const onLoginPage = page.url().includes("/login");
    const hasReconnectMessage = await page.locator("text=/reconnect|autre compte/i").count() > 0;
    expect(onLoginPage || hasReconnectMessage).toBe(true);
});
