/**
 * Estimation de la robustesse du mot de passe maître avec zxcvbn-ts :
 * dictionnaires (mots de passe courants, français), motifs clavier
 * (azerty, qwerty), dates, répétitions et substitutions « l33t ».
 *
 * Réservée au mot de passe maître : il protège tout le coffre, et un
 * attaquant qui obtient une copie de la base peut l'attaquer hors ligne.
 * Les dictionnaires pèsent plusieurs centaines de Ko : ils ne sont chargés
 * qu'au premier appel, sur l'écran où l'on choisit ce mot de passe.
 */
import type { ZxcvbnFactory } from "@zxcvbn-ts/core";

export const MIN_MASTER_PASSWORD_LENGTH = 12;

/**
 * Score zxcvbn minimal (0 à 4). Avec zxcvbn-ts 4, le score 4 correspond à au
 * moins 10^10 essais : une protection correcte face à une attaque hors ligne
 * sur un hachage lent (Argon2id ici). Le score 3 ne garantit que 10^8 essais
 * (« Azerty123456! » l'obtient).
 */
export const MIN_MASTER_PASSWORD_SCORE = 4;

export interface MasterPasswordAssessment {
    score: 0 | 1 | 2 | 3 | 4;
    /** log10 du nombre d'essais estimé pour le trouver. */
    guessesLog10: number;
    acceptable: boolean;
    warning: string | null;
    suggestions: string[];
}

let factory: Promise<ZxcvbnFactory> | null = null;

function loadFactory(): Promise<ZxcvbnFactory> {
    factory ??= Promise.all([
        import("@zxcvbn-ts/core"),
        import("@zxcvbn-ts/language-common"),
        import("@zxcvbn-ts/language-fr"),
    ]).then(([core, common, fr]) => new core.ZxcvbnFactory({
        translations: fr.translations,
        graphs:       common.adjacencyGraphs,
        dictionary:   { ...common.dictionary, ...fr.dictionary },
    }));
    return factory;
}

/**
 * Évalue un mot de passe maître. `userInputs` : mots propres à l'utilisateur
 * (son email…) qu'un attaquant essaierait en premier.
 */
export async function assessMasterPassword(
    password: string,
    userInputs: string[] = [],
): Promise<MasterPasswordAssessment> {
    const zxcvbn = await loadFactory();
    // L'adresse entière et sa partie avant @ (« jean.dupont »). Pas ses
    // fragments : des mots courts comme « jean » pénaliseraient trop de
    // phrases de passe légitimes.
    const inputs = userInputs.flatMap((input) => [input, input.split("@")[0]]).filter(Boolean);
    const result = zxcvbn.check(password, ["aegis", ...inputs]);

    return {
        score:        result.score,
        guessesLog10: result.guessesLog10,
        acceptable:   password.length >= MIN_MASTER_PASSWORD_LENGTH && result.score >= MIN_MASTER_PASSWORD_SCORE,
        warning:      result.feedback.warning,
        suggestions:  result.feedback.suggestions,
    };
}

/** Message d'erreur à afficher pour un mot de passe maître refusé. */
export function rejectionMessage(assessment: MasterPasswordAssessment, password: string): string {
    if (password.length < MIN_MASTER_PASSWORD_LENGTH) {
        return `Le mot de passe maître doit faire au moins ${MIN_MASTER_PASSWORD_LENGTH} caractères.`;
    }
    const hint = assessment.warning ?? assessment.suggestions[0];
    return hint
        ? `Mot de passe trop prévisible : ${hint}`
        : "Mot de passe trop prévisible. Préférez une phrase de plusieurs mots sans lien entre eux.";
}

/** Équivalent en bits du nombre d'essais estimé, pour la jauge. */
export function guessesToBits(guessesLog10: number): number {
    return Math.round(guessesLog10 * Math.log2(10));
}
