/**
 * Empreinte d'une adresse email par un secret serveur : stable pour une
 * adresse, impossible à recalculer sans le secret. Sert à indexer des données
 * liées à une adresse qui n'a pas forcément de compte (verrouillage), sans
 * stocker l'adresse elle-même.
 *
 * Secret lu à chaque appel : ce module est importé avant que app.ts n'appelle
 * dotenv.config().
 */
import crypto from "node:crypto";

export function emailHmac(purpose: string, email: string): Buffer {
    const secret = process.env.AEGIS_DUMMY_SALT || process.env.JWT_SECRET;
    if (!secret) throw new Error("AEGIS_DUMMY_SALT ou JWT_SECRET requis.");
    return crypto.createHmac("sha256", secret).update(`${purpose}:${email}`).digest();
}
