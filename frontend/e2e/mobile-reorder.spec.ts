import { test, expect, devices } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { uniqueEmail, registerViaUi, loginViaUi, addLoginEntry } from "./helpers.js";

// `isMobile` + `hasTouch` : viewport mobile et vrais événements tactiles.
const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices["Pixel 7"];
test.use({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch });

const PASSWORD = "MobileReorderPassw0rd!";
const TOUCH_STEPS = 8;
const OTHER_POINTER_ID = 999;
const LOGOUT_BUTTON = '.mobile-logout-btn[title="Déconnexion"]';

type Point = { x: number; y: number };

async function centerOf(locator: Locator): Promise<Point> {
    const box = await locator.boundingBox();
    if (!box) throw new Error("Élément non visible");
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Pose un doigt sur `from`, le déplace vers `to` ; à relâcher avec le retour. */
async function touchDrag(page: Page, from: Point, to: Point): Promise<() => Promise<void>> {
    const cdp = await page.context().newCDPSession(page);
    const touch = (type: "touchStart" | "touchMove" | "touchEnd", points: Point[]) =>
        cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });

    await touch("touchStart", [from]);
    for (let step = 1; step <= TOUCH_STEPS; step++) {
        const ratio = step / TOUCH_STEPS;
        await touch("touchMove", [{
            x: from.x + (to.x - from.x) * ratio,
            y: from.y + (to.y - from.y) * ratio,
        }]);
    }
    return async () => { await touch("touchEnd", []); };
}

function card(page: Page, label: string): Locator {
    return page.locator(".entry-card", { hasText: label });
}

function labels(page: Page): Locator {
    return page.locator(".entry-label");
}

async function addEntries(page: Page, names: string[]): Promise<void> {
    for (const name of names) {
        await addLoginEntry(page, name, "me@example.com", "EntryPassw0rd!");
        // Sur mobile, l'entrée créée s'ouvre en plein écran par-dessus la liste.
        await page.locator(".mobile-back-btn").click();
        await expect(card(page, name)).toBeVisible();
    }
}

test("le doigt réordonne les entrées via la poignée, et l'ordre survit à la reconnexion", async ({ page }) => {
    const email = uniqueEmail("mobile-reorder");
    await registerViaUi(page, email, PASSWORD);
    await addEntries(page, ["Alpha", "Bravo", "Charlie"]);

    const handle = card(page, "Alpha").locator(".entry-drag-handle");
    await expect(handle).toBeVisible();
    await expect(handle).toHaveCSS("opacity", "1");

    const handleBox = await handle.boundingBox();
    expect(handleBox?.width).toBeGreaterThanOrEqual(44);
    expect(handleBox?.height).toBeGreaterThanOrEqual(44);

    // Moitié basse de la dernière carte : Alpha doit pouvoir finir en dernier.
    const lastCard = await card(page, "Charlie").boundingBox();
    if (!lastCard) throw new Error("Carte non visible");
    const release = await touchDrag(page, await centerOf(handle), {
        x: lastCard.x + 40,
        y: lastCard.y + lastCard.height * 0.75,
    });
    await expect(card(page, "Alpha")).toHaveClass(/dragging/);
    await expect(card(page, "Charlie")).toHaveClass(/drop-after/);
    await release();

    await expect(labels(page)).toHaveText(["Bravo", "Charlie", "Alpha"]);
    await expect(page.locator(".detail-name")).toHaveCount(0);

    await page.locator(LOGOUT_BUTTON).click();
    await page.waitForURL("**/login");
    await loginViaUi(page, email, PASSWORD);
    await page.waitForURL("**/vault", { timeout: 15_000 });
    await expect(labels(page)).toHaveText(["Bravo", "Charlie", "Alpha"]);
});

test("le doigt remonte une entrée dans la moitié haute d'une carte", async ({ page }) => {
    await registerViaUi(page, uniqueEmail("mobile-reorder-up"), PASSWORD);
    await addEntries(page, ["Alpha", "Bravo", "Charlie"]);

    const firstCard = await card(page, "Alpha").boundingBox();
    if (!firstCard) throw new Error("Carte non visible");
    const release = await touchDrag(
        page,
        await centerOf(card(page, "Charlie").locator(".entry-drag-handle")),
        { x: firstCard.x + 40, y: firstCard.y + firstCard.height * 0.25 },
    );
    await release();

    await expect(labels(page)).toHaveText(["Charlie", "Alpha", "Bravo"]);
});

test("la fin du contact d'un second doigt n'annule pas le glissement en cours", async ({ page }) => {
    await registerViaUi(page, uniqueEmail("mobile-reorder-multitouch"), PASSWORD);
    await addEntries(page, ["Alpha", "Bravo", "Charlie"]);

    const lastCard = await card(page, "Charlie").boundingBox();
    if (!lastCard) throw new Error("Carte non visible");
    const release = await touchDrag(
        page,
        await centerOf(card(page, "Alpha").locator(".entry-drag-handle")),
        { x: lastCard.x + 40, y: lastCard.y + lastCard.height * 0.75 },
    );

    // Le protocole CDP ne sait pas lever un seul doigt (`touchEnd` les lève
    // tous) : on rejoue donc les événements que reçoit la poignée d'un second
    // doigt quand il se lève ou que le navigateur l'annule.
    const otherHandle = card(page, "Bravo").locator(".entry-drag-handle");
    for (const type of ["pointercancel", "lostpointercapture"]) {
        await otherHandle.dispatchEvent(type, { pointerId: OTHER_POINTER_ID, bubbles: true });
    }

    await expect(card(page, "Alpha")).toHaveClass(/dragging/);
    await release();
    await expect(labels(page)).toHaveText(["Bravo", "Charlie", "Alpha"]);
});

test("toucher la carte hors de la poignée ouvre toujours l'entrée", async ({ page }) => {
    await registerViaUi(page, uniqueEmail("mobile-reorder-tap"), PASSWORD);
    await addEntries(page, ["Alpha", "Bravo"]);

    await card(page, "Alpha").locator(".entry-info").tap();

    await expect(page.locator(".detail-name")).toHaveText("Alpha");
    await expect(labels(page)).toHaveText(["Alpha", "Bravo"]);
});

test("la liste défile quand le doigt reste près du bord bas", async ({ page }) => {
    await registerViaUi(page, uniqueEmail("mobile-reorder-scroll"), PASSWORD);
    const names = Array.from({ length: 12 }, (_, i) => `Entree ${String(i + 1).padStart(2, "0")}`);
    await addEntries(page, names);

    const list = page.locator(".entry-list");
    const listBox = await list.boundingBox();
    if (!listBox) throw new Error("Liste non visible");
    expect(await list.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);

    const release = await touchDrag(
        page,
        await centerOf(card(page, "Entree 01").locator(".entry-drag-handle")),
        { x: listBox.x + 60, y: listBox.y + listBox.height - 10 },
    );

    await expect.poll(() => list.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await release();
});
