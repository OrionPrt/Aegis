# Sauvegarde et restauration de la base de données

Sauvegarde quotidienne automatisée de la base Postgres (Neon), indépendante de
Neon lui-même - reprise après incident (mauvaise migration, panne ou perte de
données côté Neon), pas récupération de compte utilisateur. Un compte
supprimé reste supprimé : voir l'avertissement affiché à l'inscription.

Le contenu du vault (`vaultData`) est déjà chiffré côté client avant d'arriver
en base (zero-knowledge) - le dump ne représente donc pas un risque
supplémentaire pour son contenu. Il contient en revanche des emails et
adresses IP en clair (table `AuditLog`), d'où le chiffrement du fichier avant
de le pousser vers le dépôt de sauvegarde.

## Fonctionnement

- Workflow : `.github/workflows/backup.yml`, exécuté tous les jours à 3h00
  UTC (et déclenchable manuellement depuis l'onglet Actions du dépôt).
- `pg_dump` (format custom, compressé) → chiffrement symétrique AES-256 via
  `gpg` → push vers un dépôt GitHub privé dédié (`aegis-backups`), séparé du
  dépôt de code.
- Aucune purge automatique : les sauvegardes sont conservées indéfiniment
  (le volume reste négligeable à l'échelle de ce projet).

## Mise en place (à faire une fois)

1. **Créer le dépôt de sauvegarde** : sur GitHub, créer un nouveau dépôt
   **privé** nommé `aegis-backups` (vide, sans README).

2. **Créer un token d'accès** scopé à ce seul dépôt :
   GitHub → Settings → Developer settings → Fine-grained tokens → Generate
   new token. Repository access : "Only select repositories" →
   `aegis-backups`. Permissions : Contents → **Read and write**. Aucune autre
   permission n'est nécessaire.

3. **Ajouter les secrets** sur le dépôt `Aegis` (pas `aegis-backups`) :
   Settings → Secrets and variables → Actions → New repository secret.

   | Secret | Valeur |
   |---|---|
   | `DATABASE_DIRECT_URL` | L'URL de connexion **directe, non poolée, de la base de PRODUCTION** (Vercel → Settings → Environment Variables → Production → `DIRECT_URL`, ou dashboard Neon du projet de prod). **Pas** celle du `.env` local, qui pointe sur la pré-prod. |
   | `BACKUP_ENCRYPTION_KEY` | Une passphrase forte dédiée, générée avec `openssl rand -base64 32` (256 bits, aléa cryptographiquement sûr) - **à conserver précieusement en dehors du repo** (gestionnaire de mots de passe), elle est indispensable pour restaurer |
   | `BACKUP_REPO_TOKEN` | Le token créé à l'étape 2 |

4. Vérifier : onglet Actions → "Database Backup" → "Run workflow" pour
   déclencher une première sauvegarde manuelle et confirmer qu'un fichier
   apparaît dans `aegis-backups/backups/`.

## Restaurer une sauvegarde

```bash
# 1. Déchiffrer
gpg --batch --yes --decrypt --passphrase "LA_PASSPHRASE" \
    -o backup.dump backups/2026-09-11T03-00-00Z.dump.gpg

# 2. Restaurer vers une base cible (idéalement une base neuve/vide pour
#    inspection avant de basculer la prod dessus)
pg_restore --clean --if-exists --no-owner --no-privileges \
    -d "postgresql://user:pass@host/dbname" backup.dump
```

`--clean --if-exists` permet de rejouer la restauration sur une base qui
contient déjà les tables (utile pour tester sans tout recréer à la main).
