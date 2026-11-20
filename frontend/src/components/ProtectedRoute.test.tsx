import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { MemoryRouter, Routes, Route, useLocation } from "react-router-dom";
import ProtectedRoute from "./ProtectedRoute";
import type { LoginRedirectState } from "./ProtectedRoute";
import { clearSession, login } from "../lib/auth-client";

function LoginProbe() {
    const state = useLocation().state as LoginRedirectState | null;
    return <p>Connexion{state?.lockReason ? ` (${state.lockReason})` : ""}</p>;
}

function renderVault() {
    return render(
        <MemoryRouter initialEntries={["/vault"]}>
            <Routes>
                <Route path="/vault" element={<ProtectedRoute><p>Coffre ouvert</p></ProtectedRoute>} />
                <Route path="/login" element={<LoginProbe />} />
            </Routes>
        </MemoryRouter>,
    );
}

async function openSession() {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
        ok: true,
        status: 200,
        json: async () => url.includes("/auth/salt")
            ? { saltBase64: btoa("x".repeat(32)) }
            : { accessToken: "t", expiresAt: Date.now() + 900_000 },
    })));
    await login("user@example.com", "MasterPassw0rd!");
}

afterEach(() => {
    cleanup();
    clearSession();
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe("ProtectedRoute", () => {
    it("redirects to the login page without a session", () => {
        renderVault();
        expect(screen.getByText("Connexion")).toBeInTheDocument();
    });

    it("shows the page while a session exists and leaves as soon as it is cleared", async () => {
        await openSession();
        renderVault();
        expect(screen.getByText("Coffre ouvert")).toBeInTheDocument();

        act(() => clearSession());

        expect(screen.getByText("Connexion")).toBeInTheDocument();
    });

    it("locks the vault after 10 minutes of inactivity and says why", async () => {
        await openSession();
        vi.useFakeTimers();
        renderVault();

        act(() => { vi.advanceTimersByTime(11 * 60_000); });

        expect(screen.getByText("Connexion (inactivity)")).toBeInTheDocument();
    });
});
