# JUR-027 — Plan d'implémentation du raccordement automatique des lots maladie aux circuits GMES

**Date** : 28/10/2026
**Statut** : **analyse et plan uniquement** — aucune implémentation. JUR-027 reste « Bloqué ».

---

## 1. Architecture actuelle (constatée dans le backend)

### 1.1 Cycle de vie d'une demande de congé
- **Création / brouillon** : `leave-requests.controller.ts` → `leave-requests.service.ts`.
- **Soumission** : `POST /leave-requests/:id/submit` → `leave-requests.service.ts`.
- **Validation** (4 circuits) : `POST /leave-requests/:id/validate` → `leave-requests.service.ts` (rôles RH / RESPONSABLE_SERVICE / DIRECTEUR). Les circuits (C1→C4) sont déterminés par le service (`validationMode`, `primaryManagerId`) et la dérogation.
- **Refus** : `POST /leave-requests/:id/refuse`.
- **Annulation** : `POST /leave-requests/:id/cancel` (+ `cancellation-request/consent/complete`).
- **Débit effectif** : `LeaveRequestSchedulerService.runMaintenance()` (toutes les heures) → `consolidateValidatedLeaves(today)` : pour toute demande `VALIDEE` dont `startDate <= today` et `balanceProcessingStatus != DEFINITIF`, appelle `LeaveBalancesService.applyPaidLeaveForRequest(...)`.

### 1.2 Méthodes exactes concernées (fichier : `backend/src/leave-balances/leave-balances.service.ts`)
| Méthode | Rôle | Appelée par |
|---|---|---|
| `reservePaidLeaveForRequest` (l.1010) | réserve des jours (mouvement `RESERVATION`) | validation/soumission |
| `applyPaidLeaveForRequest` (l.1389) | débite les compteurs (`DEDUCTION`) au début effectif ou à la validation immédiate | scheduler `consolidateValidatedLeaves`, `leave-requests.service.ts` |
| `releasePaidLeaveReservationForRequest` (l.1146) | libère une réservation (`LIBERATION_RESERVATION`) | refus / expiration / annulation |
| `recreditPaidLeaveForCancelledRequest` (l.1553) | recrédite après annulation (`RECREDIT`) | annulation |

### 1.3 Allocation ordinaire actuelle
`backend/src/leave-balances/leave-allocation.util.ts` — `allocatePaidLeave(days, nMinus1[], n)` : consomme d'abord les compteurs **N-1** (tri par période), puis **N**. **Cette allocation ignore l'origine « lot maladie » des jours N-1** : c'est le point à compléter.

### 1.4 Planification / traitements automatiques
- `LeaveRequestSchedulerService` (intervalle 1 h) : consolidation des demandes validées, expiration des demandes non validées, rappels J-30→J-1, bascule après-midi (`AFTERNOON_START_HOUR`), statuts de présence, rappels de solde.
- Les écritures sont **transactionnelles** (`dataSource.transaction` + `pessimistic_write`), avec audit (`AuditService`) et notifications applicatives (`NotificationsService` — pas d'envoi externe).

## 2. Outils L4 existants (réutilisables)

`backend/src/leave-balances/carryover-lots/` :
- **`carryover-lot-allocation.util.ts` — `allocateCarryoverLots(datedDays, lots)`** : répartition **FIFO par échéance** de journées datées (demi-journées `0.5`/`1`) sur des lots consommables (`date <= expiresAt`), renvoie `allocations`, `uncovered` (jours ordinaires restants), `skipped` (lots inéligibles), `totalLotDays`. **Réutilisable en l'état.**
- **`carryover-lot-allocation.service.ts`** : `buildPlan` (datation des jours + lots consommables), `writePlan` (écrit compteurs + mouvements + `lot_allocations`), `consume`, `reserve`, `restore`, `finalize`, `release`. Ces méthodes sont **gated recette** (`assertEnvironment` = flag + base test) et **RH uniquement** (`assertRh`) : ce sont des **outils de recette**, pas encore branchés aux circuits.
- **`carryover-lot-closure.core.ts`** : `classifyCarryoverLot` (L2), `buildCarryoverLotPlan`, `applyCarryoverLotPlan` (clôture unifiée) — déjà intégrés à `closeReferencePeriod`.

**Conclusion réutilisation** : l'algorithme `allocateCarryoverLots` et la logique d'écriture `writePlan` (mouvements `DEDUCTION`/`RESERVATION`/`RECREDIT` + `lot_allocations`) doivent être **extraits hors du gate recette/RH** pour être appelés par `applyPaidLeaveForRequest`/`reservePaidLeaveForRequest`/`recreditPaidLeaveForCancelledRequest` en production, **sans dupliquer** la logique. Les endpoints L4 restent des outils de recette.

## 3. Points de raccordement (quand réserver/consommer/libérer/restituer)

| Événement métier | Action sur les lots maladie |
|---|---|
| Soumission / validation (demande future ou immédiate) | **Réservation** des jours sur les lots consommables (FIFO échéance), sans débit (conforme au comportement actuel : pas de débit prématuré). |
| Début effectif du congé (`consolidateValidatedLeaves`) | **Consommation** : imputer en priorité les jours réservés sur les lots (FIFO échéance), puis les jours ordinaires N-1, puis N. |
| Refus / expiration sans validation | **Libération** de la réservation de lots. |
| Annulation (après débit) | **Restitution** : recréditer les lots consommés (dans la limite du reliquat), puis l'ordinaire ; lot expiré entre-temps → `frozen_in_balance` (régularisation RH), jamais de recrédit silencieux. |
| Clôture annuelle | **Expiration/conservation** via `closeReferencePeriod` (déjà unifié L5) : expirés déduits, protégés transférés, incertains bloquent. |

## 4. Changements minimums proposés

1. **Extraire** la répartition lot/ordinaire dans un service interne **non gated** (ex. `CarryoverLotLedgerService`) réutilisant `allocateCarryoverLots` + la datation des jours (déjà dans `carryover-lot-allocation.service.buildPlan`), en acceptant `EntityManager`.
2. **Modifier `applyPaidLeaveForRequest`** : avant l'allocation ordinaire, appeler le ledger pour couvrir les jours datés par les lots N-1 consommables, puis allouer l'`uncovered` sur l'ordinaire N-1/N. Écrire mouvements `DEDUCTION` + `lot_allocations` (opération `CONSUMPTION`) dans la **même transaction**.
3. **Modifier `reservePaidLeaveForRequest`** : réserver les lots (mouvement `RESERVATION` + `lot_allocations` opération `RESERVATION`).
4. **Modifier `releasePaidLeaveReservationForRequest`** et **`recreditPaidLeaveForCancelledRequest`** : libérer/restituer les `lot_allocations` correspondantes (opérations `LIBERATION`/`ANNULATION`), avec `frozen_in_balance` pour les lots expirés au moment de la restitution.
5. **Rendre idempotent** chaque point via l'unicité existante `UQ_lot_allocations_request_lot_op (leave_request_id, lot_id, operation_type)` et les contrôles `existingMovements` / `RECREDIT` existants.

**Aucun changement des circuits C1-C4** (la logique de validation reste inchangée) ; seule la couche de comptabilisation (`leave-balances`) évolue.

## 5. Règles métier à préserver

- Une demande **future validée ne débite rien** (débit uniquement au début effectif).
- **Priorité FIFO par échéance** des lots (`expires_at` croissant) ; une journée datée n'est couverte par un lot que si `date <= expiresAt`.
- Demi-journées : chaque journée datée porte `0.5` ou `1` (répartition exacte, jamais d'arrondi global).
- Ordinaire N-1 avant N (comportement actuel `allocatePaidLeave`).
- Lots **expirés/gelés/reliquat inconnu** : jamais consommés silencieusement (skippés / `frozen_in_balance` / blocage).
- Période **clôturée** : aucune imputation (contrôle `REFERENCE_PERIOD_CLOSED_<période>` déjà en place).

## 6. Risques et protections

| Risque | Protection |
|---|---|
| Double consommation | `existingMovements DEDUCTION` + `UQ_lot_allocations_request_lot_op` + transaction |
| Double restitution | contrôle `RECREDIT`/`ANNULATION` en lecture verrouillée (`pessimistic_write`) |
| Validations concurrentes | verrou `pessimistic_write` sur la demande et les compteurs |
| Traitement automatique exécuté deux fois | `running` guard du scheduler + `balanceProcessingStatus = DEFINITIF` (idempotence) |
| Solde négatif | contrôle de disponibilité existant (optionnel) ; dépassement documenté sur N |
| Lots expirés/gelés/inconnus | `allocateCarryoverLots` skippe ; `frozen_in_balance` ; blocage si origine incertaine |
| Droits multi-périodes | datation par période ; allocation N-1 par période puis lots FIFO |
| Écritures partielles | transaction unique + rollback intégral |
| Audit | `AuditService.record` sur chaque opération (auteur, avant/après) |

## 7. Migrations éventuelles

- **Aucune nouvelle table attendue** : `carryover_lots`, `lot_allocations` existent déjà (migrations L1-L6 en recette).
- Éventuellement : ajout d'un enum `operation_type` si `CONSUMPTION`/`RESERVATION`/`ANNULATION`/`REGULARISATION`/`LIBERATION` ne suffisent pas (vérifier `CarryoverLotAllocationOperation`).
- En production, les migrations `carryover_lots`/`lot_allocations` restent **non enregistrées** dans `app.module.ts` (aucune migration automatique) — à décider avant tout déploiement.

## 8. Tests à réaliser (avant/après chaque étape)

Avant chaque modification : non-régression L6/L5/L4/L3 + circuits 50/50 + Jest.
Après chaque étape :
1. **Réservation** : demande future validée → `RESERVATION` lot (pas de débit), reliquat réduit temporairement.
2. **Consommation** : début effectif → `DEDUCTION` lot FIFO (priorité), puis ordinaire N-1/N ; soldes/mouvements/`lot_allocations` cohérents.
3. **Refus/expiration** → libération exacte.
4. **Annulation après débit** → restitution exacte ; lot expiré entre-temps → `frozen_in_balance`.
5. **Concurrence** : deux consolidations simultanées → une seule ; annulation+consolidation simultanées → un seul gagnant.
6. **Demi-journées** : 0.5 + 0.5 sur deux jours, imputation exacte par lot.
7. **Multi-périodes / multi-lots** : FIFO sans mélange des origines.
8. **Clôture après consommation** : pas de double comptabilisation (jour consommé non re-transféré).

## 9. Plan de retour arrière

- L'intégration est **conditionnée par `CARRYOVER_LOTS_ENABLED`** (flag) et **base de recette** au départ : en désactivant le flag, le comportement ordinaire (`allocatePaidLeave`) est restauré.
- Les nouvelles écritures sont **additives** (mouvements + `lot_allocations`) : un rollback SQL ciblé (suppression des `lot_allocations`/mouvements créés) est possible sans altérer les compteurs.
- Le ledger extrait est **pur** (pas d'état partagé) : réversible par suppression de l'appel.

## 10. Questions nécessitant une décision métier

1. **Priorité de consommation** : les lots maladie (FIFO échéance) doivent-ils être consommés **avant** l'ordinaire N-1 ? (proposition : oui, pour ne pas laisser expirer des droits à échéance proche).
2. **Réservation au moment de la validation** : réserver les lots dès la validation, ou seulement au début effectif ? (proposition : réservation à la validation, débit au début effectif — aligné sur l'existant).
3. **Restitution après expiration** : confirmer le gel `frozen_in_balance` (régularisation RH) plutôt qu'un recrédit automatique.
4. **Activation production** : le raccordement doit-il rester derrière un flag jusqu'à homologation juridique ?
5. **Demi-journées sur un lot** : confirmer la découpe `0.5` par journée datée (pas de fractionnement inférieur).

## 11. Découpage en étapes testables (proposition)

1. **E1** : extraire `CarryoverLotLedgerService` (datation + `allocateCarryoverLots` + `writePlan`) — tests unitaires purs.
2. **E2** : brancher la **consommation** dans `applyPaidLeaveForRequest` (recette, flag) — tests d'intégration.
3. **E3** : brancher la **réservation/libération** dans `reserve/releasePaidLeaveReservationForRequest` — tests.
4. **E4** : brancher la **restitution** dans `recreditPaidLeaveForCancelledRequest` — tests.
5. **E5** : non-régression globale + circuits 50/50 + Jest + build.
6. **E6** : revue métier/juridique + autorisation d'activation.

---

**Aucune implémentation réalisée dans cette intervention. Aucun commit/push. JUR-027 reste « Bloqué ». STOP — attendre une autorisation explicite pour développer le raccordement.**
