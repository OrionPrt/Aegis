# Architecture

## Monorepo

```
Aegis/
├── frontend/          React 19 + TypeScript + Vite (SPA)
├── backend/           Fastify 5 + TypeScript + Prisma (API)
├── api/index.ts        Wrapper serverless pour Vercel (voir plus bas)
├── vercel.json         Config déploiement (rewrites, headers de sécurité)
├── docs/                Cette documentation
└── BACKUP.md            Sauvegardes chiffrées automatiques
```

`package.json` à la racine déclare les workspaces npm (`frontend`, `backend`) et
expose `dev:frontend` / `dev:backend` / `build`.

## Deux façons de servir l'API Fastify

L'app Fastify elle-même (`backend/src/server/build-app.ts`, fonction `buildApp()`)
est indépendante de la façon dont elle est exposée :

- **En local (`npm run dev:backend`)** : `backend/src/server/app.ts` charge le
  `.env` racine, appelle `buildApp()` puis `app.listen()` sur le port `3000` -
  un vrai process qui écoute un port.
- **Sur Vercel** : `api/index.ts` est une fonction serverless. Elle appelle
  `buildApp()` une seule fois par instance ("warm start"), puis délègue chaque
  requête brute reçue via `vercel.json` (`rewrites`: `/api/:path*` → `/api`) à
  cette instance Fastify sans jamais appeler `.listen()` - le modèle
  serverless ne le permet pas.

Cette séparation évite de dupliquer la logique des routes entre les deux modes
de déploiement.

## Flux d'une requête authentifiée

```
Navigateur                         Vercel / Fastify                  Neon Postgres
   │                                     │                                 │
   │  fetch /api/vault                   │                                 │
   │  Authorization: Bearer <JWT 15min>  │                                 │
   │  Cookie: aegis_rt (httpOnly)        │                                 │
   ├────────────────────────────────────►│                                 │
   │                                     │  requireAuth() vérifie le JWT   │
   │                                     ├────────────────────────────────►│
   │                                     │  SELECT vaultData, vaultIv      │
   │                                     │◄────────────────────────────────┤
   │  { vault: { ciphertext, iv } }      │                                 │
   │◄────────────────────────────────────┤                                 │
   │                                     │                                 │
   │  déchiffrement AES-256-GCM en JS    │                                 │
   │  (masterKey jamais envoyée)         │                                 │
```

Le serveur ne fait jamais transiter ni stocker de texte en clair - il relaie un
blob chiffré. Voir [security-model.md](./security-model.md) pour le détail du
chiffrement et du cycle de vie des tokens.

## Frontend (SPA React)

- **Routing** : `react-router-dom`, `BrowserRouter` dans `App.tsx`. Routes
  protégées (`/vault`, `/security`, `/sessions`) via un composant
  `ProtectedRoute` qui vérifie `isAuthenticated()` (état en mémoire, pas de
  redirection serveur).
- **État de session** : variable module-level en mémoire dans
  `lib/auth-client.ts` (`_session`) - jamais persistée en `localStorage` ni
  `sessionStorage`. Un rechargement de page efface l'état, y compris la clé de
  déchiffrement du vault.
- **Pages publiques** : `/login`, `/privacy`, `/terms`, `/cookies`.

Détail des pages et modules dans [frontend-guide.md](./frontend-guide.md).

## Backend (Fastify)

Trois groupes de routes, montés avec un préfixe dans `build-app.ts` :

| Préfixe | Fichier | Rôle |
|---|---|---|
| `/api/auth` | `routes/auth.ts` | Inscription, connexion, refresh, déconnexion, changement de mot de passe |
| `/api/vault` | `routes/vault.ts` | Lecture/écriture du blob chiffré, suppression de compte |
| `/api/sessions` | `routes/sessions.ts` | Liste/révocation des sessions, historique d'audit |

Bibliothèques partagées dans `lib/` :

- `prisma.ts` - client Prisma singleton
- `audit.ts` - gestion des sessions (refresh tokens) + journal d'audit
- `email.ts` - notifications de sécurité par email (Resend)

Middleware transverses enregistrés dans `build-app.ts` : `@fastify/helmet`
(CSP + headers), `@fastify/cookie`, `@fastify/jwt`, rate limiting via
`@upstash/ratelimit` (Redis - nécessaire en serverless car un store en mémoire
type `@fastify/rate-limit` ne serait pas partagé entre instances).

## Base de données

Trois tables Prisma (`backend/prisma/schema.prisma`) :

- **`User`** - email, `authKeyHash` (bcrypt), `saltBase64`, `vaultData`/`vaultIv`
  (blob chiffré), compteur d'échecs + verrou de compte.
- **`Session`** - une ligne par appareil connecté (remplace un unique refresh
  token sur `User`). Lookup O(1) par `lookupToken` indexé, vérification par
  `bcrypt.compare` du `refreshTokenHash`.
- **`AuditLog`** - toutes les actions sensibles (connexion, échec, changement de
  mot de passe, suppression de compte, etc.), avec IP/user-agent/métadonnées.

Détail des colonnes et de l'énumération `AuditAction` dans
[api-reference.md](./api-reference.md).
