/**
 * ╔═══════════════════════════════════════════════════════╗
 * ║         AEGIS — Politique de confidentialité          ║
 * ║         src/pages/PrivacyPage.tsx                     ║
 * ╚═══════════════════════════════════════════════════════╝
 *
 * Premier jet - à faire relire par un professionnel avant publication.
 * Reflète ce que le code collecte et traite réellement, tel que vérifié
 * dans le backend (routes, schema.prisma, lib/email.ts) et le frontend
 * (lib/crypto.ts, lib/pwned.ts) à la date indiquée ci-dessous.
 */

import { Link } from "react-router-dom";
import { LegalLayout } from "./LegalLayout";

export default function PrivacyPage() {
    return (
        <LegalLayout title="Politique de confidentialité" updated="18 septembre 2026">
            <h2>Qui traite vos données</h2>
            <p>
                Aegis est édité par <strong>Aegis Protect Team</strong>,
                contactable à <strong>contact@aegis-protect.fr</strong>.
                Cette entité est responsable du traitement des données décrites
                ci-dessous.
            </p>

            <div className="legal-callout">
                <strong>Le principe de base d'Aegis : le chiffrement de bout en bout
                (zero-knowledge).</strong> Votre mot de passe maître n'est jamais
                envoyé à nos serveurs, sous aucune forme. Le contenu de votre
                coffre-fort (identifiants, mots de passe, notes, cartes) est chiffré
                sur votre appareil avant tout envoi, avec une clé dérivée de ce mot
                de passe maître et qui ne quitte jamais votre appareil. Nous ne
                pouvons techniquement pas lire le contenu de votre coffre-fort, même
                si nous le voulions, même sur demande judiciaire portant sur les
                données stockées.
            </div>

            <h2>Les données que nous collectons</h2>
            <p>Pour faire fonctionner le service, nous stockons :</p>
            <ul>
                <li><strong>Votre adresse email</strong>, comme identifiant de compte.</li>
                <li>
                    <strong>Une empreinte cryptographique de votre mot de passe
                    maître</strong> (jamais le mot de passe lui-même), utilisée pour
                    vérifier votre identité à la connexion sans jamais pouvoir la
                    reconstituer.
                </li>
                <li>
                    <strong>Le contenu chiffré de votre coffre-fort</strong>,
                    illisible sans votre mot de passe maître.
                </li>
                <li>
                    <strong>Des métadonnées de sécurité</strong> : adresse IP,
                    type d'appareil/navigateur, horodatages de connexion,
                    tentatives échouées - utilisées pour détecter les connexions
                    suspectes (nouvelle IP inhabituelle, tentatives de force brute)
                    et vous en informer par email.
                </li>
            </ul>

            <h2>Pourquoi nous les utilisons</h2>
            <ul>
                <li>Faire fonctionner votre compte et votre coffre-fort.</li>
                <li>
                    Sécuriser votre compte : verrouillage temporaire après plusieurs
                    échecs de connexion, alerte email en cas de nouvelle connexion
                    inhabituelle ou de changement de mot de passe.
                </li>
                <li>Répondre à nos obligations légales le cas échéant.</li>
            </ul>
            <p>
                Nous n'utilisons jamais vos données à des fins publicitaires et ne
                les vendons à personne.
            </p>

            <h2>Avec qui vos données sont partagées</h2>
            <p>
                Aegis fait appel aux prestataires techniques suivants, chacun
                n'ayant accès qu'à ce qui est strictement nécessaire à sa fonction :
            </p>
            <ul>
                <li><strong>Neon</strong> - hébergement de la base de données (contenu chiffré).</li>
                <li><strong>Vercel</strong> - hébergement de l'application.</li>
                <li><strong>Upstash</strong> - limitation du nombre de requêtes (protection anti-abus), ne conserve que des compteurs par adresse IP sur de courtes durées.</li>
                <li><strong>Resend</strong> - envoi des emails de sécurité (nouvelle connexion, changement de mot de passe, verrouillage de compte).</li>
                <li>
                    <strong>Have I Been Pwned</strong> - uniquement si vous activez
                    la vérification de fuites : seuls les 5 premiers caractères d'une
                    empreinte de votre mot de passe sont envoyés (méthode dite de
                    "k-anonymat"), jamais le mot de passe ni une empreinte complète
                    permettant de le retrouver.
                </li>
                <li>
                    <strong>GitHub</strong> - stockage de sauvegardes chiffrées de la
                    base de données (voir "Durée de conservation" ci-dessous).
                </li>
            </ul>
            <p>
                Aucun de ces prestataires n'a accès au contenu en clair de votre
                coffre-fort ni à votre mot de passe maître.
            </p>

            <h2>Durée de conservation</h2>
            <p>
                Vos données sont conservées tant que votre compte existe. Si vous
                supprimez votre compte depuis l'application, votre email, l'empreinte
                de votre mot de passe et le contenu chiffré de votre coffre-fort sont
                effacés immédiatement et définitivement de notre base de données
                active - cette action est irréversible.
            </p>
            <div className="legal-callout">
                <strong>Point d'attention sur les sauvegardes :</strong> à la date de
                rédaction de cette page, les sauvegardes chiffrées quotidiennes de la
                base de données sont conservées indéfiniment, sans purge automatique.
                Une copie chiffrée de vos données peut donc subsister dans ces
                sauvegardes après la suppression de votre compte, jusqu'à ce qu'une
                politique de rétention soit mise en place.
            </div>

            <h2>Vos droits</h2>
            <p>
                Selon votre lieu de résidence, vous disposez de droits sur vos
                données personnelles : accès, rectification, effacement, limitation,
                portabilité, opposition. Vous pouvez exercer la plupart de ces droits
                directement depuis l'application (modification de vos identifiants,
                export ou suppression du compte). Pour toute autre demande, contactez-nous
                via <strong>contact@aegis-protect.fr</strong>.
            </p>
            <p>
                Notez une limite propre au chiffrement de bout en bout : si vous
                oubliez votre mot de passe maître, nous ne pouvons ni le récupérer ni
                déchiffrer votre coffre-fort à votre place - cela fait partie du
                principe même de la protection zero-knowledge.
            </p>

            <h2>Sécurité</h2>
            <p>
                Dérivation de clé Argon2id, chiffrement AES-256-GCM, connexions
                chiffrées en HTTPS, mots de passe hachés (jamais stockés en clair),
                verrouillage de compte après plusieurs tentatives infructueuses,
                notifications email sur les événements sensibles.
            </p>

            <h2>Cookies</h2>
            <p>
                Voir notre <Link to="/cookies" replace>politique cookies</Link> dédiée - en
                résumé, un seul cookie strictement nécessaire à la connexion, aucun
                traceur publicitaire ou d'analytics.
            </p>

            <h2>Modifications de cette politique</h2>
            <p>
                Cette politique peut être mise à jour ; la date en haut de page
                indique la dernière révision. En cas de changement important, vous
                en serez informé.
            </p>

            <h2>Contact</h2>
            <p>
                Pour toute question relative à vos données :{" "}
                <strong>contact@aegis-protect.fr</strong>.
            </p>
        </LegalLayout>
    );
}
