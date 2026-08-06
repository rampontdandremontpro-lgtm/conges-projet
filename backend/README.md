# Backend — Gestion des congés GMES

API NestJS, TypeORM et MySQL pour la gestion des demandes de congés, déclarations d’absence, dérogations, soldes, justificatifs et PDF officiels.

## Prérequis

- Node.js ;
- npm ;
- MySQL ou MariaDB ;
- une base nommée `gestion_conges_gmes` ;
- un fichier `.env` dans `backend`.

Exemple minimal de `.env` :

```env
DB_HOST=localhost
DB_PORT=3306
DB_USERNAME=root
DB_PASSWORD=
DB_DATABASE=gestion_conges_gmes

JWT_SECRET=remplace-par-une-cle-longue-et-secrete
JWT_EXPIRES_IN=8h
```

## Installer les dépendances

```powershell
npm install
```

## Recréer la base conformément au diagramme

La commande suivante supprime volontairement l’ancienne base, crée exactement les 13 tables prévues par le diagramme, insère les données initiales puis vérifie le résultat :

```powershell
npm run db:reset
```

Le fichier de référence est :

```text
database/reference/diagramme_bdd_gestion_conges_gmes_v1_simplifie.dbml
```

TypeORM utilise `synchronize: false`. Le backend ne crée donc aucune table automatiquement.

## Démarrer le backend

```powershell
npm run build
npm run start:dev
```

L’API est disponible sur :

```text
http://localhost:3000/api
```

## Premier compte Admin

Le seed crée :

```text
admin@gmes.fr
```

Aucun mot de passe n’est préenregistré. Pour le définir :

```text
POST /api/auth/request-password
POST /api/auth/define-password
```

Le jeton temporaire est affiché dans le terminal NestJS tant que l’envoi par e-mail n’est pas intégré.

## Schéma V1

La base contient uniquement :

```text
services
users
leave_types
leave_requests
absence_declarations
documents
derogations
leave_balances
balance_movements
holidays
settings
notifications
audit_logs
```

Les PDF officiels sont stockés dans `documents`. L’historique général est stocké dans `audit_logs`. Les annulations après validation sont stockées directement dans `leave_requests`.
