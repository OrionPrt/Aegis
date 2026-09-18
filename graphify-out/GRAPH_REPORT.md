# Graph Report - Aegis  (2026-09-18)

## Corpus Check
- Corpus is ~22,043 words - fits in a single context window. You may not need a graph.

## Summary
- 437 nodes · 768 edges · 29 communities (16 shown, 13 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 11 edges (avg confidence: 0.82)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Card & TOTP Utilities
- Backend Routes & Session Core
- Frontend Auth & Crypto Client
- Backend Dependencies & Config
- Frontend Build Config & Deps
- App Routing & Pages
- Security Audit & Password Tools
- Frontend TS Config (app)
- Frontend TS Config (node)
- Backup Workflow & Static Assets
- Backend TS Config
- Frontend Dev Dependencies
- Backend Dependencies List
- Monorepo Root Config
- Backend Dev Dependencies
- Vercel Deployment Config
- Frontend TS Project References
- Backup Repo Secret
- AuditLog Table Reference
- Backup Encryption Secret
- Backup Repo Token Secret
- Direct DB URL Secret
- API Package Type
- Account Deletion Policy
- Backup Retention Gap
- Favicon Asset
- README ESLint Note
- README React Compiler Note
- README Vite Template Note

## God Nodes (most connected - your core abstractions)
1. `authRoutes()` - 18 edges
2. `EntryModal()` - 17 edges
3. `compilerOptions` - 17 edges
4. `apiFetch()` - 16 edges
5. `compilerOptions` - 16 edges
6. `digitsOnly()` - 14 edges
7. `VaultPage()` - 14 edges
8. `changeMasterPassword()` - 12 edges
9. `compilerOptions` - 11 edges
10. `scripts` - 10 edges

## Surprising Connections (you probably didn't know these)
- `Local dev Postgres via Docker (aegis-db)` --semantically_similar_to--> `Database restore procedure (gpg decrypt + pg_restore)`  [INFERRED] [semantically similar]
  README.md → BACKUP.md
- `Backup & Restore documentation` --references--> `Database Backup Workflow`  [EXTRACTED]
  BACKUP.md → .github/workflows/backup.yml
- `Database restore procedure (gpg decrypt + pg_restore)` --conceptually_related_to--> `Encrypt dump step`  [INFERRED]
  BACKUP.md → .github/workflows/backup.yml
- `Page title: Aegis - Gestionnaire de mots de passe` --conceptually_related_to--> `Vault zero-knowledge client-side encryption`  [INFERRED]
  frontend/index.html → BACKUP.md
- `Page title: Aegis - Gestionnaire de mots de passe` --conceptually_related_to--> `Local dev Postgres via Docker (aegis-db)`  [INFERRED]
  frontend/index.html → README.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Database backup pipeline (dump, encrypt, push)** — _github_workflows_backup_install_postgresql_client, _github_workflows_backup_dump_database, _github_workflows_backup_encrypt_dump, _github_workflows_backup_push_to_backup_repository [EXTRACTED 1.00]

## Communities (29 total, 13 thin omitted)

### Community 0 - "Card & TOTP Utilities"
Cohesion: 0.08
Nodes (53): RFC-4226, RFC-4648, RFC-6238, brandLabel(), BRANDS, BrandSpec, CardBrand, checkExpiry() (+45 more)

### Community 1 - "Backend Routes & Session Core"
Cohesion: 0.10
Nodes (49): getApp(), handler(), buildApp(), createSession(), generateRefreshToken(), getIp(), getUserAgent(), getUserSessions() (+41 more)

### Community 2 - "Frontend Auth & Crypto Client"
Cohesion: 0.09
Nodes (42): useVault(), loadVault(), UseVaultReturn, VaultResponse, VaultStatus, apiFetch(), AuthError, AuthSession (+34 more)

### Community 3 - "Backend Dependencies & Config"
Cohesion: 0.05
Nodes (35): engines, node, eslint, serve, @types/node, typescript, name, private (+27 more)

### Community 4 - "Frontend Build Config & Deps"
Cohesion: 0.06
Nodes (33): dependencies, hash-wasm, lucide-react, react, react-dom, react-router-dom, engines, node (+25 more)

### Community 5 - "App Routing & Pages"
Cohesion: 0.09
Nodes (28): App(), ProtectedRoute(), frontend_src_index, isAuthenticated(), FormState, Mode, STRENGTH_LABELS, CookiesPage() (+20 more)

### Community 6 - "Security Audit & Password Tools"
Cohesion: 0.11
Nodes (13): evaluatePasswordStrength(), checkPasswordPwned(), sha1Hex(), AuditReport, computeAudit(), Finding, PwnedStatus, SecurityAuditPage() (+5 more)

### Community 7 - "Frontend TS Config (app)"
Cohesion: 0.11
Nodes (18): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, jsx, lib, module, moduleDetection, moduleResolution (+10 more)

### Community 8 - "Frontend TS Config (node)"
Cohesion: 0.11
Nodes (17): compilerOptions, allowImportingTsExtensions, erasableSyntaxOnly, lib, module, moduleDetection, moduleResolution, noEmit (+9 more)

### Community 9 - "Backup Workflow & Static Assets"
Cohesion: 0.17
Nodes (15): Database Backup Workflow, Dump database step, Encrypt dump step, Install PostgreSQL client step, Push to backup repository step, Client-side vault encryption (AES-256-GCM), Backup & Restore documentation, Database restore procedure (gpg decrypt + pg_restore) (+7 more)

### Community 10 - "Backend TS Config"
Cohesion: 0.14
Nodes (13): compilerOptions, esModuleInterop, module, moduleResolution, outDir, resolveJsonModule, rootDir, skipLibCheck (+5 more)

### Community 11 - "Frontend Dev Dependencies"
Cohesion: 0.15
Nodes (13): devDependencies, eslint, @eslint/js, eslint-plugin-react-hooks, eslint-plugin-react-refresh, serve, @types/node, @types/react (+5 more)

### Community 12 - "Backend Dependencies List"
Cohesion: 0.17
Nodes (12): dependencies, bcryptjs, dotenv, fastify, @fastify/cookie, @fastify/helmet, @fastify/jwt, @prisma/client (+4 more)

### Community 13 - "Monorepo Root Config"
Cohesion: 0.18
Nodes (10): engines, node, name, private, scripts, build, dev:backend, dev:frontend (+2 more)

### Community 14 - "Backend Dev Dependencies"
Cohesion: 0.20
Nodes (10): devDependencies, eslint, prisma, serve, tsx, @types/bcryptjs, @types/node, typescript (+2 more)

### Community 15 - "Vercel Deployment Config"
Cohesion: 0.33
Nodes (5): buildCommand, headers, installCommand, outputDirectory, rewrites

## Knowledge Gaps
- **200 isolated node(s):** `type`, `name`, `version`, `private`, `type` (+195 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 228 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **13 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `react-router-dom` connect `App Routing & Pages` to `Card & TOTP Utilities`, `Frontend Build Config & Deps`, `Security Audit & Password Tools`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **Why does `react` connect `App Routing & Pages` to `Card & TOTP Utilities`, `Frontend Auth & Crypto Client`, `Frontend Build Config & Deps`, `Security Audit & Password Tools`?**
  _High betweenness centrality (0.030) - this node is a cross-community bridge._
- **Why does `devDependencies` connect `Frontend Dev Dependencies` to `Frontend Build Config & Deps`?**
  _High betweenness centrality (0.027) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `authRoutes()` (e.g. with `buildApp()` and `requireAuth()`) actually correct?**
  _`authRoutes()` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `type`, `name`, `version` to the rest of the system?**
  _200 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Card & TOTP Utilities` be split into smaller, more focused modules?**
  _Cohesion score 0.08123904149620105 - nodes in this community are weakly interconnected._
- **Should `Backend Routes & Session Core` be split into smaller, more focused modules?**
  _Cohesion score 0.09586466165413533 - nodes in this community are weakly interconnected._