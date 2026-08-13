# Backend — Gestion des congés GMES

API NestJS, TypeORM et MySQL pour la gestion des demandes de congés, déclarations d'absence, dérogations, soldes, justificatifs, PDF, notifications et circuits de validation.

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

La commande suivante supprime volontairement l'ancienne base, crée exactement les **15 tables** prévues par le diagramme, insère les données initiales puis vérifie le résultat :

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

L'API est disponible sur :

```text
http://localhost:3000/api
```

## Premier compte Admin

Le seed crée :

```text
admin@gmes.fr
```

Aucun mot de passe n'est préenregistré. Pour le définir :

```text
POST /api/auth/request-password
POST /api/auth/define-password
```

Le jeton temporaire est affiché dans le terminal NestJS tant que l'envoi par e-mail n'est pas intégré.


## Profil et paramètres personnels

Les utilisateurs connectés disposent des routes personnelles suivantes :

```text
GET    /api/users/me
GET    /api/users/me/signature
PUT    /api/users/me/signature
DELETE /api/users/me/signature
PATCH  /api/auth/change-password
```

`GET /api/users/me` renvoie les informations réelles du compte et du service sans permettre au collaborateur de modifier son rôle ou son affectation.

La signature personnelle est stockée dans les colonnes existantes `signature_type`, `signature_data` et `signature_updated_at` de `users`. Aucune nouvelle table n'est nécessaire. Lors d'une soumission, la signature utilisée est toujours copiée dans la demande afin que les documents anciens ne changent jamais après une modification du profil.

`PATCH /api/auth/change-password` exige le mot de passe actuel et un nouveau mot de passe d'au moins 12 caractères. Cette route concerne les comptes locaux de développement/test ; Microsoft Entra ID reste le mode d'authentification principal prévu en production.

## Schéma V1 actuel

La base contient :

```text
services
service_backup_validators
users
validator_replacements
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

Les deux tables E6 sont :

- `service_backup_validators` : valideurs de secours rattachés à un service ;
- `validator_replacements` : remplacements temporaires rattachés à un collaborateur.

Les PDF officiels sont stockés dans `documents`. L'historique général est stocké dans `audit_logs`. L'historique des soldes repose sur `balance_movements`. Les annulations après validation sont stockées directement dans `leave_requests`.
