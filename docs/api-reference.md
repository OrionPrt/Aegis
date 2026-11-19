# Référence API

Base URL : `/api` (préfixe géré par `vercel.json` en prod, `http://localhost:3000/api`
en dev). Toutes les routes protégées attendent `Authorization: Bearer <accessToken>`
et le cookie `aegis_rt` est géré automatiquement par le navigateur
(`credentials: "include"`).

Codes d'erreur communs : `400` (payload invalide, Zod), `401` (non authentifié
ou identifiants incorrects), `404` (ressource introuvable), `429` (rate limit
global ou verrouillage de compte, avec header `Retry-After`).

## `/api/auth`

### `POST /api/auth/register`

Crée un compte. Le mot de passe maître ne transite jamais - seul `authKeyHex`
(dérivé côté client) est envoyé.

```json
// Requête
{ "email": "a@b.com", "authKeyHex": "<64 hex>", "saltBase64": "<32-64 chars>" }

// Réponse 201
{ "accessToken": "<jwt>", "expiresAt": 1234567890000 }
```
Pose aussi le cookie `aegis_rt`. `409` si l'email existe déjà (délai constant
appliqué avant la réponse, voir [security-model.md](./security-model.md)).

### `GET /api/auth/salt?email=...`

Retourne le sel Argon2id de l'utilisateur, ou un sel factice si l'email
n'existe pas (anti-énumération). Toujours `200`.

```json
{ "saltBase64": "<base64>" }
```

### `POST /api/auth/login`

```json
// Requête
{ "email": "a@b.com", "authKeyHex": "<64 hex>" }

// Réponse 200
{ "accessToken": "<jwt>", "expiresAt": 1234567890000 }
```
`401` si identifiants incorrects, `429` si compte verrouillé. Pose le cookie
`aegis_rt` (révoque d'abord toute session existante pour ce compte sur ce
même navigateur - voir [security-model.md](./security-model.md)).

### `POST /api/auth/change-password` 🔒

```json
// Requête
{
  "currentAuthKeyHex": "<64 hex>",
  "newAuthKeyHex": "<64 hex>",
  "vault": { "ciphertext": "<base64>", "iv": "<16 chars base64>" },
  "baseVersion": 3
}

// Réponse 200
{ "message": "Mot de passe maître changé. Reconnectez-vous." }
```
`409` si le coffre a été modifié depuis `baseVersion` (version renvoyée par
`GET /api/vault`) : rien n'est changé, le client doit recharger le coffre.
Remplace `authKeyHash` + le vault en une opération atomique, révoque **toutes**
les sessions, efface le cookie. `401` si `currentAuthKeyHex` incorrect (compte
comme tentative échouée), `429` si verrouillé.

### `POST /api/auth/refresh`

Aucun body - utilise le cookie `aegis_rt`. Fait une rotation du refresh token.

```json
{ "accessToken": "<jwt>", "expiresAt": 1234567890000 }
```
`401` si le cookie est absent ou invalide (et l'efface le cas échéant).

### `POST /api/auth/logout`

Révoque la session correspondant au cookie `aegis_rt` et l'efface. Toujours
`200`, même sans cookie.

## `/api/vault`

Toutes les routes sont protégées (`requireAuth`, 🔒). Le serveur ne valide que
la forme du payload, jamais le contenu (opaque et chiffré).

### `GET /api/vault` 🔒

```json
// Vault existant
{ "vault": { "ciphertext": "<base64>", "iv": "<base64>" }, "version": 3, "updatedAt": 1234567890000 }

// Premier accès après inscription (aucun vault sauvegardé)
{ "vault": null, "version": 0 }
```

### `PUT /api/vault` 🔒

Remplace intégralement le vault chiffré, à condition qu'il soit encore à la
version `baseVersion` dont part le client (champ requis, entier ≥ 0). Sinon
`409` avec la version actuelle (`{ "message", "version" }`) : un autre appareil
a sauvegardé entre-temps, ses changements ne sont pas écrasés. La réponse `200`
renvoie la nouvelle `version`.

```json
// Requête
{ "ciphertext": "<base64, max 10 Mo>", "iv": "<16 chars base64>" }

// Réponse 200
{ "message": "Vault sauvegardé." }
```

### `DELETE /api/vault` 🔒

Supprime définitivement le compte et le vault - action irréversible. Exige une
re-preuve du mot de passe maître.

```json
// Requête
{ "authKeyHex": "<64 hex>" }

// Réponse 200
{ "message": "Compte et vault supprimés définitivement." }
```
`401` si mot de passe incorrect (compte comme tentative échouée, peut
déclencher un verrou), `429` si déjà verrouillé.

## `/api/sessions`

Toutes protégées (🔒).

### `GET /api/sessions` 🔒

Liste les sessions actives (non expirées) de l'utilisateur, avec un flag
`isCurrent` (déterminé par correspondance IP + user-agent avec la requête en
cours - une heuristique, pas une identité cryptographique).

```json
{
  "sessions": [
    {
      "id": "cmu...", "userAgent": "...", "ipAddress": "...",
      "lastUsedAt": "...", "createdAt": "...", "expiresAt": "...",
      "isCurrent": true
    }
  ]
}
```

### `DELETE /api/sessions/:id` 🔒

Révoque une session précise appartenant à l'utilisateur. `404` si elle
n'existe pas ou appartient à quelqu'un d'autre.

### `DELETE /api/sessions` 🔒

Révoque toutes les sessions de l'utilisateur (déconnexion globale) et efface
le cookie courant.

### `GET /api/sessions/audit` 🔒

Historique paginé du journal d'audit de l'utilisateur.

Paramètres query : `limit` (défaut 50, max 100), `offset` (défaut 0).

```json
{
  "logs": [
    { "id": "...", "action": "LOGIN_SUCCESS", "ipAddress": "...", "userAgent": "...", "metadata": {}, "createdAt": "..." }
  ],
  "total": 42, "limit": 50, "offset": 0
}
```

Valeurs possibles de `action` : `LOGIN_SUCCESS`, `LOGIN_FAILED`, `LOGOUT`,
`REGISTER`, `VAULT_READ`, `VAULT_WRITE`, `SESSION_REVOKED`,
`ACCOUNT_DELETED`, `ACCOUNT_DELETE_FAILED`, `PASSWORD_CHANGE_ATTEMPT`.

## Divers

### `GET /api/health`

Health check public, sans authentification.

```json
{ "status": "ok" }
```

### Rate limiting global

Toutes les routes (`preHandler` global dans `build-app.ts`) sont limitées à
100 requêtes/minute/IP via Upstash Redis (sliding window). `429` avec header
`Retry-After` en cas de dépassement - distinct du verrouillage de compte
(qui est par utilisateur, pas par IP).
