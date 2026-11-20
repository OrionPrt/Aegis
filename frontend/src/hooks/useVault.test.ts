import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";
import { AuthError } from "../lib/auth-client";
import type { VaultEntry } from "../lib/crypto";
import type { VaultData, VaultFolder } from "../lib/vault-format";

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
// "chiffré" est simplement le JSON de son contenu.
vi.mock("../lib/crypto", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../lib/crypto")>();
    return {
        ...actual,
        encryptVault: async (data: VaultData) => ({ ciphertext: JSON.stringify(data), iv: "iv" }),
        decryptVault: async (payload: { ciphertext: string }) => JSON.parse(payload.ciphertext) as VaultData,
    };
});

const { useVault, VAULT_CONFLICT_MESSAGE, VaultConflictError } = await import("./useVault");

function entry(id: string): VaultEntry {
    return { id, label: id, createdAt: 0, updatedAt: 0 };
}

function folder(id: string): VaultFolder {
    return { id, name: id, createdAt: 0, updatedAt: 0 };
}

function vault(entries: VaultEntry[], folders: VaultFolder[] = []): VaultData {
    return { entries, folders };
}

function serverVault(entries: VaultEntry[], version: number, folders: VaultFolder[] = []) {
    return { vault: { ciphertext: JSON.stringify(vault(entries, folders)), iv: "iv" }, version };
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

        await act(() => result.current.saveVault(vault([entry("a"), entry("b")])));
        await act(() => result.current.saveVault(vault([entry("a")])));

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
            first = result.current.saveVault(vault([entry("a")]));
            second = result.current.saveVault(vault([entry("a"), entry("b")]));
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
            return gets === 1
                ? serverVault([entry("a")], 1)
                : serverVault([entry("a"), entry("from-other-device")], 2, [folder("from-other-device")]);
        });

        const { result } = renderHook(() => useVault());
        await waitFor(() => expect(result.current.status).toBe("ready"));

        await act(async () => {
            await expect(result.current.saveVault(vault([entry("a"), entry("local")]))).rejects.toThrow(VaultConflictError);
        });

        expect(result.current.entries.map((e) => e.id)).toEqual(["a", "from-other-device"]);
        expect(result.current.folders).toEqual([folder("from-other-device")]);
        expect(result.current.version).toBe(2);
        expect(result.current.status).toBe("ready");
        expect(result.current.error).toBe(VAULT_CONFLICT_MESSAGE);
    });

    it("loads the folders with the entries, and saves both in a single write", async () => {
        apiFetch.mockImplementation(async (_path: string, options?: RequestInit) => {
            if (options?.method !== "PUT") return serverVault([{ ...entry("a"), folderId: "f1" }], 0, [folder("f1")]);
            const { baseVersion } = JSON.parse(String(options.body));
            return { version: baseVersion + 1 };
        });

        const { result } = renderHook(() => useVault());
        await waitFor(() => expect(result.current.status).toBe("ready"));
        expect(result.current.folders).toEqual([folder("f1")]);
        expect(result.current.entries[0].folderId).toBe("f1");

        const next = vault([{ ...entry("a"), folderId: "f2" }], [folder("f1"), folder("f2")]);
        await act(() => result.current.saveVault(next));

        expect(putBodies()).toHaveLength(1);
        expect(JSON.parse(putBodies()[0].ciphertext)).toEqual(next);
        expect(result.current.folders).toEqual(next.folders);
        expect(result.current.entries).toEqual(next.entries);
    });
});
