# Modèle de sécurité

## Chiffrement zero-knowledge

Tout le chiffrement/déchiffrement se fait côté client (`frontend/src/lib/crypto.ts`).
Le serveur ne reçoit jamais le mot de passe maître, ni en clair ni sous une
forme qui permettrait de le retrouver.

Le coffre est chiffré **en un seul bloc** : entrées et dossiers (noms, rangement
de chaque entrée) font partie du même texte chiffré (`lib/vault-format.ts`).
Le serveur ne connaît ni le nombre de dossiers, ni leurs noms, ni ce qu'ils
contiennent - seulement la taille du blob.

### Dérivation de clés (Argon2id)

À l'inscription et à la connexion, le client dérive **deux clés distinctes** à
partir d'une seule entrée :

```
masterPassword + email + salt
        │
        ▼  Argon2id (hash-wasm, WASM)
        │  memorySize=64 MiB, iterations=3, parallelism=4, output=64 bytes
        ▼
[ octets 0..31 ]  → masterKey  (importée en CryptoKey AES-256-GCM NON extractible)
[ octets 32..63 ] → authKeyHex (hex, envoyé au serveur)
```

- Le mot de passe est préfixé par `aegis:<email>:` avant dérivation (le "poivre"
  contextuel) - deux utilisateurs avec le même mot de passe maître obtiennent
  des clés différentes.
- `masterKey` est importée avec `extractable: false` : impossible de la lire en
  mémoire JS une fois importée, même par un attaquant qui exécuterait du code
  arbitraire dans la page après coup.
- `authKeyHex` prouve la connaissance du mot de passe au serveur, mais ne peut
  **pas** servir à déchiffrer quoi que ce soit - le serveur ne stocke que
  `bcrypt(authKeyHex)`.
- Le sel (32 octets aléatoires) est généré côté client à l'inscription et
  stocké côté serveur (`User.saltBase64`), lié au compte.
- Les paramètres Argon2 sont **versionnés** (`KDF_PARAMS` dans `crypto.ts`) :
  la version de chaque compte est stockée (`User.kdfVersion`) et renvoyée par
  `/auth/salt`. Pour les renforcer, on ajoute une version (client et
  `backend/src/server/lib/kdf.ts`) ; les comptes existants continuent de
  dériver avec la leur.
- L'email est normalisé (`trim` + minuscules) dans `deriveKeys` elle-même, pour
  que l'inscription et la connexion dérivent toujours les mêmes clés.

### Chiffrement du coffre-fort (AES-256-GCM)

- Un IV aléatoire de 12 octets est généré à **chaque** chiffrement
  (`crypto.getRandomValues`) - jamais réutilisé.
- GCM apporte confidentialité **et** intégrité : toute modification du
  ciphertext fait échouer le déchiffrement (tag d'authentification).
- Le serveur stocke `ciphertext` + `iv` en Base64 (`User.vaultData` /
  `User.vaultIv`) et ne les valide que sur la forme (taille, encodage), jamais
  sur le contenu.

## Modèle de session

| Élément | Durée de vie | Stockage |
|---|---|---|
| `accessToken` (JWT HS256) | 15 minutes | Mémoire JS uniquement (`_session` dans `auth-client.ts`) |
| `masterKey` (clé de déchiffrement) | Jusqu'à fermeture/rechargement de l'onglet, ou verrouillage automatique : 10 min sans activité, 5 min en arrière-plan (`useIdleLock`) | Mémoire JS uniquement, jamais persistée |
| Cookie `aegis_rt` (refresh token) | Session serveur : 1 jour (`SESSION_TTL_MS`) | Cookie `httpOnly`, `Secure`, `SameSite=Strict`, scope `/api/auth` |

Points importants :

- **Aucune persistance client** (`localStorage`/`sessionStorage`) pour le token
  d'accès ni la clé de déchiffrement : un rechargement de page efface tout,
  l'utilisateur doit retaper son mot de passe maître pour redériver `masterKey`.
- Le refresh token est un **split token** : `lookupToken` (32 hex, indexé en
  base, lookup O(1)) + `secretToken` (vérifié via `bcrypt.compare` contre
  `Session.refreshTokenHash`). Évite un scan O(n) des sessions actives.
- `POST /api/auth/refresh` fait une **rotation** du refresh token à chaque
  utilisation (nouveau `lookupToken`/`secretToken`, ancien invalidé). La
  rotation est conditionnée au token présenté : de deux rafraîchissements
  simultanés avec le même cookie, un seul réussit (le client retente une fois,
  avec le cookie que l'autre a reçu).
- **Réutilisation détectée** : l'ancien `lookupToken` est conservé
  (`Session.previousLookupToken`). S'il est présenté plus de 30 s après la
  rotation, c'est un cookie volé rejoué : la session est révoquée.
- **Durée de vie absolue** : une session ne peut pas être prolongée au-delà de
  30 jours après sa création (`SESSION_ABSOLUTE_TTL_MS`), même utilisée tous
  les jours.
- **Access token lié à sa session** : le JWT porte l'id de session (`sid`) et
  `requireAuth` vérifie qu'elle existe encore. Une déconnexion, une révocation
  depuis la page Sessions ou un changement de mot de passe invalident aussitôt
  les jetons déjà émis, sans attendre leurs 15 minutes.
- **Dédoublonnage même-appareil** : à la connexion, si un cookie `aegis_rt`
  valide pour ce même compte existe déjà (ex. reconnexion après un simple
  rechargement de page), l'ancienne session est révoquée avant d'en créer une
  nouvelle - évite les sessions fantômes dans la liste "Sessions actives".
- **Limite de sessions actives** : `MAX_SESSIONS = 5` par utilisateur - la plus
  ancienne est supprimée au-delà.

Le `maxAge` par défaut du cookie `aegis_rt` (`cookieOpts()` dans
`routes/auth.ts`) est dérivé de `SESSION_TTL_MS` (`lib/audit.ts`) plutôt que
codé en dur séparément - les deux durées de vie (cookie navigateur et session
serveur) restent donc toujours synchronisées.

## Anti-énumération de comptes

Objectif : qu'un attaquant ne puisse pas déterminer si un email est inscrit
à partir de la connexion.

- **`GET /api/auth/salt`** retourne toujours un sel : celui de l'utilisateur
  s'il existe, sinon un sel factice `HMAC-SHA256(AEGIS_DUMMY_SALT, email)`
  tronqué à 32 octets. Il est stable pour une adresse (comme un vrai sel) et
  différent d'une adresse à l'autre : un sel factice unique, partagé par tous
  les emails inconnus, suffirait à les reconnaître. Un délai aléatoire
  (200-300 ms) est ajouté dans les deux cas pour uniformiser le timing.
- **`POST /api/auth/login`** compare toujours contre un hash bcrypt, même si
  l'utilisateur n'existe pas (`dummyHash` codé en dur) - `bcrypt.compare` prend
  un temps constant qu'il y ait ou non un vrai compte, ce qui évite une
  différence de timing observable.
- Message d'erreur générique ("Identifiants incorrects") qu'il s'agisse d'un
  email inconnu ou d'un mauvais mot de passe.

- **`POST /api/auth/register`** répond toujours `202` avec le même message,
  que l'adresse soit libre, déjà inscrite ou en attente de confirmation, après
  un délai aléatoire (200-400 ms). Aucun email n'est envoyé au titulaire d'une
  adresse déjà inscrite.
- **Le verrouillage ne distingue pas les adresses** : le compteur est indexé
  par l'adresse (voir ci-dessous), qu'elle ait un compte ou non. Après 3
  échecs, `/login` répond `429` dans les deux cas.

## Confirmation de l'adresse email

- L'inscription crée un compte **en attente** et envoie un lien à usage
  unique (`/verify-email?token=…`), valable 24 h (`lib/email-verification.ts`).
  Seule l'empreinte sha256 du jeton est stockée.
- Tant que l'adresse n'est pas confirmée, la connexion répond `403`
  (`EMAIL_NOT_VERIFIED`). Ce `403` n'apparaît qu'avec le bon mot de passe :
  un mauvais mot de passe reçoit le `401` habituel, rien n'est révélé à un tiers.
- Une inscription en attente encore valable n'est pas remplacée par une
  nouvelle inscription sur la même adresse (un tiers ne peut pas évincer
  l'inscription légitime) ; une fois expirée, elle l'est.
- `POST /api/auth/resend-verification` envoie un nouveau lien à une
  inscription en attente (l'ancien cesse de fonctionner), avec la même réponse
  dans tous les cas.
- Le lien utilise `APP_URL` (ou le domaine de production fourni par Vercel),
  jamais l'en-tête `Host` de la requête, que le client contrôle.
- La page de confirmation attend un clic : certains filtres de messagerie
  ouvrent les liens des emails tout seuls.

## Verrouillage de compte (brute-force)

- `MAX_FAILED_ATTEMPTS = 3` tentatives échouées déclenchent un verrou de
  `LOCKOUT_DURATION_MS = 15 minutes`, dans `lib/lockout.ts`.
- Le compteur vit dans la table `AuthThrottle`, indexée par
  `HMAC(AEGIS_DUMMY_SALT, email)` : une adresse sans compte se verrouille comme
  une adresse inscrite, et l'adresse elle-même n'est pas stockée.
- Chaque tentative est **réservée avant** la vérification bcrypt, par un
  incrément atomique en base conditionné à `failedAttempts < 3` : des
  requêtes envoyées en parallèle ne peuvent pas tester plus de 3 mots de
  passe par fenêtre de blocage.
- Une preuve correcte remet le compteur à zéro, un blocage expiré aussi :
  une erreur isolée après le déblocage ne reverrouille pas le compte.
- Le compteur est partagé entre `/login`, `/change-password` et
  `DELETE /api/vault` (suppression de compte) - toute action nécessitant une
  re-preuve du mot de passe incrémente le même compteur.
- Un email de notification (`sendAccountLockedEmail`) est envoyé au titulaire
  d'un compte existant au moment où le verrou se déclenche (pas à chaque
  tentative).
- Réponse `429` avec header `Retry-After` en secondes pendant le verrou.

Le blocage reste déclenchable par quiconque connaît l'adresse (3 essais
suffisent) : c'est le compromis assumé pour borner les essais en ligne.

## Limitation de débit

`lib/rate-limit.ts`, compteurs dans Upstash Redis (partagés entre les
instances serverless) :

- 100 requêtes/minute par IP sur toute l'API ;
- 20 requêtes/minute par IP sur `POST /api/auth/login`, `POST /api/auth/register`
  et `GET /api/auth/salt` ;
- si Redis ne répond pas, ces trois routes répondent `503` plutôt que de
  rester sans limite ; le reste de l'API continue de fonctionner ;
- en production, l'API refuse de démarrer si Upstash n'est pas configuré.

## Réauthentification pour les actions destructrices

Deux actions exigent une **preuve fraîche** du mot de passe maître, pas
seulement un JWT valide (un JWT volé - XSS, etc. - a une durée de vie de
15 minutes et ne doit pas suffire) :

- `POST /api/auth/change-password` - `currentAuthKeyHex` re-vérifié par
  bcrypt avant tout changement ; révoque **toutes** les sessions actives à la
  fin (chaque appareil doit se reconnecter avec le nouveau mot de passe).
- `DELETE /api/vault` (suppression de compte) - `authKeyHex` re-vérifié ; le
  client re-dérive systématiquement les clés depuis le mot de passe tapé à
  l'instant, jamais depuis la valeur déjà en mémoire de session.

Ces deux endpoints utilisent des appels `fetch` dédiés côté client plutôt que
le wrapper générique `apiFetch()`, pour éviter que sa logique de retry
automatique sur 401 ne compte deux tentatives échouées au lieu d'une.

## En-têtes de sécurité HTTP

Deux couches complémentaires :

- **`@fastify/helmet`** sur les réponses de l'API (`build-app.ts`) - CSP
  restrictive côté API (`default-src 'self'`, pas de scripts inline).
- **`vercel.json` → `headers`** sur toutes les routes servant le frontend
  statique (tout sauf `/api/*`) :
  - `Content-Security-Policy` avec `script-src 'self' 'wasm-unsafe-eval'`
    (`'wasm-unsafe-eval'`, pas `'unsafe-eval'`, est nécessaire pour la
    compilation WebAssembly d'Argon2id via `hash-wasm` - plus restrictif que
    `'unsafe-eval'` qui autoriserait aussi `eval()`/`Function()`),
    `connect-src` ouvert vers `api.pwnedpasswords.com` (vérification de fuites
    opt-in) uniquement ; `font-src` et `style-src` limités à `'self'`, les
    polices étant servies par le site (`frontend/public/fonts`),
  - `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
    `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`
    (caméra/micro/géoloc désactivés), `Strict-Transport-Security` (HSTS,
    1 an, `includeSubDomains`, `preload`).

## Robustesse du mot de passe maître

À l'inscription et au changement de mot de passe, le mot de passe maître est
évalué par zxcvbn-ts (`lib/password-strength.ts`) : dictionnaires de mots de
passe courants et de mots français, motifs clavier azerty/qwerty, dates,
substitutions « l33t », et l'email du compte. Il faut au moins 12 caractères et
un score de 4, soit au moins 10^10 essais estimés : un attaquant qui obtient la
base peut l'attaquer hors ligne. Les dictionnaires (~520 Ko compressés) ne sont
chargés que sur ces deux écrans.

## Vérification de fuites de mots de passe (Have I Been Pwned)

Fonctionnalité opt-in (bouton explicite, jamais automatique) dans
`frontend/src/lib/pwned.ts` :

- Le mot de passe est haché en SHA-1 côté client.
- Seuls les **5 premiers caractères hexadécimaux** du hash sont envoyés à
  `api.pwnedpasswords.com` (k-anonymat) - le service renvoie toutes les
  terminaisons connues pour ce préfixe, la correspondance exacte se fait en
  local. Le mot de passe et son hash complet ne quittent jamais l'appareil.
- La requête porte l'en-tête `Add-Padding: true` : le service complète sa
  réponse avec de fausses lignes (compteur à 0), pour que sa taille ne trahisse
  pas le préfixe demandé.

## Journal d'audit

Chaque action sensible est tracée dans `AuditLog` (`lib/audit.ts` →
`logAudit()`), avec IP, user-agent et métadonnées contextuelles :

`LOGIN_SUCCESS`, `LOGIN_FAILED`, `LOGOUT`, `REGISTER`, `VAULT_READ`,
`VAULT_WRITE`, `SESSION_REVOKED`, `ACCOUNT_DELETED`, `ACCOUNT_DELETE_FAILED`,
`PASSWORD_CHANGE_ATTEMPT`.

Chaque nuit, Vercel Cron appelle `GET /api/cron/purge` (`routes/cron.ts`,
protégée par `CRON_SECRET`). Cette purge supprime :

- les entrées du journal d'audit de plus d'**un an** ;
- les inscriptions jamais confirmées de plus de 7 jours ;
- les sessions expirées ;
- les compteurs de tentatives inutilisés depuis plus d'un jour.

`logAudit()` ne lève jamais d'exception - une erreur d'écriture du journal ne
doit jamais faire échouer la requête utilisateur. Consultable par
l'utilisateur lui-même via `GET /api/sessions/audit` (voir
[api-reference.md](./api-reference.md)).

> Note : `ACCOUNT_DELETED` est défini dans l'enum mais n'est jamais réellement
> écrit - `AuditLog` a `onDelete: Cascade` sur `User`, donc toute entrée serait
> supprimée dans le même instant que le compte et n'apporterait aucune trace
> exploitable (voir le commentaire dans `routes/vault.ts`).

## Notifications de sécurité par email

Envoyées via Resend (`lib/email.ts`), avec échappement HTML systématique
(`escapeHtml()`) de toute valeur interpolée issue de la requête (IP,
user-agent) :

- **Mot de passe changé** (`sendPasswordChangedEmail`)
- **Compte verrouillé** après trop d'échecs (`sendAccountLockedEmail`)
- **Nouvelle IP détectée** à la connexion (`sendNewIpLoginEmail`) - envoyé
  uniquement si l'utilisateur a déjà eu au moins une connexion réussie
  auparavant ET que cette IP précise n'a jamais été vue sur un login réussi ;
  jamais de notification sur la toute première connexion après inscription.
