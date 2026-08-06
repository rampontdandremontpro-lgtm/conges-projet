# Migration de conformité du schéma GMES — 6 août 2026

Cette migration aligne la base existante sur le diagramme V1 simplifié sans supprimer les données de test.

## Résultat attendu

La base contient exactement les tables métier suivantes :

- `users`
- `services`
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

Les anciennes tables `generated_documents`, `leave_request_history` et `leave_cancellations` sont supprimées uniquement après migration de leur contenu vers `documents`, `audit_logs` et `leave_requests`.

## Ordre obligatoire

1. Arrêter le backend NestJS.
2. Remplacer le projet par la version corrigée.
3. Ouvrir PowerShell dans le dossier `backend`.
4. Exécuter :

```powershell
powershell -ExecutionPolicy Bypass -File .\database\scripts\run-schema-migration.ps1
```

Le script crée d'abord un dump SQL dans `database/backups`, puis applique la migration.

5. Vérifier la compilation :

```powershell
npm run build
```

6. Relancer le backend :

```powershell
npm run start:dev
```

## Restauration en cas d'échec

Le script affiche le chemin exact du backup. Pour restaurer :

```powershell
Get-Content -Raw .\database\backups\NOM_DU_BACKUP.sql | mysql -u root gestion_conges_gmes
```

Adaptez les paramètres MySQL si votre compte possède un mot de passe.

## Points migrés sans perte

- Les noms de colonnes passent en `snake_case`.
- Les identifiants et clés étrangères passent en `BIGINT`.
- Les catégories `CONGE` et `ABSENCE` deviennent `DEMANDE_CONGE` et `DECLARATION_ABSENCE`.
- Les anciens PDF sont recopiés dans `documents` avec `PDF_VALIDATION` ou `PDF_ANNULATION`.
- L'ancien historique des demandes est recopié dans `audit_logs`.
- Une éventuelle table d'annulation est fusionnée dans les colonnes de `leave_requests`.
- Les anciens réglages d'acquisition sont conservés dans `audit_logs` et `settings` avant retrait des colonnes non prévues dans le diagramme.
- Les mois des anciennes acquisitions restent conservés dans le motif et l'audit avant retrait des colonnes techniques non prévues dans le diagramme.

Ne réactivez pas `synchronize: true`. Le projet corrigé utilise `synchronize: false` afin que TypeORM ne modifie plus silencieusement la structure.
