import { useEffect, useState } from "react";
import { assessMasterPassword } from "../lib/password-strength";
import type { MasterPasswordAssessment } from "../lib/password-strength";

/** Délai après la dernière frappe avant d'évaluer : zxcvbn coûte quelques ms par appel. */
const ASSESS_DELAY_MS = 150;

/**
 * Évaluation zxcvbn du mot de passe maître en cours de saisie, pour la jauge.
 * null tant que le mot de passe est vide ou que son évaluation n'est pas prête.
 */
export function useMasterPasswordStrength(password: string, userInputs: string[]): MasterPasswordAssessment | null {
    const [latest, setLatest] = useState<{ password: string; assessment: MasterPasswordAssessment } | null>(null);
    const inputsKey = userInputs.join("\n");

    useEffect(() => {
        if (!password) return;
        let cancelled = false;
        const timer = setTimeout(() => {
            assessMasterPassword(password, inputsKey.split("\n"))
                .then((assessment) => { if (!cancelled) setLatest({ password, assessment }); })
                // Jauge seulement : la soumission réévalue et bloque elle-même.
                .catch(() => undefined);
        }, ASSESS_DELAY_MS);
        return () => { cancelled = true; clearTimeout(timer); };
    }, [password, inputsKey]);

    return latest && latest.password === password ? latest.assessment : null;
}
