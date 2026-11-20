import { describe, it, expect, vi, afterEach } from "vitest";
import {
    register, login, logout, clearSession, getSession, isAuthenticated, subscribeSession,
    apiFetch, changeMasterPassword, deleteAccount, AuthError,
} from "./auth-client.js";

function jsonResponse(body: unknown, status = 200): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
    } as Response;
}

const FAR_FUTURE = Date.now() + 900_000; // 15 min - loin de tout seuil de refresh proactif
const SALT = btoa("x".repeat(32));

describe("register / login / session state", () => {
    afterEach(() => {
        clearSession();
        vi.unstubAllGlobals();
    });

    it("register() stores an in-memory session", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ accessToken: "tok-1", expiresAt: FAR_FUTURE }, 201)));

        const session = await register("user@example.com", "MasterPassw0rd!");

        expect(session.tokens.accessToken).toBe("tok-1");
        expect(getSession()).toBe(session);
        expect(isAuthenticated()).toBe(true);
    });

    it("login() fetches the salt first, then verifies via authKeyHex derived from it", async () => {
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ saltBase64: SALT }))
            .mockResolvedValueOnce(jsonResponse({ accessToken: "tok-2", expiresAt: FAR_FUTURE }));
        vi.stubGlobal("fetch", fetchMock);

        const session = await login("user@example.com", "MasterPassw0rd!");

        expect(session.tokens.accessToken).toBe("tok-2");
        expect(fetchMock.mock.calls[0][0]).toContain("/auth/salt?email=");
        expect(fetchMock.mock.calls[1][0]).toContain("/auth/login");
    });

    it("clearSession() makes isAuthenticated() false and getSession() null", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ accessToken: "t", expiresAt: FAR_FUTURE }, 201)));
        await register("user@example.com", "MasterPassw0rd!");

        clearSession();

        expect(isAuthenticated()).toBe(false);
        expect(getSession()).toBeNull();
    });

    it("isAuthenticated() is false once the access token's expiresAt is in the past", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ accessToken: "t", expiresAt: Date.now() - 1000 }, 201)));
        await register("user@example.com", "MasterPassw0rd!");

        expect(isAuthenticated()).toBe(false);
    });

    it("logout() clears the session even when the network call fails", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ accessToken: "t", expiresAt: FAR_FUTURE }, 201)));
        await register("user@example.com", "MasterPassw0rd!");

        vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
        await expect(logout()).rejects.toThrow();

        expect(getSession()).toBeNull();
    });
});

describe("apiFetch", () => {
    afterEach(() => {
        clearSession();
        vi.unstubAllGlobals();
    });

    it("injects the Bearer token and only sets Content-Type when a body is present", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ accessToken: "tok", expiresAt: FAR_FUTURE }, 201)));
        await register("user@example.com", "MasterPassw0rd!");

        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
        vi.stubGlobal("fetch", fetchMock);

        await apiFetch("/auth/logout", { method: "POST" }); // pas de body
        const [, noBodyOptions] = fetchMock.mock.calls[0];
        expect(noBodyOptions.headers["Content-Type"]).toBeUndefined();
        expect(noBodyOptions.headers["Authorization"]).toBe("Bearer tok");

        await apiFetch("/vault", { method: "PUT", body: JSON.stringify({ a: 1 }) });
        const [, withBodyOptions] = fetchMock.mock.calls[1];
        expect(withBodyOptions.headers["Content-Type"]).toBe("application/json");
    });

    it("retries once after a reactive 401 by refreshing the access token", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ accessToken: "tok-old", expiresAt: FAR_FUTURE }, 201)));
        await register("user@example.com", "MasterPassw0rd!");

        const fetchMock = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ message: "expired" }, 401))          // 1er essai /vault
            .mockResolvedValueOnce(jsonResponse({ accessToken: "tok-new", expiresAt: FAR_FUTURE, email: "user@example.com" })) // /auth/refresh
            .mockResolvedValueOnce(jsonResponse({ vault: null }));                       // 2e essai /vault (réussi)
        vi.stubGlobal("fetch", fetchMock);

        const result = await apiFetch("/vault");

        expect(result).toEqual({ vault: null });
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(getSession()?.tokens.accessToken).toBe("tok-new");
    });

    it("refreshes proactively when the access token is about to expire (<60s left)", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ accessToken: "tok-old", expiresAt: FAR_FUTURE }, 201)));
        const session = await register("user@example.com", "MasterPassw0rd!");
        session.tokens.expiresAt = Date.now() + 1_000; // < 60s -> refresh proactif

        const fetchMock = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ accessToken: "tok-new", expiresAt: FAR_FUTURE, email: "user@example.com" }))
            .mockResolvedValueOnce(jsonResponse({ vault: null }));
        vi.stubGlobal("fetch", fetchMock);

        const result = await apiFetch("/vault");

        expect(result).toEqual({ vault: null });
        expect(fetchMock.mock.calls[0][0]).toContain("/auth/refresh");
    });

    it("REGRESSION: refuses to merge a refreshed token from a DIFFERENT account and clears the session instead", async () => {
        // Reproduit le bug corrigé cette session : un cookie aegis_rt partagé
        // par le navigateur peut appartenir à un autre compte que celui en
        // mémoire de cet onglet. Le serveur renvoie alors l'email de CET
        // AUTRE compte dans /auth/refresh - le client doit le détecter.
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ accessToken: "tok-old", expiresAt: FAR_FUTURE }, 201)));
        const session = await register("alice@example.com", "MasterPassw0rd!");
        session.tokens.expiresAt = Date.now() + 1_000;

        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
            jsonResponse({ accessToken: "tok-from-bob", expiresAt: FAR_FUTURE, email: "bob@example.com" })
        ));

        await expect(apiFetch("/vault")).rejects.toThrow(AuthError);
        expect(getSession()).toBeNull();
    });

    it("REGRESSION: refuses to adopt a token if the session was already cleared by a concurrent call", async () => {
        // Trouvé en écrivant le test E2E équivalent : deux apiFetch() concurrents
        // (ex: SessionsPage lance /sessions + /sessions/audit via Promise.all)
        // peuvent chacun déclencher leur propre refresh. Si le premier détecte
        // un mélange de comptes et vide _session, le second - dont la réponse
        // /auth/refresh arrive après coup - ne doit PAS silencieusement adopter
        // son token juste parce que la vérification d'email n'a plus de session
        // à comparer.
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ accessToken: "tok-old", expiresAt: FAR_FUTURE }, 201)));
        const session = await register("alice@example.com", "MasterPassw0rd!");
        session.tokens.expiresAt = Date.now() + 1_000; // déclenche le refresh proactif

        vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => {
            clearSession(); // simule l'autre appel concurrent qui a déjà nettoyé la session
            return jsonResponse({ accessToken: "tok-late", expiresAt: FAR_FUTURE, email: "alice@example.com" });
        }));

        await expect(apiFetch("/vault")).rejects.toThrow(AuthError);
        expect(getSession()).toBeNull();
    });
});

describe("changeMasterPassword / deleteAccount (dedicated fetch, no auto-retry)", () => {
    afterEach(() => {
        clearSession();
        vi.unstubAllGlobals();
    });

    it("changeMasterPassword throws AuthError on a wrong current password without retrying", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ accessToken: "tok", expiresAt: FAR_FUTURE }, 201)));
        await register("user@example.com", "MasterPassw0rd!");

        const fetchMock = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ saltBase64: SALT }))       // GET /auth/salt
            .mockResolvedValueOnce(jsonResponse({ message: "Mot de passe actuel incorrect." }, 401)); // POST /auth/change-password
        vi.stubGlobal("fetch", fetchMock);

        await expect(changeMasterPassword("WrongPassword!", "NewPassword!", [], 0)).rejects.toThrow(AuthError);
        // Exactement 2 appels réseau - jamais de retry automatique qui
        // compterait deux fois la même tentative échouée côté serveur.
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("changeMasterPassword sends the vault version the re-encrypted entries come from", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ accessToken: "tok", expiresAt: FAR_FUTURE }, 201)));
        await register("user@example.com", "MasterPassw0rd!");

        const fetchMock = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ saltBase64: SALT }))
            .mockResolvedValueOnce(jsonResponse({ message: "ok" }, 200));
        vi.stubGlobal("fetch", fetchMock);

        await changeMasterPassword("MasterPassw0rd!", "NewMasterPassw0rd!", [], 7);

        const body = JSON.parse(fetchMock.mock.calls[1][1].body);
        expect(body.baseVersion).toBe(7);
        expect(body.vault.iv).toBeTruthy();
    });

    it("deleteAccount re-derives the auth key from the freshly typed password, not the one in memory", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ accessToken: "tok", expiresAt: FAR_FUTURE }, 201)));
        await register("user@example.com", "MasterPassw0rd!");

        const fetchMock = vi.fn()
            .mockResolvedValueOnce(jsonResponse({ saltBase64: SALT }))
            .mockResolvedValueOnce(jsonResponse({ message: "Compte supprimé." }, 200));
        vi.stubGlobal("fetch", fetchMock);

        await deleteAccount("MasterPassw0rd!");

        const deleteCall = fetchMock.mock.calls[1];
        expect(deleteCall[0]).toContain("/vault");
        const body = JSON.parse(deleteCall[1].body);
        expect(body.authKeyHex).toMatch(/^[0-9a-f]{64}$/);
        expect(getSession()).toBeNull();
    });
});

describe("session subscription", () => {
    afterEach(() => {
        clearSession();
        vi.unstubAllGlobals();
    });

    it("notifies subscribers when a session starts and when it ends", async () => {
        const listener = vi.fn();
        const unsubscribe = subscribeSession(listener);
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ accessToken: "t", expiresAt: FAR_FUTURE }, 201)));

        await register("user@example.com", "MasterPassw0rd!");
        clearSession();
        unsubscribe();
        clearSession();

        expect(listener).toHaveBeenCalledTimes(2);
    });
});
