import { describe, it, expect } from "vitest";
import html from "../index.html?raw";

describe("index.html", () => {
    it("declares French as the document language, like the whole interface", () => {
        expect(html).toMatch(/<html lang="fr">/);
    });
});
