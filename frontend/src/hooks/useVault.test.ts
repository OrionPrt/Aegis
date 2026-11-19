import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { AuthError } from "../lib/auth-client";
import type { VaultEntry } from "../lib/crypto";

const apiFetch = vi.fn();

vi.mock("../lib/auth-client", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../lib/auth-client")>();
    return {
        ...actual,
        apiFetch: (...args: unknown[]) => apiFetch(...args),
        getSession: () => ({ email: "user@example.com", keys: { masterKey: {} as CryptoKey, authKeyHex: "" }, tokens: { accessToken: "t", expiresAt: Date.now() + 900_000 } }),
    };
});

// Le chiffrement réel est couvert par crypto.test.ts : ici le coffre
// "chiffré" est simplement le JSON des entrées.
vi.mock("../lib/crypto", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../lib/crypto")>();
    return {
        ...actual,
        encryptVault: async (entries: VaultEntry[]) => ({ ciphertext: JSON.stringify(entries), iv: "iv" }),
        decryptVault: async (payload: { ciphertext: string }) => JSON.parse(payload.ciphertext) as VaultEntry[],
    };
});

const { useVault, VAULT_CONFLICT_MESSAGE, VaultConflictError } = await import("./useVault");

function entry(id: string): VaultEntry {
    return { id, label: id, createdAt: 0, updatedAt: 0 };
}

function serverVault(entries: VaultEntry[], version: number) {
    return { vault: { ciphertext: JSON.stringify(entries), iv: "iv" }, version };
}

function putBodies(): { baseVersion: number; ciphertext: string }[] {
    return apiFetch.mock.calls
        .filter(([, options]) => options?.method === "PUT")
        .map(([, options]) => JSON.parse(options.body));
}

describe("useVault", () => {
    beforeEach(() => {
        apiFetch.mockReset();
    });

    it("sends the version it loaded, then the one returned by each save", async () => {
        apiFetch.mockImplementation(async (_path: string, options?: RequestInit) => {
            if (options?.method !== "PUT") return serverVault([entry("a")], 3);
            const { baseVersion } = JSON.parse(String(options.body));
            return { version: baseVersion + 1 };
        });

        const { result } = renderHook(() => useVault());
        await waitFor(() => expect(result.current.status).toBe("ready"));
        expect(result.current.version).toBe(3);

        await act(() => result.current.saveVault([entry("a"), entry("b")]));
        await act(() => result.current.saveVault([entry("a")]));

        expect(putBodies().map((b) => b.baseVersion)).toEqual([3, 4]);
        expect(result.current.version).toBe(5);
    });

    it("runs overlapping saves one after the other, each from the previous version", async () => {
        let releaseFirst!: () => void;
        apiFetch.mockImplementation(async (_path: string, options?: RequestInit) => {
            if (options?.method !== "PUT") return serverVault([], 0);
            const { baseVersion } = JSON.parse(String(options.body));
            if (baseVersion === 0) await new Promise<void>((resolve) => { releaseFirst = resolve; });
            return { version: baseVersion + 1 };
        });

        const { result } = renderHook(() => useVault());
        await waitFor(() => expect(result.current.status).toBe("ready"));

        let first!: Promise<void>;
        let second!: Promise<void>;
        act(() => {
            first = result.current.saveVault([entry("a")]);
            second = result.current.saveVault([entry("a"), entry("b")]);
        });
        await waitFor(() => expect(putBodies()).toHaveLength(1));
        releaseFirst();
        await act(() => Promise.all([first, second]).then(() => undefined));

        expect(putBodies().map((b) => b.baseVersion)).toEqual([0, 1]);
        expect(result.current.entries.map((e) => e.id)).toEqual(["a", "b"]);
    });

    it("reloads the newer vault on a 409 instead of overwriting it, and says why", async () => {
        let gets = 0;
        apiFetch.mockImplementation(async (_path: string, options?: RequestInit) => {
            if (options?.method === "PUT") throw new AuthError("conflict", 409);
            gets += 1;
            return gets === 1 ? serverVault([entry("a")], 1) : serverVault([entry("a"), entry("from-other-device")], 2);
        });

        const { result } = renderHook(() => useVault());
        await waitFor(() => expect(result.current.status).toBe("ready"));

        await act(async () => {
            await expect(result.current.saveVault([entry("a"), entry("local")])).rejects.toThrow(VaultConflictError);
        });

        expect(result.current.entries.map((e) => e.id)).toEqual(["a", "from-other-device"]);
        expect(result.current.version).toBe(2);
        expect(result.current.status).toBe("ready");
        expect(result.current.error).toBe(VAULT_CONFLICT_MESSAGE);
    });
});
