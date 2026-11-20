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
        <LegalLayout title="Politique de confidentialité" updated="20 novembre 2026">
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
                <li>
                    <strong>Votre adresse email</strong>, comme identifiant de compte.
                    Elle est confirmée à l'inscription par un lien envoyé à cette
                    adresse : sans cette confirmation, le compte reste inactif.
                </li>
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
                    et vous en informer par email. Elles sont enregistrées pour
                    chaque appareil connecté et dans l'historique d'activité de
                    votre compte, que vous pouvez consulter dans la page Sécurité.
                </li>
            </ul>

            <h2>Pourquoi nous les utilisons</h2>
            <ul>
                <li>
                    Faire fonctionner votre compte et votre coffre-fort - base
                    légale : l'exécution des conditions d'utilisation que vous
                    acceptez en créant un compte.
                </li>
                <li>
                    Sécuriser votre compte : verrouillage temporaire après plusieurs
                    échecs de connexion, alerte email en cas de nouvelle connexion
                    inhabituelle, de verrouillage ou de changement de mot de passe -
                    base légale : notre intérêt légitime à protéger les comptes
                    contre les accès non autorisés.
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
                <li>
                    <strong>Vercel</strong> - hébergement de l'application. Ses
                    journaux techniques enregistrent l'adresse IP et la page demandée
                    pour chaque requête (jamais votre adresse email).
                </li>
                <li><strong>Upstash</strong> - limitation du nombre de requêtes (protection anti-abus), ne conserve que des compteurs par adresse IP sur une fenêtre d'une minute.</li>
                <li>
                    <strong>Resend</strong> - envoi des emails liés à votre compte
                    (confirmation de l'adresse à l'inscription, nouvelle connexion,
                    changement de mot de passe, verrouillage de compte). Les alertes
                    de sécurité indiquent la date, l'adresse IP et l'appareil à
                    l'origine de l'événement.
                </li>
                <li>
                    <strong>Have I Been Pwned</strong> - uniquement si vous lancez
                    la vérification de fuites depuis la page "Analyse du vault" :
                    seuls les 5 premiers caractères d'une empreinte de chaque mot de
                    passe sont envoyés (méthode dite de "k-anonymat"), jamais le mot
                    de passe ni une empreinte complète permettant de le retrouver.
                    Votre navigateur contacte ce service directement, qui voit donc
                    votre adresse IP.
                </li>
                <li>
                    <strong>GitHub</strong> - stockage, dans un dépôt privé, des
                    sauvegardes chiffrées de la base de données (voir "Durée de
                    conservation" ci-dessous).
                </li>
            </ul>
            <p>
                Aucun de ces prestataires n'a accès au contenu en clair de votre
                coffre-fort ni à votre mot de passe maître.
            </p>

            <h2>Durée de conservation</h2>
            <p>
                Vos données de compte sont conservées tant que votre compte existe.
                Si vous supprimez votre compte depuis l'application, votre email,
                l'empreinte de votre mot de passe, le contenu chiffré de votre
                coffre-fort et votre historique d'activité sont effacés
                immédiatement et définitivement de notre base de données active -
                cette action est irréversible.
            </p>
            <p>
                Une session de connexion expire 24 heures après sa dernière
                utilisation, et au plus tard 30 jours après la connexion. Au-delà de
                5 appareils connectés, la session la plus ancienne est fermée.
            </p>
            <p>Certaines données sont en outre supprimées automatiquement, chaque nuit :</p>
            <ul>
                <li>
                    <strong>L'historique d'activité</strong> (connexions, adresses IP,
                    appareils, actions sensibles) : chaque entrée est effacée{" "}
                    <strong>un an</strong> après sa création.
                </li>
                <li>
                    <strong>Les inscriptions jamais confirmées</strong> : effacées{" "}
                    <strong>7 jours</strong> après leur création.
                </li>
                <li>
                    <strong>Les sessions expirées</strong> et les compteurs de tentatives
                    de connexion échouées (conservés sous forme d'empreinte, sans
                    l'adresse email) : effacés dès qu'ils ne servent plus, au plus tard
                    deux jours après.
                </li>
            </ul>
            <div className="legal-callout">
                <strong>Sauvegardes :</strong> une sauvegarde de la base de données,
                chiffrée en AES-256, est réalisée chaque nuit et conservée{" "}
                <strong>90 jours</strong> ; les sauvegardes plus anciennes sont
                supprimées automatiquement. Après la suppression de votre compte, une
                copie chiffrée de vos données (email, historique d'activité, coffre-fort
                chiffré) peut donc subsister dans ces sauvegardes pendant environ 90
                jours, avant d'être effacée à son tour. Ces sauvegardes ne servent qu'à
                restaurer le service après un incident : elles ne permettent pas de
                récupérer un compte supprimé.
            </div>

            <h2>Vos droits</h2>
            <p>
                Selon votre lieu de résidence, vous disposez de droits sur vos
                données personnelles : accès, rectification, effacement, limitation,
                portabilité, opposition. Depuis l'application, vous pouvez consulter
                vos appareils connectés et votre historique d'activité (page
                Sécurité), déconnecter un appareil, changer votre mot de passe maître
                et supprimer votre compte. Le changement d'adresse email et l'export
                du coffre-fort ne sont pas encore disponibles dans l'application :
                pour ces demandes comme pour toute autre, contactez-nous via{" "}
                <strong>contact@aegis-protect.fr</strong>.
            </p>
            <p>
                Si vous estimez que vos droits ne sont pas respectés, vous pouvez
                adresser une réclamation à la CNIL (www.cnil.fr).
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
                notifications email sur les événements sensibles. Dans le navigateur,
                le coffre-fort se verrouille après 10 minutes d'inactivité (5 minutes
                si l'onglet est en arrière-plan).
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
