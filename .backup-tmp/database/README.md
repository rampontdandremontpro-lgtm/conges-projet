# Base de données GMES

Le fichier `reference/diagramme_bdd_gestion_conges_gmes_v1_simplifie.dbml` est la source de vérité du schéma.

La base contient exactement 13 tables :

- `services`
- `users`
- `leave_types`
- `leave_requests`
- `absence_declarations`
- `documents`
- `derogations`
- `leave_balances`
- `balance_movements`
- `holidays`
- `settings`
- `notifications`
- `audit_logs`

## Réinitialisation complète

Depuis le dossier `backend` :

```powershell
powershell -ExecutionPolicy Bypass -File .\database\reset-database.ps1
```

Le script supprime volontairement la base `gestion_conges_gmes`, la recrée avec `schema.sql`, insère les données de départ avec `seed.sql`, puis lance `verify-schema.sql`.

TypeORM est configuré avec `synchronize: false`. Le démarrage du backend ne crée donc aucune table et ne modifie jamais automatiquement le schéma.

## Compte initial

Le seed crée le compte local suivant sans mot de passe :

```text
admin@gmes.fr
```

Utiliser successivement :

```text
POST /api/auth/request-password
POST /api/auth/define-password
```

Le jeton temporaire apparaît dans le terminal NestJS tant que l’envoi par e-mail n’est pas intégré.
