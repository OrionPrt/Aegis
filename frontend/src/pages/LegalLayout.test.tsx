import "@testing-library/jest-dom/vitest"; // types des matchers pour `tsc -b`
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, within, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import AuthPage from "./AuthPage";
import PrivacyPage from "./PrivacyPage";
import TermsPage from "./TermsPage";
import CookiesPage from "./CookiesPage";

function renderApp(initialPath: string) {
    return render(
        <MemoryRouter initialEntries={[initialPath]}>
            <Routes>
                <Route path="/" element={<p>Accueil</p>} />
                <Route path="/login" element={<AuthPage />} />
                <Route path="/privacy" element={<PrivacyPage />} />
                <Route path="/terms" element={<TermsPage />} />
                <Route path="/cookies" element={<CookiesPage />} />
            </Routes>
        </MemoryRouter>,
    );
}

const legalNav = () => screen.getByRole("navigation");

// `globals: false` dans vitest.config.ts → RTL ne nettoie pas le DOM tout seul.
afterEach(cleanup);

describe("LegalLayout — bouton Retour", () => {
    it("revient à la page de connexion après avoir navigué entre plusieurs pages légales", async () => {
        const user = userEvent.setup();
        renderApp("/login");

        await user.click(screen.getByRole("link", { name: "Cookies" }));
        await user.click(within(legalNav()).getByRole("link", { name: "Conditions d'utilisation" }));
        await user.click(within(legalNav()).getByRole("link", { name: "Confidentialité" }));
        expect(screen.getByRole("heading", { name: "Politique de confidentialité" })).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "Retour" }));

        expect(screen.getByRole("button", { name: "Déverrouiller le vault" })).toBeInTheDocument();
    });

    it("revient sur le formulaire d'inscription quand les CGU ont été ouvertes depuis celui-ci", async () => {
        const user = userEvent.setup();
        renderApp("/login");

        await user.click(screen.getByRole("button", { name: "Créer un compte" }));
        await user.click(screen.getByRole("link", { name: "conditions d'utilisation" }));
        expect(screen.getByRole("heading", { name: "Conditions d'utilisation" })).toBeInTheDocument();

        await user.click(screen.getByRole("button", { name: "Retour" }));

        expect(screen.getByRole("button", { name: "Créer mon vault" })).toBeInTheDocument();
    });

    it("renvoie vers l'accueil quand la page légale a été ouverte directement", async () => {
        const user = userEvent.setup();
        renderApp("/cookies");

        await user.click(screen.getByRole("button", { name: "Retour" }));

        expect(screen.getByText("Accueil")).toBeInTheDocument();
    });
});
