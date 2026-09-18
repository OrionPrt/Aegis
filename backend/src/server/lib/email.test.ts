import { describe, it, expect, vi, beforeAll } from "vitest";
import type { EmailEventContext } from "./email.js";

const sendMock = vi.fn().mockResolvedValue({ data: { id: "test" }, error: null });

vi.mock("resend", () => ({
    Resend: vi.fn().mockImplementation(() => ({ emails: { send: sendMock } })),
}));

let sendPasswordChangedEmail: typeof import("./email.js").sendPasswordChangedEmail;
let sendAccountLockedEmail: typeof import("./email.js").sendAccountLockedEmail;
let sendNewIpLoginEmail: typeof import("./email.js").sendNewIpLoginEmail;

beforeAll(async () => {
    // email.ts lit RESEND_API_KEY au chargement du module pour décider de
    // construire un vrai client Resend - on le définit avant l'import
    // dynamique pour que le mock ci-dessus soit réellement exercé.
    process.env.RESEND_API_KEY = "test-key-for-mocking";
    const mod = await import("./email.js");
    sendPasswordChangedEmail = mod.sendPasswordChangedEmail;
    sendAccountLockedEmail = mod.sendAccountLockedEmail;
    sendNewIpLoginEmail = mod.sendNewIpLoginEmail;
});

const ctx: EmailEventContext = { ipAddress: "203.0.113.5", userAgent: "Mozilla/5.0 (Test)" };

describe("email notifications", () => {
    it("sends the password-changed email to the right recipient with the right subject", async () => {
        sendMock.mockClear();
        await sendPasswordChangedEmail("user@example.com", ctx);
        expect(sendMock).toHaveBeenCalledWith(
            expect.objectContaining({
                to: "user@example.com",
                subject: expect.stringContaining("mot de passe maître"),
            })
        );
    });

    it("escapes HTML-unsafe characters from the request context (XSS prevention)", async () => {
        sendMock.mockClear();
        const maliciousCtx: EmailEventContext = {
            ipAddress: "1.2.3.4",
            userAgent: `<script>alert(1)</script>&"'`,
        };
        await sendNewIpLoginEmail("user@example.com", maliciousCtx);
        const html = sendMock.mock.calls[0][0].html as string;
        expect(html).not.toContain("<script>");
        expect(html).toContain("&lt;script&gt;");
        expect(html).toContain("&amp;");
    });

    it("includes the lockout duration in the account-locked email", async () => {
        sendMock.mockClear();
        await sendAccountLockedEmail("user@example.com", ctx);
        const call = sendMock.mock.calls[0][0];
        expect(call.subject).toContain("bloqué");
        expect(call.html).toContain("15 minutes");
    });

    it("never throws even if the Resend API call rejects", async () => {
        sendMock.mockRejectedValueOnce(new Error("network down"));
        await expect(sendPasswordChangedEmail("user@example.com", ctx)).resolves.toBeUndefined();
    });
});
