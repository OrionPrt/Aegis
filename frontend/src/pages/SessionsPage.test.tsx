import "@testing-library/jest-dom/vitest";
import { StrictMode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { AuthError } from "../lib/auth-client";

const apiFetch = vi.fn();
vi.mock("../lib/auth-client", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../lib/auth-client")>()),
    apiFetch: (...args: unknown[]) => apiFetch(...args),
}));

const { default: SessionsPage } = await import("./SessionsPage");

function session(id: string, isCurrent = false) {
    const now = new Date().toISOString();
    return { id, userAgent: "Mozilla/5.0 (X11; Linux x86_64) Chrome/130.0", ipAddress: `203.0.113.${id.length}`, lastUsedAt: now, createdAt: now, expiresAt: now, isCurrent };
}

function renderPage(strict = false) {
    const page = (
        <MemoryRouter initialEntries={["/sessions"]}>
            <Routes>
                <Route path="/sessions" element={<SessionsPage />} />
                <Route path="/login" element={<p>Page de connexion</p>} />
            </Routes>
        </MemoryRouter>
    );
    return render(strict ? <StrictMode>{page}</StrictMode> : page);
}

afterEach(cleanup);

describe("SessionsPage", () => {
    beforeEach(() => apiFetch.mockReset());

    it("lists the sessions and the first page of the audit log", async () => {
        apiFetch.mockImplementation(async (path: string) =>
            path === "/sessions" ? { sessions: [session("a", true), session("bb")] } : { logs: [], total: 0 });

        renderPage();

        expect(await screen.findByText("2 sessions actives")).toBeInTheDocument();
        expect(screen.getByText("Cet appareil")).toBeInTheDocument();
    });

    it("keeps the result of the latest load when an earlier one answers last", async () => {
        // StrictMode monte l'effet deux fois : le premier chargement répond en
        // dernier, avec des données périmées qui ne doivent pas s'afficher.
        let call = 0;
        apiFetch.mockImplementation(async (path: string) => {
            if (path !== "/sessions") return { logs: [], total: 0 };
            call += 1;
            if (call === 1) {
                await new Promise((resolve) => setTimeout(resolve, 50));
                return { sessions: [session("stale")] };
            }
            return { sessions: [session("fresh", true), session("other")] };
        });

        renderPage(true);

        expect(await screen.findByText("2 sessions actives")).toBeInTheDocument();
        await new Promise((resolve) => setTimeout(resolve, 80));
        expect(screen.getByText("2 sessions actives")).toBeInTheDocument();
    });

    it("sends the user back to the login page when the session has expired", async () => {
        apiFetch.mockImplementation(async (path: string) => {
            if (path === "/sessions") throw new AuthError("Session expirée.", 401);
            return { logs: [], total: 0 };
        });
        renderPage();
        expect(await screen.findByText("Page de connexion")).toBeInTheDocument();
    });

    it("says so when revoking a session fails, instead of failing silently", async () => {
        apiFetch.mockImplementation(async (path: string, options?: RequestInit) => {
            if (options?.method === "DELETE") throw new AuthError("Session introuvable.", 404);
            return path === "/sessions" ? { sessions: [session("a", true), session("bb")] } : { logs: [], total: 0 };
        });
        const user = userEvent.setup();
        renderPage();

        await user.click(await screen.findByTitle("Révoquer cette session"));

        expect(await screen.findByRole("alert")).toHaveTextContent("Session introuvable.");
    });
});
