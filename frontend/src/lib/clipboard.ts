/**
 * Copie d'un secret (mot de passe, code 2FA, numéro de carte…) avec
 * effacement automatique du presse-papiers.
 *
 * Un seul minuteur pour toute l'application : chaque copie le relance, pour
 * que l'effacement prévu pour une copie précédente n'efface pas la suivante.
 * Si le navigateur nous laisse lire le presse-papiers sans rien demander
 * (permission déjà accordée), l'effacement n'a lieu que s'il contient encore
 * notre valeur ; sinon il est effacé à l'aveugle - le navigateur ne permet
 * pas de vérifier sans afficher une demande d'autorisation.
 */

export const CLIPBOARD_CLEAR_MS = 30_000;

let clearTimer: ReturnType<typeof setTimeout> | null = null;
let copiedValue: string | null = null;

async function canReadSilently(): Promise<boolean> {
    try {
        const status = await navigator.permissions.query({ name: "clipboard-read" as PermissionName });
        return status.state === "granted";
    } catch {
        return false; // Firefox, Safari : permission non interrogeable
    }
}

async function clearIfStillOurs(): Promise<void> {
    const expected = copiedValue;
    clearTimer = null;
    copiedValue = null;
    try {
        if (await canReadSilently() && (await navigator.clipboard.readText()) !== expected) return;
        await navigator.clipboard.writeText("");
    } catch {
        // Page sans le focus au moment de l'effacement : le navigateur refuse
        // d'écrire, et il n'y a rien d'autre à faire.
    }
}

/** Copie `value` ; lève une erreur si le navigateur refuse l'accès au presse-papiers. */
export async function copySecret(value: string): Promise<void> {
    await navigator.clipboard.writeText(value);
    copiedValue = value;
    if (clearTimer) clearTimeout(clearTimer);
    clearTimer = setTimeout(() => { void clearIfStillOurs(); }, CLIPBOARD_CLEAR_MS);
}

export const COPY_FAILED_MESSAGE =
    "Copie impossible : autorisez l'accès au presse-papiers pour ce site, ou copiez la valeur à la main.";
