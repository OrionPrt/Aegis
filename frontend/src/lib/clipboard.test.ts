import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { copySecret, CLIPBOARD_CLEAR_MS } from "./clipboard";

function stubClipboard(options: { readPermission?: PermissionState; current?: () => string } = {}) {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const readText = vi.fn(async () => options.current?.() ?? "");
    vi.stubGlobal("navigator", {
        clipboard: { writeText, readText },
        permissions: { query: vi.fn(async () => ({ state: options.readPermission ?? "prompt" })) },
    });
    return { writeText, readText };
}

describe("copySecret", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it("copies the value and clears the clipboard 30 seconds later", async () => {
        const { writeText } = stubClipboard();

        await copySecret("s3cret");
        await vi.advanceTimersByTimeAsync(CLIPBOARD_CLEAR_MS);

        expect(writeText.mock.calls).toEqual([["s3cret"], [""]]);
    });

    it("restarts the delay on each copy, so a later copy is not wiped early", async () => {
        const { writeText } = stubClipboard();

        await copySecret("first");
        await vi.advanceTimersByTimeAsync(20_000);
        await copySecret("second");
        await vi.advanceTimersByTimeAsync(20_000);

        expect(writeText.mock.calls).toEqual([["first"], ["second"]]);
        await vi.advanceTimersByTimeAsync(10_000);
        expect(writeText.mock.calls.at(-1)).toEqual([""]);
    });

    it("leaves the clipboard alone when it can see the user copied something else since", async () => {
        let clipboard = "";
        const { writeText } = stubClipboard({ readPermission: "granted", current: () => clipboard });

        await copySecret("s3cret");
        clipboard = "texte copié ailleurs";
        await vi.advanceTimersByTimeAsync(CLIPBOARD_CLEAR_MS);

        expect(writeText.mock.calls).toEqual([["s3cret"]]);
    });

    it("reports a refused copy to the caller", async () => {
        const { writeText } = stubClipboard();
        writeText.mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"));

        await expect(copySecret("s3cret")).rejects.toThrow();
    });
});
