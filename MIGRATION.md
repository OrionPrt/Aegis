# Migration Railway → Vercel + Neon + Upstash

Le code est prêt. Il te reste des étapes côté "comptes" que je ne peux pas
faire à ta place (création de comptes, boutons à cliquer dans des dashboards).

## 1. Base de données - Neon

1. Crée un compte sur https://neon.tech et un nouveau projet Postgres.
2. Dans le dashboard Neon, récupère **deux** chaînes de connexion :
   - La connexion **pooled** (hostname qui contient `-pooler`) → ce sera `DATABASE_URL`
   - La connexion **directe** (sans `-pooler`) → ce sera `DIRECT_URL`
3. Ajoute `?pgbouncer=true&connection_limit=1` à la fin de l'URL pooled
   (recommandé par Prisma quand on passe par un pooler en mode transaction).
4. Si tu as déjà de vrais comptes utilisateurs sur Railway :
   ```bash
   pg_dump "postgresql://<url-railway>" --no-owner --no-acl -f aegis_dump.sql
   psql "<DIRECT_URL neon>" -f aegis_dump.sql
   ```
   Sinon, l'étape 3 du déploiement Vercel (`prisma migrate deploy`) recréera
   le schéma vide automatiquement.

## 2. Rate limiting — Upstash

1. Crée un compte sur https://upstash.com (le marketplace Vercel propose
   aussi une intégration en un clic depuis le dashboard Vercel).
2. Crée une base Redis. Récupère `UPSTASH_REDIS_REST_URL` et
   `UPSTASH_REDIS_REST_TOKEN` (le code lit ces deux variables automatiquement
   via `Redis.fromEnv()`).

## 3. Déploiement — Vercel

1. Pousse ce projet sur GitHub (dans son état actuel, avec ce `MIGRATION.md`,
   `vercel.json`, `api/`, etc. à la racine).
2. Sur https://vercel.com, "Add New Project" → importe le repo.
3. **Important** : si ce repo contient d'autres dossiers que `Aegis/` à sa
   racine, règle "Root Directory" sur `Aegis` dans les paramètres du projet.
   Sinon laisse tel quel (le `vercel.json` fourni gère déjà le build).
4. Framework Preset : "Other" (le `vercel.json` pilote déjà `buildCommand`
   et `outputDirectory`, donc peu importe le preset détecté).
5. Ajoute ces variables d'environnement (Production **et** Preview) :

   | Variable | Valeur |
   |---|---|
   | `DATABASE_URL` | URL pooled Neon (avec `?pgbouncer=true&connection_limit=1`) |
   | `DIRECT_URL` | URL directe Neon |
   | `JWT_SECRET` | une chaîne aléatoire longue (`openssl rand -hex 32`) |
   | `COOKIE_SECRET` | une autre chaîne aléatoire longue |
   | `AEGIS_DUMMY_SALT` | une chaîne aléatoire (32-64 caractères) |
   | `UPSTASH_REDIS_REST_URL` | depuis Upstash |
   | `UPSTASH_REDIS_REST_TOKEN` | depuis Upstash |
   | `NODE_ENV` | `production` |

   Ne mets **pas** `VITE_API_URL` — le frontend doit taper sur `/api` en
   relatif, ce qui fonctionne nativement puisque front et back sont
   maintenant servis sous le même domaine Vercel.

6. Avant le tout premier déploiement (ou en local, une fois), applique le
   schéma sur Neon :
   ```bash
   cd backend
   DATABASE_URL="<pooled>" DIRECT_URL="<directe>" npx prisma migrate deploy
   ```
7. Déploie. Chaque futur `git push` sur la branche connectée redéploiera
   automatiquement — plus besoin de rien faire à la main.

## Ce qui a changé dans le code (pour référence)

- `backend/src/server/build-app.ts` — construit l'app Fastify sans jamais
  appeler `.listen()` (nécessaire pour tourner en fonction serverless).
- `backend/src/server/app.ts` — ne sert plus qu'au dev local
  (`npm run dev --workspace=backend`), appelle `buildApp()` puis `.listen()`.
- `api/index.ts` — le point d'entrée Vercel : réutilise l'app Fastify
  construite une seule fois par instance de fonction, et lui délègue chaque
  requête brute.
- `backend/src/server/lib/prisma.ts` — client Prisma unique et partagé
  (avant : une instance différente créée dans chaque fichier de routes,
  risque d'épuiser les connexions Postgres en serverless).
- Rate limiting : `@fastify/rate-limit` (mémoire locale, ne fonctionne pas
  correctement en serverless) remplacé par `@upstash/ratelimit` (compteur
  partagé côté Redis).
- CORS retiré : front et back étant désormais servis sous le même domaine
  Vercel, il n'y a plus de requête cross-origin — donc plus besoin de
  `@fastify/cors`, et les cookies `sameSite: "strict"` fonctionnent
  réellement (avec Railway + Vercel sur deux domaines différents, il est
  possible que le cookie de refresh n'ait en réalité jamais été envoyé par
  le navigateur : `sameSite: "strict"` bloque les cookies cross-site, même
  avec `credentials: "include"` côté fetch).
- Correction annexe : la ré-augmentation manuelle de types TypeScript pour
  `jwtVerify`/`jwtSign` dans `auth.ts` entrait en conflit avec les types déjà
  fournis par une version récente de `@fastify/jwt` — supprimée (les plugins
  `@fastify/jwt` et `@fastify/cookie` fournissent déjà ces types).
- `backend/prisma/schema.prisma` — ajout de `directUrl` (nécessaire pour que
  `prisma migrate deploy` utilise la connexion directe pendant que
  l'exécution normale passe par le pooler de connexions Neon).
- `package.json` (racine, nouveau) + `vercel.json` (nouveau) — transforment
  le repo en monorepo npm workspaces, ce qui permet à Vercel de builder le
  frontend et d'exécuter `api/index.ts` depuis un seul projet.

`backend/nixpacks.toml` n'est plus utilisé (c'était la config Railway) —
tu peux le supprimer, il est laissé inoffensif pour l'instant.
