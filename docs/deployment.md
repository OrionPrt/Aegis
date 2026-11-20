# Déploiement

## Topologie

- **Frontend** : build statique Vite (`frontend/dist`), servi par Vercel.
- **Backend** : fonction serverless Vercel (`api/index.ts`), qui délègue à
  l'app Fastify construite par `backend/src/server/build-app.ts` (voir
  [architecture.md](./architecture.md)).
- **Base de données** : Neon Postgres (deux URLs distinctes, voir plus bas).
- **Rate limiting** : Upstash Redis (REST API, compatible serverless).
- **Emails transactionnels** : Resend.
- **Sauvegardes** : GitHub Actions → dump chiffré → repo privé (voir
  [../BACKUP.md](../BACKUP.md)).

`vercel.json` définit :
- `buildCommand: npm run build`, `outputDirectory: frontend/dist`,
  `installCommand: npm install` (build du monorepo depuis la racine),
- `rewrites` : `/api/:path*` → fonction serverless `/api`, et fallback SPA
  (`/(.*)` → `/index.html`) pour que la navigation directe sur une route React
  (`/vault`, `/privacy`, ...) ne retourne pas un 404,
- `headers` : CSP et en-têtes de sécurité sur tout ce qui n'est pas `/api/*`
  (détaillé dans [security-model.md](./security-model.md)).

## Variables d'environnement

### Backend (Vercel / `.env` local à la racine du monorepo)

| Variable | Rôle | Requis |
|---|---|---|
| `DATABASE_URL` | URL Postgres **poolée** (Neon, `-pooler` dans le hostname, `?pgbouncer=true`) - utilisée à l'exécution | Oui |
| `DIRECT_URL` | URL Postgres directe (sans pooler) - utilisée uniquement par `prisma migrate deploy` | Oui |
| `JWT_SECRET` | Secret de signature des access tokens (HS256), 32 caractères aléatoires minimum (`openssl rand -base64 48`) | Oui - l'API refuse de démarrer sans |
| `COOKIE_SECRET` | Secret de signature des cookies (`@fastify/cookie`) | Oui |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Accès Redis pour le rate limiting (`lib/rate-limit.ts`) | Oui - l'API refuse de démarrer en production sans eux |
| `RESEND_API_KEY` | Envoi des emails de sécurité | Oui (vide accepté en dev pour désactiver l'envoi) |
| `EMAIL_FROM` | Adresse d'expédition des emails (défaut : `Aegis <onboarding@resend.dev>`) | Non |
| `APP_URL` | Adresse publique du site (ex. `https://www.aegis-protect.fr`), pour les liens des emails de confirmation. Sur Vercel, le domaine de production (`VERCEL_PROJECT_PRODUCTION_URL`) sert de repli | Recommandé - l'API refuse de démarrer en production sans l'un des deux |
| `CRON_SECRET` | Secret aléatoire (`openssl rand -base64 32`) : Vercel l'envoie à `GET /api/cron/purge`, la purge nocturne des données expirées. Sans lui, la purge refuse de tourner | Oui en production |
| `AEGIS_DUMMY_SALT` | Secret (32+ caractères aléatoires) dont dérivent les sels factices de `/auth/salt` pour les emails sans compte ; `JWT_SECRET` sert de repli s'il est absent | Recommandé |
| `NODE_ENV` | `production` active les cookies `Secure` et masque le détail des erreurs internes | Non |
| `PORT` | Port d'écoute en dev local uniquement (défaut `3000`) | Non |

### Frontend (Vite, préfixe `VITE_*`)

| Variable | Rôle |
|---|---|
| `VITE_API_URL` | Base URL de l'API si différente de l'origine du frontend (vide = même origine) |

> Rappel : toute variable préfixée `VITE_*` est embarquée en clair dans le
> bundle JS servi au navigateur - ne jamais y mettre de secret.

## Base de données (Neon)

Neon expose deux connexions distinctes pour le même projet :
- une URL **poolée** (via PgBouncer, hostname en `-pooler`) à utiliser pour
  toutes les requêtes applicatives (compatible avec le modèle serverless, où
  chaque invocation ouvrirait sinon sa propre connexion),
- une URL **directe** réservée aux migrations (`prisma migrate deploy`), qui
  ne fonctionnent pas correctement à travers un pooler de transactions.

`backend/prisma/schema.prisma` déclare les deux (`url` / `directUrl`).

## Checklist de déploiement initial

1. Créer le projet Neon, récupérer les deux URLs (poolée + directe).
2. Créer une base Upstash Redis, récupérer REST URL + token.
3. Créer un compte Resend, vérifier le domaine d'envoi, récupérer la clé API.
4. Renseigner toutes les variables ci-dessus dans le dashboard Vercel
   (Production + Preview si besoin).
5. `npx prisma migrate deploy` (avec `DIRECT_URL`) avant le premier déploiement,
   ou via un job CI dédié.
6. Déployer sur Vercel (`vercel --prod` ou push sur la branche liée).
7. Vérifier `GET /api/health` répond `{ "status": "ok" }`.
