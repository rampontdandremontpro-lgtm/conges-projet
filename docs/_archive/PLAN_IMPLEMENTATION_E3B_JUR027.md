# JUR-027 — Plan d'implémentation E3-B (raccordement réel au système GMES)

**Date** : 28/10/2026
**Statut** : **analyse et plan uniquement — aucune intégration réalisée.** JUR-027 reste « Bloqué ».

---

## 1. Architecture actuelle (constatée dans le code)

### 1.1 Modèle de comptabilisation réel

Le code actuel applique le modèle **« Validées → Pris au début effectif »** :

- `reservePaidLeaveForRequest()` (leave-balances.service.ts:1010) est **du code mort** : aucune méthode ne l'appelle. La réservation à la validation n'existe plus.
- `releasePaidLeaveReservationForRequest()` (1146) est conservé **uniquement pour compatibilité** (libère d'éventuelles réservations héritées) : il est appelé à la validation finale, au refus, à l'annulation avant décision et à l'expiration, mais ne libère rien dans le modèle courant.
- `applyPaidLeaveForRequest()` (1389) est **l'unique point de débit** : impute N-1 puis N via `allocatePaidLeave(expectedDays, [nMinus1], n)`, idempotent (contrôle des `DEDUCTION` existants), avec garde de période clôturée.
- `recreditPaidLeaveForCancelledRequest()` (1553) est **l'unique point de restitution** (annulation après validation), imputant le solde net des `DEDUCTION`.

### 1.2 Cycle de vie d'une demande

| Étape | Méthode | Effet sur les soldes |
|---|---|---|
| Soumission | `submit()` | aucun débit, aucune réservation |
| 1ᵉʳ niveau de validation | `validateRequest()` (branche `isFirstLevel`) | aucun débit, transmission au 2ᵉ niveau |
| Validation finale | `validateRequest()` (branche finale) | `releasePaidLeaveReservationForRequest` (no-op) ; si `startDate <= today` → `applyPaidLeaveForRequest` ; sinon `balanceProcessingStatus = DEMANDE_ACTUELLE` / `CONGE_PREVISIONNEL` (aucun débit) |
| Début effectif | `consolidateValidatedLeaves()` (scheduler, 1 h) | `applyPaidLeaveForRequest` (débit) |
| Refus | `refuseRequest()` | `releasePaidLeaveReservationForRequest` (no-op) |
| Annulation avant décision | `cancelBeforeDecision()` | `releasePaidLeaveReservationForRequest` (no-op) |
| Annulation après validation | `completeCancellationAfterValidation()` | si `DEFINITIF` → `recreditPaidLeaveForCancelledRequest` ; sinon rien |
| Expiration sans décision | `expireRequest()` (scheduler) | `releasePaidLeaveReservationForRequest` (no-op) |

**Règle impérative conservée** : un congé futur validé **n'est jamais débité** ; le débit a lieu au début effectif (scheduler) ou à la validation finale si le congé a déjà commencé.

## 2. Les quatre circuits GMES (vérifié dans `validator-resolution.service.ts`)

`resolveCircuit()` pour un collaborateur GMES interne :

| Circuit | Conditions | `kind` | 1ᵉʳ valideur | 2ᵉ valideur |
|---|---|---|---|---|
| C1 | sans responsable, sans dérogation | `RH_DIRECTEUR` | RH | Directeur |
| C2 | avec responsable, sans dérogation | `RESPONSABLE_RH` | Responsable | RH |
| C3 | sans responsable, **avec** dérogation | `RH_DIRECTEUR` | RH | Directeur |
| C4 | avec responsable, **avec** dérogation | `RH_RESPONSABLE` | RH | Responsable |

**Conclusion vérifiée** : C1 et C3 partagent le même circuit `RH_DIRECTEUR` (la dérogation modifie le traitement de la dérogation via `grantDerogationOnRhFirstValidation`, pas l'ordre des valideurs). **Les quatre circuits convergent tous vers `validateRequest()`** et appliquent **exactement la même logique de soldes** (branche finale de `validateRequest`). Aucun changement spécifique à un circuit n'est nécessaire : le point d'intégration est **unique et transversal**.

## 3. Points de branchement exacts

Le moteur unifié E3-A est **lot-only**. Le raccordement consiste à rendre **lot-aware** les deux méthodes comptables réelles, sans toucher aux circuits ni au scheduler :

| Méthode | Changement cible |
|---|---|
| `applyPaidLeaveForRequest()` (leave-balances.service.ts:1389) | après le contrôle d'idempotence et de clôture, si le flag `CARRYOVER_LOTS_ENABLED` est actif ET si des journées datées sont fournies : verrouiller les lots N-1, répartir via `allocateCarryoverLots`, écrire les `DEDUCTION` de lots via `ledger.writeLotMovementsWithManager`, puis imputer les jours `uncovered` sur N-1/N via `allocatePaidLeave`. Sinon : comportement actuel (rétro-compatible). |
| `recreditPaidLeaveForCancelledRequest()` (1553) | restaurer les lots consommés via `ledger.restoreWithManager()` (ou `restoreLotAfterConsumptionWithManager` par mouvement lot), puis recréditer les `DEDUCTION` ordinaires restants. La somme lot + ordinaire doit égaler `expectedDays`. |
| Appelants de `applyPaidLeaveForRequest` | transmettre les **journées datées** (dates effectives) : scheduler `consolidateValidatedLeaves()` (338), `validateRequest()` (2047), `createRhDirectLeave()` (380), `createDirectorRequest()` (558). |

### 3.1 Signature proposée

```ts
applyPaidLeaveForRequest(manager, {
  employeeId, leaveRequestId, actorId, expectedDays, referencePeriod,
  requireSufficientBalance?,
  datedDays?: DatedLeaveDay[],   // NOUVEAU : journées datées (0.5/1)
})
```

`datedDays` est calculé par l'appelant via `calculateDeductedLeaveDayList(startDate, endDate, startPeriod, endPeriod, nonDeductibleDates)` (déjà partagé, E1) + `HolidaysService.findNonDeductibleBetween()`. Absent → chemin ordinaire actuel (aucune régression).

### 3.2 Dépendance de module

`LeaveBalancesService` devra injecter `CarryoverLotLedgerService`. `LeaveBalancesModule` importera `CarryoverLotsModule` (qui exporte déjà le ledger). Aucune dépendance circulaire (CarryoverLotsModule n'importe pas LeaveBalancesModule).

## 4. Transactions communes (lot + ordinaire + mouvements + audit)

- **Une seule transaction** `dataSource.transaction` englobe : lecture verrouillée de la demande, débit des lots, débit ordinaire, mise à jour `balanceProcessingStatus`, mouvements, audit, notification (comme aujourd'hui dans `consolidateValidatedLeaves`/`validateRequest`).
- **Idempotence** : le contrôle existant des `DEDUCTION` dans `applyPaidLeaveForRequest` s'exécute AVANT toute écriture ; un rejeu du scheduler renvoie le résultat déjà consolidé (aucun double débit). Le ledger conserve la contrainte `UQ_lot_allocations_request_lot_op`.
- **Cohérence après redémarrage** : `consolidateValidatedLeaves` relit les demandes `VALIDEE` non `DEFINITIF` à chaque maintenance ; un redémarrage ne rejoue que ce qui n'a pas abouti (status `DEFINITIF` posé dans la même transaction que le débit).
- **Reprise après échec** : toute exception → rollback intégral (lots + ordinaire + statut + audit), la demande reste non-`DEFINITIF` et sera retentée au cycle suivant.
- **Concurrence scheduler / RH** : la demande est verrouillée `pessimistic_write` avant décision/débit ; le statut `DEFINITIF` et le contrôle `DEDUCTION` sérialisent les deux chemins (un seul gagnant).
- **Ordre de verrouillage SQL (harmonisé E3-A)** : lots → compteurs (pour réserve/consommation directe) ; compteurs → mouvements (pour consommation de réservation / libération). `restore` garde `balance_movements → lots → compteurs` (résidu documenté).
- **`ER_LOCK_DEADLOCK`** : stratégie à implémenter = **réessai borné** (3 tentatives, backoff court) au niveau des méthodes publiques, avec traduction en `ConflictException` en cas d'échec persistant. (Prérequis de sécurisation, cf. §7.)

## 5. Règles d'allocation préservées

- **Priorité** : lots maladie **FIFO par échéance** (puis id) ; jours non couverts par les lots → **ordinaire N-1 puis N** (comportement actuel `allocatePaidLeave`). Aucune nouvelle priorité inventée.
- **Distinctions** :
  - `uncovered` = jours non couverts par les lots (à reporter sur l'ordinaire par l'appelant) ;
  - `ordinaryAllocations` = jours effectivement imputés sur N-1/N ;
  - « sans couverture » = si l'ordinaire est insuffisant → `BadRequestException` (jamais d'allocation partielle silencieuse).
- **Demi-journées** (0.5/1), **périodes N-1/N**, **expirations**, **jours gelés** (`frozen_in_balance`), **reliquats incertains** (`remainingDays NULL`) : protégés par le moteur E1/E3-A.

## 6. Décisions métier en attente (BLOQUÉ)

1. **Réservation à la validation vs absence de réservation** : le code actuel ne réserve PAS (modèle « Validées → Pris au début effectif », `reservePaidLeaveForRequest` est mort). Réintroduire une réservation de lots à la validation est un **choix métier non tranché** — signalé BLOQUÉ. Le plan primaire conserve l'absence de réservation (débit au début effectif uniquement), conforme à la règle « ne pas déplacer le débit vers la validation ».
2. **Priorité de consommation des lots** : consommer les lots maladie **avant** l'ordinaire N-1 (proposition : oui, pour ne pas laisser expirer des droits à échéance proche) — à homologuer.
3. **Restitution après expiration** : gel `frozen_in_balance` (régularisation RH) plutôt que recrédit — à homologuer.
4. **Activation** : derrière `CARRYOVER_LOTS_ENABLED` jusqu'à homologation juridique.

## 7. Prérequis de sécurisation (vérifiables avant activation)

1. **Rollback (trigger)** : le test doit vérifier le code SQL `ER_SIGNAL_EXCEPTION` (45000) et un message de trigger explicite, et prouver que l'erreur survient **après une écriture réelle sur les lots** (1ᵉʳ mouvement lot inséré, 2ᵉ mouvement ordinaire rejeté) → 0 écriture résiduelle. Trigger supprimé en `finally`.
2. **Concurrence** : recette avec transactions réellement chevauchantes (`Promise.allSettled`), contrôle des mouvements finaux (1 seul `DEDUCTION`), et gestion explicite des `ER_LOCK_DEADLOCK` (code 1213) par réessai borné.
3. **E2E scheduler** : remplacer l'attente fixe de 1,5 s de `app.e2e-spec.ts` par une maîtrise déterministe du cycle de vie (ex. exposer/observer la fin de la maintenance initiale, ou désactiver le bootstrap du scheduler dans le contexte de test) — sans modifier le fonctionnement métier du scheduler.
4. **Primitives du ledger** : déjà renforcées en E3-A (lot ET compteur du bon salarié, quantités valides, erreurs explicites, transaction + audit). À re-vérifier sur le chemin réel.

## 8. Risques de régression

- `applyPaidLeaveForRequest` est appelé par **tous** les circuits + scheduler + congés RH directs + congés directeur : tout changement doit être **rétro-compatible** (`datedDays` optionnel, fallback ordinaire).
- Le chemin ordinaire actuel (sans flag / sans `datedDays`) doit rester **bit-à-bit identique** (tests L3-L7 inchangés).
- La période clôturée (`REFERENCE_PERIOD_CLOSED_*`) reste bloquante pour toute imputation (lot comprise).
- `recreditPaidLeaveForCancelledRequest` doit préserver l'invariant `total recrédité === expectedDays` (lot + ordinaire).

## 9. Sous-étapes d'implémentation (autorisation séparée, ordre corrigé)

- **E3-B.1A** (autorisée, réalisée) : préparation technique et contrat des journées datées — `calculateDeductedLeaveDayList` réutilisé, `sumDatedDays` + `buildDatedLeaveDays` (cohérence `deductedDays`), protections du ledger (propriété lot/compteur), tests de rollback renforcés, E2E déterministe, ordre canonique de verrouillage documenté. **Aucun raccordement réel.**
- **E3-B.1B** : moteur de répartition lots + ordinaires **isolé** (sans activation réelle) — une primitive testable qui, à partir de `datedDays`, produit le plan lot + ordinaire et écrit les mouvements, réutilisée plus tard par le point de débit réel.
- **E3-B.2** : raccordement atomique aux points de débit réels et à **tous leurs appelants**, derrière une activation **désactivée par défaut** (`CARRYOVER_LOTS_ENABLED=false` en prod).
- **E3-B.3** : traitement cohérent des annulations et restitutions (recrédit ordinaire + restitution des lots).
- **E3-B.4** : concurrence, non-régression et recette intégrée (matrice R1-R16).
- **E3-B.5** : homologation métier et décision d'activation.

Les décisions métier (priorité des lots, réservation éventuelle à la validation, restitution après expiration) restent **BLOQUÉES** jusqu'à validation explicite.

## 10. Matrice de recette E3-B (à exécuter en E3-B.5)

Date métier évaluée en `America/Martinique` (`martiniqueDateString`). Tous les scénarios sur `gestion_conges_gmes_test`, flag `CARRYOVER_LOTS_ENABLED=true`. Pour chaque scénario : compteurs avant/après, mouvements SQL (`RESERVATION`/`DEDUCTION`/`RECREDIT`/`LIBERATION_RESERVATION`), `lot_allocations`, statut de demande, audit.

| # | Scénario | Avant (ex.) | Après attendu | Preuves |
|---|---|---|---|---|
| R1 | C1 — futur validé (RH→Directeur), lot 2 j + ordinaire 1 j | lot 2/2, N-1 5, N 10 | **aucun débit à la validation** ; statut VALIDEE, `CONGE_PREVISIONNEL`/`DEMANDE_ACTUELLE` | 0 mouvement |
| R2 | C1 — début effectif (scheduler) | lot 2/2, N-1 5, N 10 | lot 0, N-1 −2 lot −1 ordinaire, N inchangé | 2 `DEDUCTION` (1 lot + 1 ordinaire), 1 `CONSUMPTION`, audit `LEAVE_BALANCE_CONSOLIDATED`, `DEFINITIF` |
| R3 | C2 — futur validé (Responsable→RH) | — | aucun débit à la validation | idem R1 |
| R4 | C3 — dérogation, futur validé | — | aucun débit ; dérogation accordée | dérogation + statut |
| R5 | C4 — dérogation, futur validé (RH→Responsable) | — | aucun débit | idem R1 |
| R6 | Congé débutant aujourd'hui, validation finale | lot 2/2 | débit immédiat (lot + ordinaire), `DEFINITIF` | idem R2, sans scheduler |
| R7 | Demi-journées (0,5 + 0,5) réparties sur 2 lots | lot1 0.5, lot2 0.5 | chaque lot −0.5, `totalLotDays=1` | 2 `CONSUMPTION` |
| R8 | Réservation mixte (lot insuffisant) | lot 1/1, demande 3 j | lot −1, ordinaire −2 | 1 `CONSUMPTION` + 1 `DEDUCTION` ordinaire |
| R9 | Refus avant début effectif | — | aucun débit, aucun lot consommé | statut REFUSEE, 0 mouvement |
| R10 | Annulation avant début effectif | — | aucun débit | statut ANNULEE, 0 mouvement |
| R11 | Annulation après débit (lot consommé) | lot 0, N-1 débité | lot restauré, N-1 recrédité | `RECREDIT` + `ANNULATION` lot |
| R12 | Annulation après expiration du lot | lot EXPIRE | **pas de recrédit lot** → `REGULARISATION` | `REGULARISATION`, compteur recrédité |
| R13 | Expiration sans décision (scheduler) | — | aucun débit | statut EXPIREE_NON_VALIDEE |
| R14 | Scheduler exécuté 2× (même demande) | — | un seul débit (idempotence) | 1 `DEDUCTION`, `DEFINITIF` |
| R15 | Concurrence scheduler + validation RH (même demande) | — | un seul gagnant | 1 `DEDUCTION`, l'autre → conflit/réessai |
| R16 | Période clôturée | — | refus `BadRequestException` | 0 mouvement |

---

**Aucune intégration réalisée. Aucun changement des circuits C1-C4 ni du scheduler. Base réelle `gestion_conges_gmes` intouchable. L6 F8/F9/F10 reste ouvert (correction indépendante). JUR-027 reste « Bloqué ». STOP — attendre l'autorisation pour E3-B.1.**
