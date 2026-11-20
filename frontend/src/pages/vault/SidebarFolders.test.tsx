import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SidebarFolders from "./SidebarFolders";
import { ENTRY_DRAG_TYPE } from "./folders";
import type { VaultFolder } from "../../lib/vault-format";

const FOLDERS: VaultFolder[] = [
    { id: "f1", name: "Perso", createdAt: 0, updatedAt: 0 },
    { id: "f2", name: "Travail", createdAt: 0, updatedAt: 0 },
];

function renderFolders(activeFolderId: string | null = null, isDropDisabled = false) {
    const props = {
        onOpenFolder: vi.fn(),
        onCreateFolder: vi.fn(),
        onOpenFolderPicker: vi.fn(),
        onDropEntry: vi.fn(),
    };
    render(
        <SidebarFolders folders={FOLDERS} counts={{ f1: 3 }} activeFolderId={activeFolderId} isDropDisabled={isDropDisabled} {...props} />,
    );
    return props;
}

/** DataTransfer minimal : jsdom n'en fournit pas pour les événements de glisser. */
function entryDrag(entryId: string, type = ENTRY_DRAG_TYPE) {
    return { dataTransfer: { types: [type], getData: (t: string) => (t === type ? entryId : ""), dropEffect: "none" } };
}

const folderButton = (name: string) => screen.getByRole("button", { name: new RegExp(`^${name}`) });

afterEach(cleanup);

describe("SidebarFolders", () => {
    it("lists each folder with its entry count and opens it on click", async () => {
        const user = userEvent.setup();
        const { onOpenFolder } = renderFolders("f2");

        expect(folderButton("Perso")).toHaveTextContent("3");
        expect(folderButton("Travail")).toHaveTextContent("0");
        expect(folderButton("Travail")).toHaveClass("active");

        await user.click(folderButton("Perso"));
        expect(onOpenFolder).toHaveBeenCalledWith("f1");
    });

    it("creates a folder from the section header", async () => {
        const user = userEvent.setup();
        const { onCreateFolder } = renderFolders();

        await user.click(screen.getByRole("button", { name: "Nouveau dossier" }));
        expect(onCreateFolder).toHaveBeenCalledOnce();
    });

    it("moves an entry card dropped on a folder into it, highlighting the folder meanwhile", () => {
        const { onDropEntry } = renderFolders();

        fireEvent.dragOver(folderButton("Travail"), entryDrag("e1"));
        expect(folderButton("Travail")).toHaveClass("drop-target");

        fireEvent.drop(folderButton("Travail"), entryDrag("e1"));
        expect(onDropEntry).toHaveBeenCalledWith("e1", "f2");
        expect(folderButton("Travail")).not.toHaveClass("drop-target");
    });

    it("ignores anything dragged that is not an entry card", () => {
        const { onDropEntry } = renderFolders();

        fireEvent.dragOver(folderButton("Perso"), entryDrag("x", "text/plain"));
        fireEvent.drop(folderButton("Perso"), entryDrag("x", "text/plain"));

        expect(folderButton("Perso")).not.toHaveClass("drop-target");
        expect(onDropEntry).not.toHaveBeenCalled();
    });

    it("refuses a drop while a save is in progress, so it cannot erase what is being saved", () => {
        const { onDropEntry } = renderFolders(null, true);

        fireEvent.dragOver(folderButton("Travail"), entryDrag("e1"));
        fireEvent.drop(folderButton("Travail"), entryDrag("e1"));

        expect(folderButton("Travail")).not.toHaveClass("drop-target");
        expect(onDropEntry).not.toHaveBeenCalled();
    });

    it("keeps the highlight over the folder's own icon and label, and drops it on leaving", () => {
        renderFolders();
        const travail = folderButton("Travail");
        fireEvent.dragOver(travail, entryDrag("e1"));

        // jsdom n'a pas de DragEvent : un MouseEvent du même type porte relatedTarget.
        const leaveTowards = (relatedTarget: Element | null) =>
            fireEvent(travail, new MouseEvent("dragleave", { bubbles: true, relatedTarget }));

        leaveTowards(travail.querySelector(".nav-label"));
        expect(travail).toHaveClass("drop-target");

        leaveTowards(document.body);
        expect(travail).not.toHaveClass("drop-target");
    });
});
