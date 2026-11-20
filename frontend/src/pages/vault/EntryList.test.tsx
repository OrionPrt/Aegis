import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import EntryList from "./EntryList";
import type { VaultEntryExtended } from "./types";

const ENTRIES: VaultEntryExtended[] = ["GitHub", "Banque", "Mail"].map((label, i) => ({
    id: String(i), label, category: "login", username: `${label.toLowerCase()}@example.com`, createdAt: 0, updatedAt: 0,
}));

function renderList(search = "") {
    const onSelect = vi.fn();
    const onReorder = vi.fn();
    render(<EntryList entries={ENTRIES} selectedId="0" search={search} saving={false} onSelect={onSelect} onReorder={onReorder} />);
    return { onSelect, onReorder };
}

const card = (label: string) => screen.getByRole("button", { name: new RegExp(label) });

afterEach(cleanup);

describe("EntryList — keyboard", () => {
    it("opens an entry with Enter or Space and marks the selected one", async () => {
        const user = userEvent.setup();
        const { onSelect } = renderList();

        expect(card("GitHub")).toHaveAttribute("aria-current", "true");
        card("Banque").focus();
        await user.keyboard("{Enter}");
        card("Mail").focus();
        await user.keyboard(" ");

        expect(onSelect.mock.calls.map(([e]) => e.label)).toEqual(["Banque", "Mail"]);
    });

    it("moves an entry with Alt+Arrow keys and announces its new position", async () => {
        const user = userEvent.setup();
        const { onReorder } = renderList();

        card("Banque").focus();
        await user.keyboard("{Alt>}{ArrowDown}{/Alt}");
        expect(onReorder).toHaveBeenLastCalledWith("1", "2", "after");
        expect(screen.getByText("Banque : position 3 sur 3.")).toBeInTheDocument();

        await user.keyboard("{Alt>}{ArrowUp}{/Alt}");
        expect(onReorder).toHaveBeenLastCalledWith("1", "0", "before");
    });

    it("does nothing past the ends of the list or while a search filters it", async () => {
        const user = userEvent.setup();
        const { onReorder } = renderList();
        card("GitHub").focus();
        await user.keyboard("{Alt>}{ArrowUp}{/Alt}");
        expect(onReorder).not.toHaveBeenCalled();

        cleanup();
        const filtered = renderList("a");
        card("Banque").focus();
        await user.keyboard("{Alt>}{ArrowDown}{/Alt}");
        expect(filtered.onReorder).not.toHaveBeenCalled();
    });
});
