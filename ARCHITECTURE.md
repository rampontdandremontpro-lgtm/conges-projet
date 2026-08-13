# Architecture actuelle — GMES Gestion des congés et des absences

Ce document décrit l'état réel du projet après la mise en place du frontend Collaborateur et des évolutions E6.

## Vue d'ensemble

```text
Frontend React + Vite
        ↓ Axios / API REST
Backend NestJS + TypeORM
        ↓
MySQL
        ↘ stockage des documents / PDF
        ↘ jours fériés Martinique
        ↘ Microsoft Graph (prévu en fin de projet)
```

## Frontend

### Espace Collaborateur fonctionnel

```text
frontend/src/pages/collab/
├── DashboardPage.jsx
├── NewRequestPage.jsx
├── MyRequestsPage.jsx
├── RequestDetailPage.jsx
├── DeclareAbsencePage.jsx
├── DocumentsPage.jsx
├── HistoryPage.jsx
└── NotificationsPage.jsx
```

Routes principales :

```text
/app/dashboard
/app/new-request
/app/new-request/:id
/app/my-requests
/app/my-requests/:source/:id
/app/declare-absence
/app/declare-absence/:id
/app/my-documents
/app/history
/app/notifications
```

Les anciennes URLs restent temporairement redirigées pour éviter les liens cassés :

```text
/app/my-balances      -> /app/history
/app/my-justificatifs -> /app/my-documents
/app/documents        -> /app/my-documents
```

### Organisation fonctionnelle du Collaborateur

- **Tableau de bord** : situation actuelle du solde, acquisition, jours réservés et disponible après réservations.
- **Nouvelle demande** : création et modification des demandes de congé.
- **Mes demandes** : demandes de congé et déclarations d'absence, avec détails et actions selon le statut.
- **Déclarer une absence** : création et modification d'une déclaration d'absence et dépôt de justificatifs.
- **Mes documents** : justificatifs et PDF officiels réunis dans une seule page.
- **Historique** : mouvements de solde réels, sur le principe d'un relevé bancaire.
- **Notifications** : notifications réelles du backend.

L'ancienne page `BalancesPage.jsx` a été supprimée. Elle doublonnait les informations déjà affichées sur le Tableau de bord. La logique métier des soldes reste néanmoins indispensable côté backend et base de données.

### Services de soldes côté frontend

- `frontend/src/services/dashboard.js` récupère l'état actuel via `/leave-balances/my` pour le Tableau de bord.
- `frontend/src/services/balances.js` récupère uniquement l'historique via `/leave-balances/my/history`.

## Backend

Modules actuels :

```text
absence-declarations
audit
auth
derogations
documents
exports
holidays
leave-balances
leave-requests
leave-types
notifications
presence
reports
services
settings
users
validators
```

Le module `leave-balances` reste nécessaire même si la page frontend « Mes soldes » n'existe plus. Il gère notamment :

- acquisition mensuelle ;
- solde courant ;
- réservations des demandes en attente ;
- déduction après validation ;
- libération/recrédit ;
- corrections RH ;
- historique des mouvements.

## Base de données

Le schéma de référence contient actuellement **15 tables** :

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
service_backup_validators
validator_replacements
```

### Soldes : distinction essentielle

`leave_balances` et `balance_movements` doivent toutes les deux être conservées.

```text
leave_balances
    ↓
état actuel du compte de congés
    ↓
Tableau de bord
```

```text
balance_movements
    ↓
historique des crédits / débits / corrections
    ↓
Page Historique
```

`leave_balances` est l'équivalent du **solde bancaire actuel**.
`balance_movements` est l'équivalent du **relevé des opérations**.

Une demande de congés payés en attente réserve des jours mais ne diminue pas encore le solde réel. Le débit définitif apparaît lors de la validation.

## E6 — Valideurs et remplacements

Deux mécanismes distincts sont présents dans le modèle :

- `service_backup_validators` : valideurs de secours rattachés à un service ;
- `validator_replacements` : remplacement temporaire rattaché à un collaborateur précis et à une période bornée.

Ces tables restent nécessaires dans la base de données.

## État des autres espaces

Les rôles Responsable de service, RH, Directeur et Admin sont déjà déclarés dans la navigation et les protections de routes, mais leurs écrans fonctionnels seront implémentés progressivement. Les écrans non encore réalisés restent en prévisualisation.

## Nettoyage effectué

Les anciens fichiers exclusivement liés à la page « Mes soldes » ont été retirés :

```text
frontend/src/pages/collab/BalancesPage.jsx
frontend/src/components/collab/balances/BalanceOverview.jsx
frontend/src/components/collab/balances/BalanceMetric.jsx
frontend/src/styles/balances.css
frontend/src/styles/collab/balances/01-page.css
frontend/src/styles/collab/balances/02-responsive.css
```

Aucune table de base de données n'a été supprimée dans ce nettoyage.
