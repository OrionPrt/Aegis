import { describe, it, expect, vi, afterEach } from "vitest";
import {
    register, login, logout, clearSession, getSession, isAuthenticated, subscribeSession,
    apiFetch, changeMasterPassword, deleteAccount, AuthError, verifyEmail, resendVerification,
} from "./auth-client.js";
import { CURRENT_KDF_VERSION } from "./crypto.js";

function jsonResponse(body: unknown, status = 200): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => body,
    } as Response;
}

const FAR_FUTURE = Date.now() + 900_000; // 15 min - loin de tout seuil de refresh proactif
const SALT = btoa("x".repeat(32));

/** Ouvre une session comme après une connexion réussie (l'inscription n'en ouvre plus). */
async function openSession(email = "user@example.com", accessToken = "tok") {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.includes("/auth/salt")
        ? jsonResponse({ saltBase64: SALT, kdfVersion: CURRENT_KDF_VERSION })
        : jsonResponse({ accessToken, expiresAt: FAR_FUTURE })));
    return login(email, "MasterPassw0rd!");
}

describe("register / login / session state", () => {
    afterEach(() => {
        clearSession();
        vi.unstubAllGlobals();
    });

    it("register() opens no session: the address must be confirmed first", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ message: "Email envoyé." }, 202)));

        const message = await register("user@example.com", "MasterPassw0rd!");

        expect(message).toBe("Email envoyé.");
        expect(getSession()).toBeNull();
        expect(isAuthenticated()).toBe(false);
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

    it("register() records the key derivation version it used", async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ message: "Email envoyé." }, 202));
        vi.stubGlobal("fetch", fetchMock);

        await register("user@example.com", "MasterPassw0rd!");

        expect(JSON.parse(fetchMock.mock.calls[0][1].body).kdfVersion).toBe(CURRENT_KDF_VERSION);
    });

    it("login() derives with the account's version from /salt and refuses one it does not know", async () => {
        const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ saltBase64: SALT, kdfVersion: 99 }));
        vi.stubGlobal("fetch", fetchMock);

        await expect(login("user@example.com", "MasterPassw0rd!")).rejects.toThrow(/version/i);
        // Aucune tentative de connexion avec des clés dérivées au hasard.
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("clearSession() makes isAuthenticated() false and getSession() null", async () => {
        await openSession("user@example.com", "t");

        clearSession();

        expect(isAuthenticated()).toBe(false);
        expect(getSession()).toBeNull();
    });

    it("isAuthenticated() is false once the access token's expiresAt is in the past", async () => {
        vi.stubGlobal("fetch", vi.fn(async (url: string) => url.includes("/auth/salt")
            ? jsonResponse({ saltBase64: SALT })
            : jsonResponse({ accessToken: "t", expiresAt: Date.now() - 1000 })));
        await login("user@example.com", "MasterPassw0rd!");

        expect(isAuthenticated()).toBe(false);
    });

    it("logout() clears the session even when the network call fails", async () => {
        await openSession("user@example.com", "t");

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
        await openSession("user@example.com", "tok");

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
        await openSession("user@example.com", "tok-old");

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
        const session = await openSession("user@example.com", "tok-old");
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
        const session = await openSession("alice@example.com", "tok-old");
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
        const session = await openSession("alice@example.com", "tok-old");
        session.tokens.expiresAt = Date.now() + 1_000; // déclenche le refresh proactif

        vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => {
            clearSession(); // simule l'autre appel concurrent qui a déjà nettoyé la session
            return jsonResponse({ accessToken: "tok-late", expiresAt: FAR_FUTURE, email: "alice@example.com" });
        }));

        await expect(apiFetch("/vault")).rejects.toThrow(AuthError);
        expect(getSession()).toBeNull();
    });
});

describe("access token refresh", () => {
    afterEach(() => {
        clearSession();
        vi.unstubAllGlobals();
    });

    /** Répond 401 aux `rejectedApiCalls` premiers appels d'API, puis 200. */
    function routedFetch(refreshResponses: Response[], rejectedApiCalls: number) {
        const refreshCalls: unknown[] = [];
        let apiCalls = 0;
        const fetchMock = vi.fn(async (url: string) => {
            if (url.endsWith("/auth/refresh")) {
                refreshCalls.push(url);
                return refreshResponses.shift() ?? jsonResponse({ message: "no more" }, 401);
            }
            apiCalls += 1;
            return apiCalls <= rejectedApiCalls ? jsonResponse({ message: "expired" }, 401) : jsonResponse({ ok: true });
        });
        return { fetchMock, refreshCalls };
    }

    it("shares one refresh between parallel requests that hit a 401", async () => {
        await openSession("user@example.com", "tok-1");
        const { fetchMock, refreshCalls } = routedFetch([
            jsonResponse({ accessToken: "tok-2", expiresAt: FAR_FUTURE, email: "user@example.com" }),
        ], 2);
        vi.stubGlobal("fetch", fetchMock);

        await Promise.all([apiFetch("/sessions"), apiFetch("/sessions/audit")]);

        expect(refreshCalls).toHaveLength(1);
        expect(getSession()?.tokens.accessToken).toBe("tok-2");
    });

    it("retries once when another tab rotated the session at the same moment", async () => {
        await openSession("user@example.com", "tok-1");
        const { fetchMock, refreshCalls } = routedFetch([
            jsonResponse({ message: "Session invalide." }, 401),
            jsonResponse({ accessToken: "tok-3", expiresAt: FAR_FUTURE, email: "user@example.com" }),
        ], 1);
        vi.stubGlobal("fetch", fetchMock);

        await apiFetch("/vault");

        expect(refreshCalls).toHaveLength(2);
        expect(getSession()?.tokens.accessToken).toBe("tok-3");
    });
});

describe("changeMasterPassword / deleteAccount (dedicated fetch, no auto-retry)", () => {
    afterEach(() => {
        clearSession();
        vi.unstubAllGlobals();
    });

    it("changeMasterPassword throws AuthError on a wrong current password without retrying", async () => {
        await openSession("user@example.com", "tok");

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
        await openSession("user@example.com", "tok");

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
        await openSession("user@example.com", "tok");

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
        await openSession("user@example.com", "t");
        clearSession();
        unsubscribe();
        clearSession();

        expect(listener).toHaveBeenCalledTimes(2);
    });
});

describe("email confirmation", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("verifyEmail() sends the token from the link and returns the server's message", async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ message: "Adresse confirmée." }));
        vi.stubGlobal("fetch", fetchMock);

        await expect(verifyEmail("tok_123")).resolves.toBe("Adresse confirmée.");
        expect(fetchMock.mock.calls[0][0]).toContain("/auth/verify-email");
        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ token: "tok_123" });
    });

    it("resendVerification() asks for a new link for the normalized address", async () => {
        const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ message: "Envoyé." }, 202));
        vi.stubGlobal("fetch", fetchMock);

        await resendVerification("  User@Example.com ");

        expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ email: "user@example.com" });
    });

    it("exposes the server's error code, so the login screen can offer to resend the link", async () => {
        vi.stubGlobal("fetch", vi.fn(async (url: string) => url.includes("/auth/salt")
            ? jsonResponse({ saltBase64: SALT })
            : jsonResponse({ message: "Confirmez d'abord votre adresse email.", code: "EMAIL_NOT_VERIFIED" }, 403)));

        const error = await login("user@example.com", "MasterPassw0rd!").catch((e: unknown) => e);

        expect(error).toBeInstanceOf(AuthError);
        expect((error as AuthError).code).toBe("EMAIL_NOT_VERIFIED");
        expect(getSession()).toBeNull();
    });
});
