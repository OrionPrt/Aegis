import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EntryDetail from "./EntryDetail";
import type { VaultEntryExtended } from "./types";

function loginEntry(url: string): VaultEntryExtended {
    return { id: "1", label: "Site", category: "login", username: "me", password: "pw", url, createdAt: 0, updatedAt: 0 };
}

function renderDetail(entry: VaultEntryExtended) {
    return render(<EntryDetail entry={entry} saving={false} onBack={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} />);
}

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe("EntryDetail", () => {
    it("never turns a non-web URL into a link", () => {
        renderDetail(loginEntry("javascript:alert(document.cookie)"));

        expect(screen.queryByRole("link")).toBeNull();
        expect(screen.queryByTitle("Ouvrir le site")).toBeNull();
        expect(screen.getAllByText("javascript:alert(document.cookie)").length).toBeGreaterThan(0);
    });

    it("links a web URL and opens it from the button, without access to this page", async () => {
        const open = vi.spyOn(window, "open").mockReturnValue(null);
        renderDetail(loginEntry("https://github.com/login"));

        expect(screen.getByRole("link", { name: "https://github.com/login" })).toHaveAttribute("rel", "noopener noreferrer");
        await userEvent.click(screen.getByTitle("Ouvrir le site"));

        expect(open).toHaveBeenCalledWith("https://github.com/login", "_blank", "noopener,noreferrer");
    });

    it("explains a refused copy instead of failing silently", async () => {
        const user = userEvent.setup();
        vi.stubGlobal("navigator", {
            ...navigator,
            clipboard: { writeText: vi.fn().mockRejectedValue(new DOMException("denied", "NotAllowedError")) },
        });
        renderDetail(loginEntry("https://github.com"));

        await user.click(screen.getAllByTitle("Copier")[0]);

        expect(await screen.findByRole("alert")).toHaveTextContent("presse-papiers");
    });
});
