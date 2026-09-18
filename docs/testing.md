# Tests

Trois niveaux, tous exécutés en CI (`.github/workflows/test.yml`) sur chaque
push/PR vers `main`.

| Niveau | Outil | Où |
|---|---|---|
| Unitaire backend | Vitest | `backend/src/server/lib/*.test.ts` |
| Intégration backend | Vitest + `app.inject()` de Fastify | `backend/test/integration/*.test.ts` |
| Unitaire frontend | Vitest + jsdom | `frontend/src/lib/*.test.ts` |
| E2E | Playwright (navigateur réel) | `frontend/e2e/*.spec.ts` |

Aucun test ne touche la base Neon de dev/prod - tous utilisent une base
Postgres **jetable** dédiée.

## Lancer les tests en local

### 1. Base de données jetable

```bash
docker run --name aegis-test-db \
  -e POSTGRES_USER=aegis -e POSTGRES_PASSWORD=aegis_dev -e POSTGRES_DB=aegis \
  -p 5547:5432 -d postgres:16-alpine

DATABASE_URL="postgresql://aegis:aegis_dev@localhost:5547/aegis"
DIRECT_URL="$DATABASE_URL"

cd backend && DATABASE_URL="$DATABASE_URL" DIRECT_URL="$DIRECT_URL" npx prisma migrate deploy
```

### 2. Tests backend (unitaires + intégration)

```bash
cd backend
DATABASE_URL="$DATABASE_URL" DIRECT_URL="$DIRECT_URL" npm test
```

`RESEND_API_KEY` n'a pas besoin d'être défini (aucun email n'est réellement
envoyé - `lib/email.ts` se contente d'un avertissement console si absent).
`UPSTASH_REDIS_REST_URL`/`TOKEN` non plus - le rate limiting se désactive
silencieusement en leur absence (voir `build-app.ts`), ce qui rend l'app
testable sans compte Upstash.

### 3. Tests frontend (unitaires)

```bash
cd frontend
npm test
```

### 4. Tests E2E (Playwright)

Nécessitent le backend et le frontend démarrés contre la même base jetable.
`playwright.config.ts` les lance automatiquement si rien n'écoute déjà sur
les ports 3000/5173 :

```bash
cd frontend
DATABASE_URL="$DATABASE_URL" DIRECT_URL="$DIRECT_URL" RESEND_API_KEY="" NODE_ENV=development \
  npx playwright test
```

### Nettoyage

```bash
docker rm -f aegis-test-db
```

## Conventions

- **Backend** : `test/helpers.ts` fournit `buildTestApp()`, `uniqueEmail()`,
  `fakeAuthKeyHex()` (dérive un hex 64 caractères déterministe depuis une
  graine lisible via sha256 - jamais de caractères hors `[0-9a-f]`, qui
  échoueraient la validation Zod) et `getCookie()`. Chaque test nettoie ses
  propres utilisateurs dans `afterEach`.
- **Frontend** : `fetch` est mocké via `vi.stubGlobal("fetch", ...)` pour les
  tests de `auth-client.ts`/`pwned.ts` - jamais d'appel réseau réel.
  `deriveKeys()` (Argon2id) n'est pas mocké : c'est volontairement la vraie
  fonction qui tourne dans les tests de `crypto.ts`, d'où le timeout de test
  relevé à 20s dans `vitest.config.ts`.
- **E2E** : `e2e/helpers.ts` pilote l'UI réelle (`registerViaUi`, `loginViaUi`).
  `loginViaUi` attend explicitement l'issue de la tentative (redirection ou
  message d'erreur visible) avant de rendre la main - un `page.goto()` répété
  entre tentatives couperait une requête de connexion encore en vol.
- Les sélecteurs E2E ciblent `.nav-item` (barre latérale desktop) plutôt que
  `button[title="..."]` : plusieurs boutons partagent le même `title` entre
  variante desktop et variante mobile (masquée en CSS), et `title` seul
  matche souvent la version mobile cachée.

## Bugs trouvés en écrivant ces tests

Deux problèmes réels ont été découverts (et corrigés) pendant la rédaction
de la suite E2E `cross-account-regression.spec.ts`, pas seulement vérifiés :

1. **Race condition sur le rafraîchissement de token** : deux appels
   `apiFetch()` concurrents (ex. `SessionsPage` lance `/sessions` et
   `/sessions/audit` via `Promise.all`) pouvaient chacun déclencher leur
   propre rafraîchissement ; si le premier détectait un mélange de comptes
   et vidait la session, le second - dont la réponse arrivait après coup -
   ne trouvait plus de session à comparer et adoptait silencieusement son
   token. Corrigé dans `refreshAccessToken()` (`auth-client.ts`) : une
   session déjà vidée est maintenant traitée comme une session expirée,
   jamais comme une absence de vérification à faire.
2. **Suite de tests non exécutable sans compte Upstash réel** : le rate
   limiter (`build-app.ts`) plantait toute requête sans
   `UPSTASH_REDIS_REST_URL`/`TOKEN` configurés. Il se désactive maintenant
   proprement (avec avertissement) en leur absence.
