/**
 * ╔═══════════════════════════════════════════════════════╗
 * ║       AEGIS — Vérification de fuites (k-anonymat)      ║
 * ║              src/lib/pwned.ts                          ║
 * ╚═══════════════════════════════════════════════════════╝
 *
 * Interroge l'API publique "Pwned Passwords" de Have I Been Pwned
 * pour savoir si un mot de passe est apparu dans une fuite connue.
 *
 * Le mot de passe ne quitte JAMAIS l'appareil : on calcule son hash
 * SHA-1 localement et on n'envoie que les 5 premiers caractères de ce
 * hash (modèle k-anonymat). L'API renvoie tous les suffixes possibles
 * pour ce préfixe ; la correspondance se fait ensuite en local.
 */

const HIBP_RANGE_URL = "https://api.pwnedpasswords.com/range/";

async function sha1Hex(text: string): Promise<string> {
    const data = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest("SHA-1", data);
    return [...new Uint8Array(digest)]
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")
        .toUpperCase();
}

/**
 * Retourne le nombre de fois où le mot de passe apparaît dans des fuites
 * connues (0 = non trouvé). Lève une erreur si la requête échoue - à
 * l'appelant de gérer le cas hors-ligne / API indisponible.
 */
export async function checkPasswordPwned(password: string): Promise<number> {
    const hash = await sha1Hex(password);
    const prefix = hash.slice(0, 5);
    const suffix = hash.slice(5);

    const res = await fetch(`${HIBP_RANGE_URL}${prefix}`);
    if (!res.ok) throw new Error(`HIBP API error: ${res.status}`);

    const body = await res.text();
    for (const line of body.split("\n")) {
        const [lineSuffix, count] = line.trim().split(":");
        if (lineSuffix === suffix) return Number(count);
    }
    return 0;
}
