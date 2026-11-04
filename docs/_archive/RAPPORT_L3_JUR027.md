# JUR-027 — Rapport du lot L3 (gestion individualisée des reports) — v2

**Date** : 27/10/2026 — **version 2 (corrections ciblées intégrées)**
**Périmètre** : enregistrement, consultation et traçabilité des lots de congés reportés pour maladie, en recette isolée (`gestion_conges_gmes_test`, API 3001). Aucune consommation, expiration, clôture ou notification branchée.
**Statut** : **JUR-027 reste « Bloqué ».**

---

## 1. Corrections apportées (v2)

### A. Confirmation de dates futures interdite
- `confirm` refuse toute `informationDate > today` (réception future) et toute `repriseDate > today`, ainsi qu'une information antérieure à la reprise (`validateConfirmationChronology`).
- Une date future reste **enregistrable à la création comme donnée prévisionnelle** (échéance indicative uniquement), jamais comme preuve reçue.
- Aucun `expiresAt` définitif n'est produit à partir d'une réception non établie.

### B. Confirmation RH réellement sécurisée
- La simple présence d'un `proofId` ne confirme **jamais** `informationDateCertain = true`.
- `confirm` vérifie : document **existant** ; document **rattaché au salarié** (contrôle `uploaded_by_id` : rejet si c'est un autre salarié non-RH) ; chronologie ; conditions L3141-19-2 pour ARRET_LONG.
- Le modèle documentaire actuel ne permettant pas de démontrer le contenu d'une réception datée, la conversion en échéance **définitive est DÉSACTIVÉE** : `confirm` enregistre `confirmationStatus = 'EN_ATTENTE'` + `proofId` + justification, le lot reste `A_VERIFIER`, **sans `expiresAt`**. La validation juridique définitive est reportée à un processus RH ultérieur (L6/L7).

### C. Modifications concurrentes réellement protégées
- **Vérification du SQL produit** : le `@VersionColumn` de la version TypeORM utilisée (fork 1.1.0) ne produit **pas** de `WHERE version` (constaté : `SET version = ? WHERE id = ?` sans contrôle). Il a donc été **remplacé par un `@Column` + UPDATE conditionnel explicite**.
- `saveWithAudit` exécute désormais, dans une transaction : `UPDATE carryover_lots SET ..., version = version + 1 WHERE id = :id AND version = :version`, puis vérifie `affected` ; **0 ligne → 409**. L'audit avant/après est enregistré **dans la même transaction** (une modification ne peut être validée sans son historique).
- SQL réellement produit (vérifié) : `UPDATE carryover_lots SET days = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND version = ?` → `AFFECTED=0` en cas de version obsolète.

### D. Isolation renforcée
- Accès L3 exige **simultanément** : `CARRYOVER_LOTS_ENABLED=true` **ET** `dataSource.options.database === 'gestion_conges_gmes_test'` **ET** rôle RH (`isCarryoverLotsEnvironmentAllowed`). Sinon **404** (flag/db) ou **403** (rôle), avant toute requête métier.
- Le feature flag seul n'est plus suffisant.

### E. Idempotence et périodes
- `idempotencyKey` est **obligatoire** à la création (400 sinon).
- Même clé + mêmes données → **rejeu idempotent** (lot existant retourné, aucun doublon). Même clé + données différentes → **409**.
- Créations simultanées même clé → **un seul lot** (index unique + gestion `ER_DUP_ENTRY`).
- **ARRET_LONG** : la date exacte de fin de période de référence est **figée** dans `reference_period_end_date` à la création ; un changement ultérieur de `REFERENCE_PERIOD_START` ne recalcule pas l'échéance (testé). Toute correction passe par `update` (justification + audit).
- **Périmètre RH** : les RH de GMES disposent volontairement d'un **accès global** (cohérent avec les endpoints existants `leave-balances`). Règle documentée et testée (accès aux lots de plusieurs salariés).

## 2. Fichiers

| Fichier | Rôle |
|---|---|
| `backend/src/leave-balances/carryover-lot.entity.ts` | + `confirmation_status`, `reference_period_end_date` ; `version` en `@Column` (plus `@VersionColumn`) |
| `backend/src/leave-balances/carryover-lots/carryover-lots.service.ts` | moteur L2 réutilisé, garde-fous, UPDATE conditionnel + transaction, confirmation en attente |
| `backend/src/leave-balances/carryover-lots/carryover-lots.service.spec.ts` | 12 tests unitaires (isolation, moteur, chronologie, 409) |
| `backend/src/leave-balances/carryover-lots/dto/create-carryover-lot.dto.ts` | `idempotencyKey` obligatoire |
| `backend/src/database/migrations/20261027091500-add-carryover-lot-confirmation.ts` | migration additive L3b (**non enregistrée**) |
| `tests/recette/scripts/l3-migrate.mjs` | runner manuel L3+L3b (garde-fou, idempotent) |
| `tests/recette/scripts/retest-l3.mjs` | tests d'intégration (29 assertions) |

## 3. Résultats réellement obtenus

| Vérification | Résultat |
|---|---|
| Intégration L3 (`retest-l3.mjs`) | **29/29 OK** |
| Tests unitaires L3 (`jest carryover-lots`) | **12/12 OK** |
| L2 (`jest carryover-expiry`) | **51/51 OK** |
| Suite backend complète (`jest --runInBand`) | **28 suites / 397 passés, 38 skip, 0 échec** |
| TypeScript (`tsc --noEmit -p tsconfig.json`) | **exit 0** |
| **4 circuits de validation** (`retest-circuits-gmes`) | **50/50 conforme** (couverture individuelle prouvée) |
| Non-régression : L3141 (11+18), JUR-027 (24+7+12), preview (17+3), clôture (7) | **tous OK** |
| Sans flag / mauvaise base (isolation) | 404 ; non-RH 403 |

## 4. Preuve « aucun solde modifié »

Le test L3 capture avant/après : sommes `acquired/reserved/consumed/available` **identiques**, compteur et somme des `balance_movements` **identiques**, mouvements `REPORT_EXCEPTIONNEL*` **identiques**. Aucun mouvement créé par L3.

## 5. Base réelle intacte

`gestion_conges_gmes` : **pas de `carryover_lots`**, 0 migration `CarryoverLot`. Aucune migration enregistrée dans `app.module.ts` (les migrations L1/L3/L3b sont appliquées manuellement, uniquement sur la base de recette). Serveurs 3000/5173 **non démarrés**.

## 6. Limitations restantes (L4+)

- Consommation FIFO, recrédit, expiration automatique, protection à la clôture : **non développés**.
- Validation documentaire approfondie (contenu de la réception, informations obligatoires L3141-19-3) : **désactivée** — confirmation conservée « en attente », aucune échéance définitive tant que le processus RH de validation n'est pas implémenté.
- Anciens reports : aucun backfill, inventaire L1 en lecture seule, aucune requalification automatique.

**Aucun commit ni push. JUR-027 reste « Bloqué ». STOP — L4 non entamé.**
