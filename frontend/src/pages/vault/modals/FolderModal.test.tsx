import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FolderModal from "./FolderModal";
import type { VaultFolder } from "../../../lib/vault-format";

const PERSO: VaultFolder = { id: "f1", name: "Perso", createdAt: 0, updatedAt: 0 };

afterEach(cleanup);

describe("FolderModal", () => {
    it("creates a folder with the typed name", async () => {
        const user = userEvent.setup();
        const onSave = vi.fn().mockResolvedValue(undefined);
        render(<FolderModal folder={null} folders={[PERSO]} onClose={vi.fn()} onSave={onSave} />);

        await user.type(screen.getByLabelText("Nom du dossier"), "Banque");
        await user.click(screen.getByRole("button", { name: "Créer" }));

        expect(onSave).toHaveBeenCalledWith("Banque");
    });

    it("refuses a name already taken and does not save", async () => {
        const user = userEvent.setup();
        const onSave = vi.fn();
        render(<FolderModal folder={null} folders={[PERSO]} onClose={vi.fn()} onSave={onSave} />);

        await user.type(screen.getByLabelText("Nom du dossier"), "perso");
        await user.click(screen.getByRole("button", { name: "Créer" }));

        expect(screen.getByRole("alert")).toHaveTextContent("Un dossier porte déjà ce nom.");
        expect(onSave).not.toHaveBeenCalled();
    });

    it("renames a folder, starting from its current name", async () => {
        const user = userEvent.setup();
        const onSave = vi.fn().mockResolvedValue(undefined);
        render(<FolderModal folder={PERSO} folders={[PERSO]} onClose={vi.fn()} onSave={onSave} />);

        const input = screen.getByLabelText("Nom du dossier");
        expect(input).toHaveValue("Perso");
        await user.clear(input);
        await user.type(input, "Famille");
        await user.click(screen.getByRole("button", { name: "Renommer" }));

        expect(onSave).toHaveBeenCalledWith("Famille");
    });

    it("keeps the dialog open with the error when saving fails", async () => {
        const user = userEvent.setup();
        const onSave = vi.fn().mockRejectedValue(new Error("Le coffre a été modifié sur un autre appareil."));
        render(<FolderModal folder={null} folders={[]} onClose={vi.fn()} onSave={onSave} />);

        await user.type(screen.getByLabelText("Nom du dossier"), "Banque");
        await user.click(screen.getByRole("button", { name: "Créer" }));

        expect(await screen.findByRole("alert")).toHaveTextContent("modifié sur un autre appareil");
        expect(screen.getByLabelText("Nom du dossier")).toHaveValue("Banque");
    });
});
