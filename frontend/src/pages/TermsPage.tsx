/**
 * ╔═══════════════════════════════════════════════════════╗
 * ║         AEGIS — Conditions d'utilisation              ║
 * ║         src/pages/TermsPage.tsx                       ║
 * ╚═══════════════════════════════════════════════════════╝
 *
 * Premier jet - à faire relire par un professionnel avant publication.
 */

import { Link } from "react-router-dom";
import { LegalLayout } from "./LegalLayout";

export default function TermsPage() {
    return (
        <LegalLayout title="Conditions d'utilisation" updated="18 septembre 2026">
            <h2>1. Objet</h2>
            <p>
                Aegis est un gestionnaire de mots de passe fonctionnant selon un
                principe de chiffrement de bout en bout ("zero-knowledge") : le
                contenu de votre coffre-fort est chiffré et déchiffré uniquement sur
                votre appareil, à l'aide d'un mot de passe maître que nous ne
                recevons jamais. En créant un compte, vous acceptez les présentes
                conditions.
            </p>

            <h2>2. Le mot de passe maître : votre seule clé, votre seule responsabilité</h2>
            <div className="legal-callout">
                <strong>Ce point est essentiel :</strong> votre mot de passe maître
                est la seule clé de votre coffre-fort. Nous ne le connaissons pas,
                ne pouvons pas le récupérer, et ne pouvons pas déchiffrer vos données
                à votre place. Si vous l'oubliez ou le perdez, l'accès à votre
                coffre-fort est <strong>définitivement et irrémédiablement perdu</strong>.
                Aucune procédure de "mot de passe oublié" n'existe et ne peut exister
                dans ce modèle de sécurité.
            </div>
            <p>
                Vous êtes seul responsable de la confidentialité et de la mémorisation
                de votre mot de passe maître.
            </p>

            <h2>3. Création et utilisation du compte</h2>
            <ul>
                <li>Vous devez fournir une adresse email valide et vous en assurer l'accès (utilisée pour les notifications de sécurité).</li>
                <li>Vous devez utiliser un mot de passe maître suffisamment robuste (l'application vous guide sur ce point à l'inscription).</li>
                <li>Vous êtes responsable de toute activité effectuée depuis votre compte.</li>
                <li>Un seul compte par personne, à usage personnel.</li>
            </ul>

            <h2>4. Sécurité de votre compte</h2>
            <p>
                Le service verrouille temporairement l'accès après plusieurs
                tentatives de connexion infructueuses et vous notifie par email en
                cas de changement de mot de passe, de suppression de compte, ou de
                connexion depuis une adresse IP inhabituelle. Ces mesures visent à
                détecter une utilisation non autorisée de votre compte - signalez-nous
                immédiatement toute activité suspecte à <strong>contact@aegis-protect.fr</strong>.
            </p>

            <h2>5. Ce que vous ne devez pas faire</h2>
            <ul>
                <li>Tenter d'accéder au compte d'un tiers sans autorisation.</li>
                <li>Perturber le fonctionnement du service (surcharge intentionnelle, contournement des limites de requêtes, etc.).</li>
                <li>Utiliser le service à des fins illégales.</li>
                <li>Tenter de contourner ou d'affaiblir les mécanismes de chiffrement du service.</li>
            </ul>

            <h2>6. Disponibilité et limitation de responsabilité</h2>
            <p>
                Le service est fourni "en l'état", sans garantie de disponibilité
                continue ni d'absence totale d'erreur. Dans la mesure permise par la
                loi applicable, notre responsabilité ne saurait être engagée pour :
            </p>
            <ul>
                <li>La perte d'accès à votre coffre-fort suite à l'oubli de votre mot de passe maître (voir section 2).</li>
                <li>Les interruptions de service dues à des prestataires tiers (hébergement, base de données, etc.).</li>
                <li>Une utilisation du service non conforme aux présentes conditions.</li>
            </ul>
            <p>
                Rien dans cette section n'exclut une responsabilité qui ne peut être
                légalement exclue.
            </p>

            <h2>7. Suppression du compte</h2>
            <p>
                Vous pouvez supprimer votre compte à tout moment depuis
                l'application, après confirmation de votre mot de passe maître.
                Cette action est <strong>définitive et irréversible</strong> : le
                contenu de votre coffre-fort est effacé de notre base de données
                active immédiatement (voir notre{" "}
                <Link to="/privacy" replace>politique de confidentialité</Link> pour le détail
                concernant les sauvegardes).
            </p>

            <h2>8. Modifications du service et des conditions</h2>
            <p>
                Nous pouvons faire évoluer le service et les présentes conditions.
                En cas de changement substantiel, vous en serez informé. La poursuite
                de l'utilisation du service après notification vaut acceptation des
                nouvelles conditions.
            </p>

            <h2>9. Contact</h2>
            <p>
                Pour toute question relative à ces conditions :{" "}
                <strong>contact@aegis-protect.fr</strong>.
            </p>
        </LegalLayout>
    );
}
