# Aegis

Aegis est un gestionnaire de mots de passe **zero-knowledge** : le chiffrement
et le déchiffrement de votre coffre-fort se font entièrement sur votre
appareil. Le serveur ne voit et ne stocke jamais votre mot de passe maître, ni
le contenu en clair de vos identifiants, cartes ou notes - uniquement un blob
chiffré qu'il est techniquement incapable de lire.

## Fonctionnalités

- **Coffre-fort chiffré** pour identifiants, cartes bancaires et notes
  sécurisées, avec génération de codes 2FA (TOTP) intégrée
- **Générateur de mots de passe** et analyse de la force / réutilisation des
  mots de passe existants
- **Vérification de fuites** (Have I Been Pwned) à la demande, sans jamais
  envoyer votre mot de passe
- **Gestion des sessions** : liste des appareils connectés, révocation à
  distance, historique d'audit des actions sensibles
- **Notifications de sécurité** par email (changement de mot de passe,
  nouvelle connexion inhabituelle, compte verrouillé)
- **Sauvegardes chiffrées automatiques** de la base de données

## Stack technique

Frontend React + TypeScript (Vite) · Backend Fastify + TypeScript · Prisma /
PostgreSQL (Neon) · déploiement Vercel.

## Démarrer en local

```bash
npm install
npm run dev:backend    # terminal 1
npm run dev:frontend   # terminal 2
```

Prérequis (base de données, variables d'environnement) et documentation
complète : voir **[docs/](./docs/README.md)**.

## Documentation

| | |
|---|---|
| [docs/architecture.md](./docs/architecture.md) | Structure du projet et flux de requêtes |
| [docs/security-model.md](./docs/security-model.md) | Chiffrement, sessions, protections anti-abus |
| [docs/api-reference.md](./docs/api-reference.md) | Référence des routes de l'API |
| [docs/frontend-guide.md](./docs/frontend-guide.md) | Pages et modules du frontend |
| [docs/deployment.md](./docs/deployment.md) | Variables d'environnement et déploiement |
| [BACKUP.md](./BACKUP.md) | Sauvegardes et restauration de la base de données |

## Licence et pages légales

Politique de confidentialité : [`/privacy`](./frontend/src/pages/PrivacyPage.tsx) ·
Conditions d'utilisation : [`/terms`](./frontend/src/pages/TermsPage.tsx) ·
Cookies : [`/cookies`](./frontend/src/pages/CookiesPage.tsx)
