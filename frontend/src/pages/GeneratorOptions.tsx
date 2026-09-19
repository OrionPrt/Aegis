/**
 * Options du générateur de mot de passe (longueur + jeux de caractères).
 * Partagé entre le générateur autonome et le champ mot de passe du modal
 * d'ajout, pour que les deux se comportent exactement pareil.
 */

import type { GeneratorSettings } from "../lib/crypto";

interface GeneratorOptionsProps {
    value:    GeneratorSettings;
    onChange: (next: GeneratorSettings) => void;
}

type CharsetKey = "uppercase" | "lowercase" | "numbers" | "symbols";

const CHARSETS: { key: CharsetKey; label: string }[] = [
    { key: "uppercase", label: "Majuscules (A-Z)" },
    { key: "lowercase", label: "Minuscules (a-z)" },
    { key: "numbers",   label: "Chiffres (0-9)" },
    { key: "symbols",   label: "Symboles (!@#$…)" },
];

export default function GeneratorOptions({ value, onChange }: GeneratorOptionsProps) {
    const activeCharsets = CHARSETS.filter(({ key }) => value[key]).length;

    function toggleCharset(key: CharsetKey) {
        // Au moins un jeu de caractères doit rester actif.
        if (value[key] && activeCharsets <= 1) return;
        onChange({ ...value, [key]: !value[key] });
    }

    return (
        <>
            <div className="form-row">
                <label>Longueur - {value.length} caractères</label>
                <input
                    type="range"
                    min={8}
                    max={64}
                    value={value.length}
                    className="generator-range"
                    onChange={(e) => onChange({ ...value, length: Number(e.target.value) })}
                />
            </div>

            <div className="generator-options">
                {CHARSETS.map(({ key, label }) => (
                    <label key={key} className="generator-toggle">
                        <input
                            type="checkbox"
                            checked={value[key]}
                            onChange={() => toggleCharset(key)}
                        />
                        {label}
                    </label>
                ))}
                <label className="generator-toggle">
                    <input
                        type="checkbox"
                        checked={value.excludeAmbiguous}
                        onChange={() => onChange({ ...value, excludeAmbiguous: !value.excludeAmbiguous })}
                    />
                    Exclure les caractères ambigus (0, O, l, 1, I)
                </label>
            </div>
        </>
    );
}
