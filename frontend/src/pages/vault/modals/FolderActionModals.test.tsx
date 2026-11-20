import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import ConfirmDeleteFolderModal from "./ConfirmDeleteFolderModal";
import MoveToFolderModal from "./MoveToFolderModal";
import type { VaultFolder } from "../../../lib/vault-format";

const FOLDERS: VaultFolder[] = [
    { id: "f1", name: "Perso", createdAt: 0, updatedAt: 0 },
    { id: "f2", name: "Travail", createdAt: 0, updatedAt: 0 },
];

afterEach(cleanup);

describe("MoveToFolderModal", () => {
    function renderMove(onMove = vi.fn().mockResolvedValue(undefined)) {
        const onClose = vi.fn();
        render(<MoveToFolderModal entryLabel="GitHub" currentFolderId="f1" folders={FOLDERS} onClose={onClose} onMove={onMove} />);
        return { onMove, onClose };
    }

    it("marks the current folder and moves the entry to the chosen one, or out of any folder", async () => {
        const user = userEvent.setup();
        const { onMove } = renderMove();

        expect(screen.getByRole("button", { name: "Perso" })).toHaveAttribute("aria-current", "true");
        await user.click(screen.getByRole("button", { name: "Travail" }));
        expect(onMove).toHaveBeenLastCalledWith("f2");

        cleanup();
        const second = renderMove();
        await user.click(screen.getByRole("button", { name: "Aucun dossier" }));
        expect(second.onMove).toHaveBeenLastCalledWith(null);
    });

    it("just closes when the current folder is chosen again", async () => {
        const user = userEvent.setup();
        const { onMove, onClose } = renderMove();

        await user.click(screen.getByRole("button", { name: "Perso" }));

        expect(onMove).not.toHaveBeenCalled();
        expect(onClose).toHaveBeenCalledOnce();
    });

    it("stays open with the error when the move cannot be saved", async () => {
        const user = userEvent.setup();
        renderMove(vi.fn().mockRejectedValue(new Error("Le coffre a été modifié sur un autre appareil.")));

        await user.click(screen.getByRole("button", { name: "Travail" }));

        expect(await screen.findByRole("alert")).toHaveTextContent("modifié sur un autre appareil");
        expect(screen.getByRole("button", { name: "Travail" })).toBeEnabled();
    });
});

describe("ConfirmDeleteFolderModal", () => {
    it.each([
        [0, "Il est vide."],
        [1, "Son entrée restera dans le coffre, sans dossier."],
        [3, "Ses 3 entrées resteront dans le coffre, sans dossier."],
    ])("says what happens to %i entries", (entryCount, text) => {
        render(<ConfirmDeleteFolderModal name="Perso" entryCount={entryCount} onCancel={vi.fn()} onConfirm={vi.fn()} />);
        expect(screen.getByText(text, { exact: false })).toBeInTheDocument();
    });
});
