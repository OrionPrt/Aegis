import { test, expect } from "@playwright/test";

test("the app loads its fonts from its own origin and contacts no third party", async ({ page, baseURL }) => {
    const ownOrigin = new URL(baseURL!).origin;
    const foreignRequests: string[] = [];
    page.on("request", (request) => {
        const origin = new URL(request.url()).origin;
        if (origin !== ownOrigin && !request.url().startsWith("data:")) foreignRequests.push(request.url());
    });

    await page.goto("/login");
    await page.evaluate(() => document.fonts.ready);

    // Une police n'est téléchargée qu'à sa première utilisation : la page de
    // connexion n'affiche pas de texte en chasse fixe, on la demande ici.
    const loaded = await page.evaluate(async () => {
        const [inter, mono] = await Promise.all([
            document.fonts.load("600 16px Inter"),
            document.fonts.load("500 16px 'IBM Plex Mono'"),
        ]);
        return { inter: inter.length > 0, mono: mono.length > 0 };
    });
    expect(loaded).toEqual({ inter: true, mono: true });
    expect(foreignRequests).toEqual([]);
});
