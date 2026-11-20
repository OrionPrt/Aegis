import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { AuthError } from "../lib/auth-client";

const verifyEmail = vi.fn();
vi.mock("../lib/auth-client", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../lib/auth-client")>()),
    verifyEmail: (...args: unknown[]) => verifyEmail(...args),
}));
const { default: VerifyEmailPage } = await import("./VerifyEmailPage");

function renderAt(path: string) {
    return render(
        <MemoryRouter initialEntries={[path]}>
            <Routes>
                <Route path="/verify-email" element={<VerifyEmailPage />} />
                <Route path="/login" element={<p>Page de connexion</p>} />
            </Routes>
        </MemoryRouter>,
    );
}

afterEach(() => {
    cleanup();
    verifyEmail.mockReset();
});

describe("VerifyEmailPage", () => {
    it("waits for a click before confirming (mail scanners open links on their own)", async () => {
        verifyEmail.mockResolvedValue("Adresse confirmée. Vous pouvez vous connecter.");
        const user = userEvent.setup();
        renderAt("/verify-email?token=abc_DEF-123");

        expect(verifyEmail).not.toHaveBeenCalled();
        await user.click(screen.getByRole("button", { name: "Confirmer mon adresse" }));

        expect(verifyEmail).toHaveBeenCalledWith("abc_DEF-123");
        expect(await screen.findByRole("status")).toHaveTextContent("Adresse confirmée");
        await user.click(screen.getByRole("link", { name: "Se connecter" }));
        expect(screen.getByText("Page de connexion")).toBeInTheDocument();
    });

    it("explains an expired or already used link and points to the login screen to get a new one", async () => {
        verifyEmail.mockImplementation(async () => { throw new AuthError("Lien de confirmation invalide ou expiré.", 400); });
        const user = userEvent.setup();
        renderAt("/verify-email?token=used");

        await user.click(screen.getByRole("button", { name: "Confirmer mon adresse" }));

        expect(await screen.findByRole("alert")).toHaveTextContent("invalide ou expiré");
        expect(screen.getByRole("link", { name: "Aller à la connexion" })).toBeInTheDocument();
    });

    it("does not offer to confirm when the link carries no token", () => {
        renderAt("/verify-email");
        expect(screen.queryByRole("button", { name: "Confirmer mon adresse" })).toBeNull();
        expect(screen.getByRole("alert")).toHaveTextContent("incomplet");
    });
});
