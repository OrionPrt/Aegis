import "@testing-library/jest-dom/vitest";
import { StrictMode, useState } from "react";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Modal from "./Modal";

afterEach(cleanup);

function Harness({ dismissible = true, onClose = vi.fn() }: { dismissible?: boolean; onClose?: () => void }) {
    const [open, setOpen] = useState(false);
    return (
        <>
            <button onClick={() => setOpen(true)}>Ouvrir</button>
            {open && (
                <Modal title="Supprimer l'entrée" dismissible={dismissible} onClose={() => { onClose(); setOpen(false); }}>
                    <button>Option</button>
                    <input aria-label="Premier champ" data-autofocus />
                    <button>Confirmer</button>
                </Modal>
            )}
        </>
    );
}

/** Une fenêtre qui en ouvre une autre à sa place (ex. « Nouveau dossier » dans la liste des dossiers). */
function SwapHarness() {
    const [dialog, setDialog] = useState<"list" | "create" | null>(null);
    return (
        <>
            <button onClick={() => setDialog("list")}>Dossiers</button>
            {dialog === "list" && (
                <Modal title="Dossiers" onClose={() => setDialog(null)}>
                    <button onClick={() => setDialog("create")}>Nouveau dossier</button>
                </Modal>
            )}
            {dialog === "create" && (
                <Modal title="Nouveau dossier" onClose={() => setDialog(null)}>
                    <input aria-label="Nom du dossier" />
                </Modal>
            )}
        </>
    );
}

describe("Modal", () => {
    it("focuses the field marked data-autofocus, even when StrictMode replays the effect", async () => {
        render(<StrictMode><Harness /></StrictMode>);
        await userEvent.click(screen.getByText("Ouvrir"));
        expect(screen.getByLabelText("Premier champ")).toHaveFocus();
    });

    it("is announced as a modal dialog named by its title", async () => {
        render(<Harness />);
        await userEvent.click(screen.getByText("Ouvrir"));

        const dialog = screen.getByRole("dialog", { name: "Supprimer l'entrée" });
        expect(dialog).toHaveAttribute("aria-modal", "true");
    });

    it("moves focus inside, keeps Tab within the dialog, and gives it back on close", async () => {
        const user = userEvent.setup();
        render(<Harness />);
        await user.click(screen.getByText("Ouvrir"));

        // Ordre du DOM : croix de l'en-tête, puis contenu. Tab boucle sans sortir.
        expect(screen.getByLabelText("Premier champ")).toHaveFocus();
        await user.tab();
        expect(screen.getByText("Confirmer")).toHaveFocus();
        await user.tab();
        expect(screen.getByRole("button", { name: "Fermer" })).toHaveFocus();
        await user.tab({ shift: true });
        expect(screen.getByText("Confirmer")).toHaveFocus();

        await user.keyboard("{Escape}");
        expect(screen.queryByRole("dialog")).toBeNull();
        expect(screen.getByText("Ouvrir")).toHaveFocus();
    });

    it("closes on an overlay click, but not when a text selection started inside ends on it", async () => {
        const onClose = vi.fn();
        render(<Harness onClose={onClose} />);
        await userEvent.click(screen.getByText("Ouvrir"));
        const overlay = screen.getByRole("dialog").parentElement!;

        fireEvent.pointerDown(screen.getByLabelText("Premier champ"));
        fireEvent.click(overlay);
        expect(onClose).not.toHaveBeenCalled();

        fireEvent.pointerDown(overlay);
        fireEvent.click(overlay);
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("cannot be dismissed while it says it is busy", async () => {
        const onClose = vi.fn();
        const user = userEvent.setup();
        render(<Harness dismissible={false} onClose={onClose} />);
        await user.click(screen.getByText("Ouvrir"));

        await user.keyboard("{Escape}");

        expect(onClose).not.toHaveBeenCalled();
        expect(screen.getByRole("button", { name: "Fermer" })).toBeDisabled();
    });

    it("gives focus back to the first opener when it replaced another dialog whose button is gone", async () => {
        const user = userEvent.setup();
        render(<StrictMode><SwapHarness /></StrictMode>);

        await user.click(screen.getByText("Dossiers"));
        await user.click(screen.getByText("Nouveau dossier"));
        expect(screen.getByRole("dialog", { name: "Nouveau dossier" })).toBeInTheDocument();

        await user.keyboard("{Escape}");

        expect(screen.queryByRole("dialog")).toBeNull();
        expect(screen.getByText("Dossiers")).toHaveFocus();
    });
});
