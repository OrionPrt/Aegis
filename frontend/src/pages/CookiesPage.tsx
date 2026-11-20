/**
 * ╔═══════════════════════════════════════════════════════╗
 * ║         AEGIS — Politique cookies                     ║
 * ║         src/pages/CookiesPage.tsx                     ║
 * ╚═══════════════════════════════════════════════════════╝
 *
 * Premier jet - à faire relire par un professionnel avant publication.
 * Reflète ce que le code fait réellement à la date indiquée ci-dessous :
 * un seul cookie, aucun tracker tiers, aucun outil d'analytics.
 */

import { LegalLayout } from "./LegalLayout";

export default function CookiesPage() {
    return (
        <LegalLayout title="Politique cookies" updated="18 septembre 2026">
            <h2>Un seul cookie, strictement nécessaire</h2>
            <p>
                Aegis n'utilise qu'un seul cookie : <strong>aegis_rt</strong>, qui
                maintient votre session de connexion. Il ne sert à rien d'autre - ni
                suivi publicitaire, ni statistiques, ni profilage.
            </p>
            <ul>
                <li><strong>Nom :</strong> aegis_rt</li>
                <li><strong>Finalité :</strong> maintenir votre session active pendant que l'application reste ouverte, en renouvelant automatiquement votre accès toutes les 15 minutes sans interrompre votre navigation</li>
                <li><strong>Durée :</strong> 24 heures côté serveur, ou jusqu'à déconnexion manuelle - mais en pratique, la clé qui déchiffre votre coffre-fort n'existe qu'en mémoire de votre navigateur et disparaît dès que vous fermez l'onglet ou rechargez la page : vous devrez donc retaper votre mot de passe maître à chaque nouvelle ouverture de l'application, indépendamment de ce cookie</li>
                <li><strong>Portée :</strong> uniquement les requêtes vers <code>/api/auth</code> de ce site</li>
                <li><strong>Protection technique :</strong> <code>HttpOnly</code> (illisible par un script JavaScript), <code>Secure</code> (transmis uniquement en HTTPS), <code>SameSite=Strict</code> (jamais envoyé depuis un autre site)</li>
            </ul>

            <h2>Pourquoi il n'y a pas de bandeau de consentement</h2>
            <p>
                Un cookie est dit "strictement nécessaire" quand il est indispensable
                au fonctionnement du service que vous demandez explicitement - ici,
                rester connecté à votre coffre-fort. Le RGPD et la directive
                ePrivacy exemptent ce type de cookie de l'obligation de recueillir
                votre consentement préalable. C'est le seul cookie que nous posons,
                donc aucun bandeau n'est nécessaire.
            </p>

            <h2>Aucun cookie tiers, aucun tracker</h2>
            <p>
                Aegis ne fait appel à aucun outil d'analytics (Google Analytics ou
                équivalent), aucun pixel publicitaire, aucun réseau social intégré.
                Les polices sont servies par Aegis lui-même. La seule ressource
                externe que l'application peut contacter est :
            </p>
            <ul>
                <li>
                    <strong>Have I Been Pwned</strong> (api.pwnedpasswords.com) -
                    uniquement si vous activez volontairement la vérification de
                    fuites dans la page "Analyse du vault". Aucun cookie n'est posé
                    par ce service depuis Aegis, et votre mot de passe n'est jamais
                    transmis (voir la <a href="/privacy">politique de confidentialité</a>).
                </li>
            </ul>

            <h2>Comment gérer ou supprimer ce cookie</h2>
            <p>
                Vous pouvez supprimer le cookie <code>aegis_rt</code> à tout moment
                depuis les paramètres de votre navigateur. Conséquence : vous serez
                déconnecté et devrez vous reconnecter avec votre mot de passe maître
                à la prochaine visite. Aucune donnée de votre coffre-fort n'est
                affectée par cette suppression.
            </p>

            <h2>Modifications</h2>
            <p>
                Si l'usage des cookies venait à évoluer (ajout d'un outil
                d'analytics, par exemple), cette page serait mise à jour et un
                bandeau de consentement serait alors ajouté si nécessaire.
            </p>

            <h2>Contact</h2>
            <p>
                Pour toute question : <strong>contact@aegis-protect.fr</strong>.
            </p>
        </LegalLayout>
    );
}
