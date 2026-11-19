import { useEffect, useState } from "react";
import { Check, Copy } from "lucide-react";
import { generateTotpCode, totpTimeRemaining } from "../../lib/totp";
import Field from "./Field";
import type { CopyToClipboard, VaultEntryExtended } from "./types";

interface TotpFieldProps {
    entry: VaultEntryExtended;
    copied: string | null;
    copyToClipboard: CopyToClipboard;
}

export default function TotpField({ entry, copied, copyToClipboard }: TotpFieldProps) {
    const [code, setCode] = useState("------");
    const [remaining, setRemaining] = useState(0);

    const period = entry.totpPeriod ?? 30;

    useEffect(() => {
        let cancelled = false;
        const config = {
            secret:    entry.totpSecret!,
            algorithm: entry.totpAlgorithm ?? "SHA-1" as const,
            digits:    entry.totpDigits ?? 6,
            period,
        };

        async function tick() {
            try {
                const c = await generateTotpCode(config);
                if (!cancelled) setCode(c);
            } catch {
                if (!cancelled) setCode("------");
            }
            if (!cancelled) setRemaining(totpTimeRemaining(config));
        }

        tick();
        const interval = setInterval(tick, 1000);
        return () => { cancelled = true; clearInterval(interval); };
    }, [entry.totpSecret, entry.totpAlgorithm, entry.totpDigits, period]);

    return (
        <Field label="Code d'authentification (2FA)">
            <div className="field-value-row">
                <span className="field-mono totp-code">
                    {code.match(/.{1,3}/g)?.join(" ") ?? code}
                </span>
                <div className="icon-btn-group">
                    <button
                        className={`icon-btn ${copied === "totp" ? "copied" : ""}`}
                        onClick={() => copyToClipboard(code, "totp")}
                        title="Copier"
                        aria-label={copied === "totp" ? "Code copié" : "Copier le code"}
                    >
                        {copied === "totp" ? <Check size={14} strokeWidth={2.25} /> : <Copy size={14} strokeWidth={2} />}
                    </button>
                </div>
            </div>
            <div className="totp-countdown">
                <div className="totp-countdown-bar" style={{ width: `${(remaining / period) * 100}%` }} />
            </div>
        </Field>
    );
}
