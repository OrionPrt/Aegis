# Modèle de sécurité

## Chiffrement zero-knowledge

Tout le chiffrement/déchiffrement se fait côté client (`frontend/src/lib/crypto.ts`).
Le serveur ne reçoit jamais le mot de passe maître, ni en clair ni sous une
forme qui permettrait de le retrouver.

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
  utilisation (nouveau `lookupToken`/`secretToken`, ancien invalidé).
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

Objectif : qu'un attaquant ne puisse pas déterminer si un email est inscrit.

- **`GET /api/auth/salt`** retourne toujours un sel : celui de l'utilisateur
  s'il existe, sinon un `getDummySalt()` valide en Base64 (configurable via
  `AEGIS_DUMMY_SALT`, avec un fallback statique en dur). Un délai aléatoire
  (200-300 ms) est ajouté dans les deux cas pour uniformiser le timing.
- **`POST /api/auth/login`** compare toujours contre un hash bcrypt, même si
  l'utilisateur n'existe pas (`dummyHash` codé en dur) - `bcrypt.compare` prend
  un temps constant qu'il y ait ou non un vrai compte, ce qui évite une
  différence de timing observable.
- **`POST /api/auth/register`** sur un email déjà pris exécute quand même un
  `bcrypt.hash` avant de répondre `409`, pour la même raison de constance de
  timing.
- Message d'erreur générique ("Identifiants incorrects") qu'il s'agisse d'un
  email inconnu ou d'un mauvais mot de passe.

## Verrouillage de compte (brute-force)

- `MAX_FAILED_ATTEMPTS = 3` tentatives échouées déclenchent un verrou de
  `LOCKOUT_DURATION_MS = 15 minutes` (`User.lockedUntil`).
- Le compteur est partagé entre `/login`, `/change-password` et
  `DELETE /api/vault` (suppression de compte) - toute action nécessitant une
  re-preuve du mot de passe incrémente le même compteur.
- Un email de notification (`sendAccountLockedEmail`) est envoyé au moment où
  le verrou se déclenche (pas à chaque tentative).
- Réponse `429` avec header `Retry-After` en secondes pendant le verrou.

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
    opt-in) et les polices Google Fonts,
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
