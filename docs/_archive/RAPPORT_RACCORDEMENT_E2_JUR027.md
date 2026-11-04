# JUR-027 — Rapport E2 (gestion transactionnelle des lots maladie)

**Date** : 28/10/2026
**Statut** : **E2 terminé** — composant transactionnel isolé, sans branchement aux circuits. JUR-027 reste « Bloqué ».

---

## 1. Fichiers modifiés / créés

| Fichier | Action |
|---|---|
| `backend/src/leave-balances/carryover-lots/carryover-lot-ledger.service.ts` | **créé** — `CarryoverLotLedgerService` (opérations transactionnelles sur lots) |
| `backend/src/leave-balances/carryover-lots/carryover-lots.module.ts` | enregistré + exporté le ledger |
| `backend/test/carryover-lot-ledger.e2e-spec.ts` | **créé** — 14 tests e2e isolés sur `gestion_conges_gmes_test` |

Aucune modification de `applyPaidLeaveForRequest()`, des méthodes de réservation/libération/restitution des congés, du scheduler, ni des circuits C1-C4.

## 2. Fonctions créées (signatures internes, sans endpoints RH)

`CarryoverLotLedgerService` :

| Méthode | Rôle |
|---|---|
| `reserve({ employeeId, leaveRequestId, datedDays, actorId?, reason? })` | réserve des journées datées sur les lots consommables (FIFO échéance) |
| `consume({ leaveRequestId, actorId?, reason? })` | transforme une réservation en débit effectif (réservation → consommation) |
| `release({ leaveRequestId, actorId?, reason? })` | libère une réservation (refus/expiration), restitue le lot |
| `restore({ leaveRequestId, actorId?, reason? })` | recrédite les jours consommés (annulation après débit) |

Chaque opération est **atomique** (`dataSource.transaction`), **idempotente** (contrôle de mouvements existants + contrainte unique `UQ_lot_allocations_request_lot_op` + verrous `pessimistic_write`), et assure **rollback intégral** en cas d'erreur.

## 3. Règles préservées

- Réutilisation du moteur pur E1 (`allocateCarryoverLots`, `isLotConsumable`, `calculateDeductedLeaveDayList` via l'appelant).
- **Jamais plus de jours consommés qu'un lot n'en possède** (reliquat verrouillé, cap par `remainingDays`).
- **Lots expirés / suspendus / à vérifier / reliquat inconnu → jamais mobilisés** (skippés).
- **Jours maladie ≠ jours ordinaires** : les jours non couverts sont retournés en `uncovered` ; ce composant ne crée **jamais** de jours ordinaires.
- **Demi-journées** (0.5) et **multi-périodes / multi-échéances** (FIFO sans mélange).
- **Traçabilité** : `balance_movements` (RESERVATION / DEDUCTION / LIBERATION_RESERVATION / RECREDIT) + `lot_allocations` (RESERVATION / CONSUMPTION / ANNULATION / REGULARISATION) + audit.
- **Expiration pendant réservation/restitution** → `REGULARISATION` (gelée `frozenInBalance`), jamais de recrédit silencieux.

## 4. Résultats des tests

### 4.1 Tests e2e isolés (`carryover-lot-ledger.e2e-spec.ts`) — 14/14 OK

| Cas | Assertion SQL principale |
|---|---|
| Réservation valide | lot 2→0, `reserved_days` 0→2, `available_days` inchangé, 1 mouvement `RESERVATION` |
| Consommation valide | `reserved_days` 2→0, `consumed_days` 0→2, `available_days` 10→8, 1 `DEDUCTION` |
| Libération | lot 0→2, `reserved_days` 2→0, `available_days` inchangé, 1 `LIBERATION_RESERVATION` |
| Restitution | lot 0→2, `consumed_days` 2→0, `available_days` 8→10, 1 `RECREDIT` |
| Opération répétée | 2e `reserve` → 409 ; exactement 1 mouvement + 1 allocation (aucun doublon) |
| Deux opérations simultanées sur le même lot | `Promise.allSettled` : 1 succès + 1 rejet ; 1 seul mouvement `RESERVATION` |
| Solde insuffisant | lot 1 j pour 2 j demandés → `totalLotDays=1`, `uncovered=[1 j]`, lot jamais négatif |
| Lot expiré (`EXPIRE`) | skippé (`STATUT_EXPIRE`), `totalLotDays=0` |
| Lot suspendu (`SUSPENDU`) | skippé (`STATUT_SUSPENDU`) |
| Lot gelé/à vérifier (`A_VERIFIER`) | skippé (`STATUT_A_VERIFIER`) |
| Reliquat inconnu (`remaining_days NULL`) | skippé (`RELIQUAT_INCONNU`) |
| Plusieurs lots, échéances différentes | `allocations[0].lotId` = lot à échéance la plus proche, puis le suivant |
| Demi-journée | `totalLotDays=0.5`, lot 2→1.5 |
| Erreur → rollback | compteur absent en cours de boucle → 400 ; lot1/lot2 inchangés, **0 mouvement, 0 allocation** |

### 4.2 Non-régression

| Vérification | Résultat |
|---|---|
| TypeScript + build | **exit 0** |
| Suite Jest unitaire | **30 suites / 441 passés / 38 skip / 0 échec** |
| L3 / L4 / L4-final / L4-isolation / L5-unified / L6-final / L7 | **29/29 · 16/16 · 13/13 · 11/11 · 10/10 · 18/18 · 12/12 OK** |

## 5. Anomalies et corrections

- **Aucune anomalie métier du ledger.** Les 14 cas e2e passent.
- **Flakiness constatée hors périmètre** : `retest-l6-final.mjs` (F8 « Transmission puis réception successives », F9/F10 en cascade) peut échouer de façon **transitoire** (sensible à l'horloge : `receivedAt` vs `transmitted_at`). Relancé, il repasse à **18/18**. Ce test ne dépend pas du ledger E2 (aucun lien avec la notification/dates) ; il est signalé comme réserve ouverte de robustesse de test, pas comme régression.

## 6. Risques restant ouverts

- Le ledger n'est **pas encore branché** à `leave-balances` (E3) : `uncovered` devra être traité par l'allocation ordinaire N-1/N existante.
- Le ledger est **volontairement sans gate d'environnement** (appel interne) ; la garde reste à la charge de l'appelant.
- La délégation éventuelle du service L4 de recette vers ce ledger (anti-duplication) est **reportée** hors E2 pour ne pas risquer les suites L4 déjà validées.

## 7. Points à décider avant E3

1. Signature de raccordement : `applyPaidLeaveForRequest` appelle `reserve` puis `consume` (ou directement `consume` sur réservation) au début effectif ; les jours `uncovered` retombent sur `allocatePaidLeave` (N-1 puis N).
2. Moment de réservation (validation vs début effectif) et restitution après expiration (`frozenInBalance` vs recrédit) — homologation RH attendue.
3. Activation derrière `CARRYOVER_LOTS_ENABLED` jusqu'à validation juridique.

---

**E2 terminé. E3-E6 non entamés. JUR-027 reste « Bloqué ». Aucun commit/push. Base réelle `gestion_conges_gmes` intouchée (aucune table L5/L6, ports 3000/5173 non démarrés).**
