# Documentation Aegis

Aegis est un gestionnaire de mots de passe **zero-knowledge** : le serveur ne voit
jamais le mot de passe maître ni le contenu en clair du coffre-fort. Cette
documentation détaille l'architecture technique, le modèle de sécurité, l'API et
le déploiement. Pour une présentation générale du projet, voir le
[README](../README.md) à la racine.

## Sommaire

| Document | Contenu |
|---|---|
| [architecture.md](./architecture.md) | Structure du monorepo, flux de requêtes, séparation dev local / serverless |
| [security-model.md](./security-model.md) | Chiffrement zero-knowledge, dérivation de clés, sessions, anti-énumération, verrouillage de compte |
| [api-reference.md](./api-reference.md) | Référence complète des routes REST (`/api/auth`, `/api/vault`, `/api/sessions`) |
| [frontend-guide.md](./frontend-guide.md) | Pages, routes, modules `lib/`, types d'entrées du coffre-fort |
| [deployment.md](./deployment.md) | Variables d'environnement, Vercel, Neon, Upstash, Resend |
| [testing.md](./testing.md) | Tests unitaires, intégration, E2E - comment les lancer en local et en CI |
| [../BACKUP.md](../BACKUP.md) | Sauvegardes chiffrées automatiques (GitHub Actions) et procédure de restauration |

## Pour démarrer en local

```bash
# 1. Postgres local via Docker
docker run --name aegis-db \
  -e POSTGRES_USER=aegis -e POSTGRES_PASSWORD=aegis_dev -e POSTGRES_DB=aegis \
  -p 5432:5432 -d postgres:16

# 2. Dépendances (monorepo npm workspaces)
npm install

# 3. Migrations Prisma
npm run db:migrate --workspace=backend

# 4. Lancer backend + frontend (deux terminaux)
npm run dev:backend
npm run dev:frontend
```

Variables d'environnement requises : voir [deployment.md](./deployment.md#variables-denvironnement).

## Principe fondateur : zero-knowledge

Tout ce qui touche au chiffrement se passe **côté client**. Le serveur stocke :
- un email,
- une empreinte du mot de passe maître qui ne permet pas de le retrouver ni de
  déchiffrer quoi que ce soit (`authKeyHash`),
- le coffre-fort chiffré (`vaultData` + `vaultIv`) sous forme de blob opaque.

Le détail complet (algorithmes, dérivation, modèle de session) est dans
[security-model.md](./security-model.md).
