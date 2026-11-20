import { describe, it, expect } from "vitest";
import { normalizeEntryUrl, safeHttpUrl } from "./url";

describe("safeHttpUrl", () => {
    it("keeps http and https addresses", () => {
        expect(safeHttpUrl("https://github.com/login")).toBe("https://github.com/login");
        expect(safeHttpUrl("http://intranet.local")).toBe("http://intranet.local/");
    });

    it("refuses every other scheme and unparsable values", () => {
        for (const url of ["javascript:alert(1)", "data:text/html,<b>x</b>", "vbscript:x", "file:///etc/passwd", "pas une url", ""]) {
            expect(safeHttpUrl(url), url).toBeNull();
        }
    });
});

describe("normalizeEntryUrl", () => {
    it("adds https:// to a bare domain and leaves an empty field empty", () => {
        expect(normalizeEntryUrl("github.com")).toEqual({ url: "https://github.com" });
        expect(normalizeEntryUrl("  ")).toEqual({ url: undefined });
    });

    it("keeps an explicit http or https address", () => {
        expect(normalizeEntryUrl("http://192.168.1.1:8080/admin")).toEqual({ url: "http://192.168.1.1:8080/admin" });
    });

    it("rejects a non-web scheme with a message", () => {
        expect(normalizeEntryUrl("javascript:alert(1)").error).toMatch(/http/);
    });
});
