# Guide Frontend

React 19 + TypeScript + Vite, sans framework d'état externe (pas de Redux/Zustand) -
l'état vit dans les composants et deux modules `lib/` singleton
(`auth-client.ts` pour la session, `useVault.ts` pour le coffre-fort).

## Routes (`App.tsx`)

| Route | Page | Protection |
|---|---|---|
| `/` | redirige vers `/vault` | - |
| `/login` | `AuthPage` | publique |
| `/vault` | `VaultPage` | protégée |
| `/security` | `SecurityAuditPage` | protégée |
| `/sessions` | `SessionsPage` | protégée |
| `/privacy`, `/terms`, `/cookies` | pages légales | publiques |
| `*` | redirige vers `/` | - |

`ProtectedRoute` vérifie `isAuthenticated()` (état en mémoire) côté client -
c'est une commodité UX, pas une barrière de sécurité : la vraie protection est
faite par le backend sur chaque endpoint (`requireAuth`).

## Pages (`src/pages/`)

- **`AuthPage`** - inscription/connexion, un seul formulaire à deux modes.
  Affiche le score de force du mot de passe à l'inscription. Contient aussi le
  lien de consentement légal (mode inscription) et le pied de page vers les
  pages légales.
- **`VaultPage`** - cœur de l'application : liste des entrées, recherche,
  filtre par catégorie ou par dossier, détail d'une entrée, réordonnancement (drag-and-drop
  HTML5 à la souris, poignée tactile via `useTouchReorder` sur mobile),
  modale d'ajout/édition (`EntryModal`), générateur de mot de passe
  (`PasswordGeneratorModal`), changement de mot de passe maître
  (`ChangePasswordModal`), suppression de compte (re-authentification par mot
  de passe, pas une simple case à cocher).
- **`SecurityAuditPage`** - analyse le vault en mémoire (mots de passe faibles,
  réutilisés, anciens) et propose une vérification de fuite HIBP opt-in par
  entrée.
- **`SessionsPage`** - liste les appareils connectés (`GET /api/sessions`),
  révocation individuelle ou globale, et l'historique d'audit
  (`GET /api/sessions/audit`) avec détection best-effort du navigateur/OS à
  partir du user-agent.
- **`LegalLayout`** + **`PrivacyPage`** / **`TermsPage`** / **`CookiesPage`** -
  pages légales publiques, layout partagé (retour, navigation entre les trois,
  titre, date de mise à jour).

## Types d'entrées du coffre-fort

Trois catégories (`Category = "login" | "card" | "note"`), toutes stockées
dans le même coffre chiffré en bloc (voir « Format du coffre » plus bas) :

- **`login`** - identifiant, mot de passe, URL, notes, et optionnellement un
  **secret TOTP** (2FA) : algorithme, nombre de chiffres, période - un code à
  usage unique est généré et affiché avec un compte à rebours visuel
  (`lib/totp.ts`).
- **`card`** - numéro de carte (formaté/masqué), détection de marque
  (Visa/Mastercard/Amex/...), validation Luhn, date d'expiration avec statut
  (`valid`/`soon`/`expired`) (`lib/card.ts`).
- **`note`** - texte libre, masqué par défaut comme un mot de passe (bouton
  révéler/copier), dans une zone bornée et défilante pour ne jamais faire
  bouger les boutons d'action.

## Dossiers

Un seul niveau, une entrée dans un dossier au plus. Logique pure (validation du
nom, création, renommage, suppression, rangement, tri, vue) dans
`pages/vault/folders.ts` ; `VaultPage` ne fait qu'appeler ces fonctions puis
`saveVault`.

- **Barre latérale** (`SidebarFolders`) : section « Dossiers » sous les
  catégories, triée par ordre alphabétique, avec compteurs et bouton « + ».
  Ouvrir un dossier affiche toutes ses entrées, quel que soit leur type ; la
  recherche s'applique alors dans le dossier. Un dossier affiché qui disparaît
  (supprimé ici ou ailleurs) ramène à « Tous les identifiants ».
- **Barre du haut** : en vue dossier, boutons Renommer / Supprimer. Supprimer
  un dossier ne supprime aucune entrée : elles repassent sans dossier.
- **Ranger une entrée** : champ « Dossier » du formulaire (présélectionné sur
  le dossier affiché), bouton « Déplacer vers… » du panneau de détail, ou
  glisser-déposer d'une carte sur un dossier de la barre latérale (souris :
  la carte porte le type `application/x-aegis-entry`, que seuls les dossiers
  acceptent).
- **Mobile** : la barre du bas n'a qu'un onglet « Dossiers », qui ouvre la
  liste (`FolderPickerModal`) ; le rangement passe par « Déplacer vers… ».

## Format du coffre

Le blob chiffré contient, une fois déchiffré (`lib/vault-format.ts`) :

- **v2** (écrit par toute sauvegarde) :
  `{ "format": 2, "entries": VaultEntry[], "folders": VaultFolder[] }` ;
- **v1** (coffres d'avant les dossiers) : un simple tableau `VaultEntry[]`,
  toujours lisible, lu comme un coffre sans dossiers.

Les dossiers n'ont qu'un niveau (pas de parent) ; une entrée en désigne au plus
un via `folderId`. À la lecture, un `folderId` qui ne correspond à aucun dossier
est retiré, et un format inconnu est refusé plutôt qu'affiché tronqué. Tout
passe par le même blob : le serveur ne voit pas les noms des dossiers.

Le coffre se lit et s'écrit en entier (`VaultData`) : `useVault().saveVault`,
comme `changeMasterPassword`, reçoit entrées **et** dossiers - ce qui n'y est
pas serait perdu à la sauvegarde.

## Modules `lib/`

| Module | Rôle |
|---|---|
| `crypto.ts` | Dérivation de clés (Argon2id), chiffrement/déchiffrement du vault (AES-256-GCM), génération de mot de passe, score de force |
| `vault-format.ts` | Format du coffre déchiffré (v1/v2), types `VaultData`/`VaultFolder`, lecture tolérante et écriture au format courant |
| `auth-client.ts` | Session en mémoire, `register`/`login`/`logout`/`changeMasterPassword`/`deleteAccount`, wrapper `apiFetch` avec refresh automatique |
| `totp.ts` | Parsing d'URI `otpauth://`, encodage/décodage base32, génération de codes HOTP/TOTP (Web Crypto, pas de dépendance externe) |
| `card.ts` | Détection de marque de carte, formatage, masquage, validation Luhn |
| `pwned.ts` | Vérification k-anonymat contre l'API Have I Been Pwned |

`hooks/useVault.ts` orchestre le cycle complet côté `VaultPage` : chargement
(`GET /api/vault` + déchiffrement), sauvegarde (chiffrement + `PUT /api/vault`),
et l'état de chargement/erreur associé.

## Style et CSS

Pas de framework CSS (pas de Tailwind) - fichiers `.css` colocalisés par page
(`VaultPage.css`, `AuthPage.css`, etc.), variables de design dans
`src/index.css` (`--bg-base`, `--accent`, etc.), réutilisées telles quelles
dans les pages légales pour rester visuellement cohérentes avec le reste de
l'app.
