import { describe, it, expect, vi, afterEach } from "vitest";
import { checkPasswordPwned } from "./pwned.js";

// SHA-1("password") = 5BAA61E4C9B93F3F0682250B6CF8331B7EE68FD8
// -> préfixe envoyé à l'API : "5BAA6", suffixe recherché localement : le reste.
const PASSWORD = "password";
const SHA1_SUFFIX = "1E4C9B93F3F0682250B6CF8331B7EE68FD8";

describe("checkPasswordPwned", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("only sends the 5-char SHA-1 prefix to the HIBP API, never the password", async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => "" });
        vi.stubGlobal("fetch", fetchMock);

        await checkPasswordPwned(PASSWORD);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const calledUrl = fetchMock.mock.calls[0][0] as string;
        // La comparaison exacte prouve à elle seule que seul le préfixe de 5
        // caractères a été envoyé - le mot de passe complet ni son hash entier
        // n'apparaissent nulle part dans l'URL.
        expect(calledUrl).toBe("https://api.pwnedpasswords.com/range/5BAA6");
    });

    it("asks for padded responses so their size does not reveal the queried prefix", async () => {
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: async () => "" });
        vi.stubGlobal("fetch", fetchMock);

        await checkPasswordPwned(PASSWORD);

        const options = fetchMock.mock.calls[0][1] as RequestInit;
        expect(new Headers(options.headers).get("Add-Padding")).toBe("true");
    });

    it("treats a padding line (count 0) as not found", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => `${SHA1_SUFFIX}:0\r\nAAAA:1` }));
        expect(await checkPasswordPwned(PASSWORD)).toBe(0);
    });

    it("returns the leak count when the suffix matches a returned line", async () => {
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            text: async () => `AAAA:1\r\n${SHA1_SUFFIX}:9545824\r\nBBBB:2`,
        });
        vi.stubGlobal("fetch", fetchMock);

        expect(await checkPasswordPwned(PASSWORD)).toBe(9545824);
    });

    it("returns 0 when no line matches the suffix", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, text: async () => "AAAA:1\r\nBBBB:2" }));
        expect(await checkPasswordPwned(PASSWORD)).toBe(0);
    });

    it("throws when the HIBP API responds with an error status", async () => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503, text: async () => "" }));
        await expect(checkPasswordPwned(PASSWORD)).rejects.toThrow(/503/);
    });
});
