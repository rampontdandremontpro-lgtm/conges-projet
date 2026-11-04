# JUR-027 — Rapport E3-A (unification du moteur transactionnel L4/E2)

**Date** : 28/10/2026
**Statut** : **E3-A terminé** — une seule implémentation transactionnelle pour les lots maladie. Aucun raccordement aux circuits GMES. JUR-027 reste « Bloqué ».

---

## 1. Architecture transactionnelle avant / après

**Avant** : `CarryoverLotAllocationService` (L4, gated recette+RH) et `CarryoverLotLedgerService` (E2, interne) dupliquaient l'écriture des mouvements de lots, la restitution à la libération, la restitution après consommation et la transformation réservation→consommation.

**Après** : le ledger est l'autorité unique pour les opérations **lots**. L4 conserve :
- le calcul du plan (lot + ordinaire) via `buildPlan`/`allocateOrdinary` ;
- l'écriture des jours **ordinaires** ;
- les gardes `assertEnvironment`/`assertRh` et les contrôles de statut de demande (`loadRequest`) ;
- ses routes/DTO et réponses API.

Les opérations de lots sont appelées **dans la transaction existante** via des variantes `*WithManager(manager, …)` — aucune transaction imbriquée.

## 2. Fichiers et méthodes modifiés

| Fichier | Changement |
|---|---|
| `backend/src/leave-balances/carryover-lots/carryover-lot-ledger.service.ts` | Réécrit : variantes `reserveWithManager`, `consumeDirectWithManager`, `consumeReservationWithManager`, `releaseWithManager`, `restoreWithManager` ; primitives partagées `writeLotMovementsWithManager`, `restoreLotOnReleaseWithManager`, `restoreLotAfterConsumptionWithManager` ; `consumeDirect` (consommation sans réservation) ; verrouillage anti-deadlock ; date d'opération Martinique |
| `backend/src/leave-balances/carryover-lots/carryover-lot-allocation.service.ts` | `writePlan` (lot) → `ledger.writeLotMovementsWithManager` ; `release`/`finalize` REFUSE (lot) → `ledger.releaseWithManager` ; `finalize` VALIDATE (lot) → `ledger.consumeReservationWithManager` ; `restore` (lot) → `ledger.restoreLotAfterConsumptionWithManager` ; suppression de `restoreReservedLotOnRelease`, `balanceIdForLot`, `todayIso` ; `buildPlan` verrouille les lots avant les compteurs |
| `backend/src/leave-balances/reference-period.util.spec.ts` | test unitaire du calcul de date d'opération `America/Martinique` autour de minuit |
| `backend/test/carryover-lot-ledger.e2e-spec.ts` | +3 tests (demi-journées multi-sources, rollback réel par trigger, gel réel) → 29 tests |
| `backend/test/carryover-lot-l4-ledger.e2e-spec.ts` | **créé** — 3 tests (combiné lots+ordinaire, double comptabilisation, concurrence croisée L4/E2) |

## 3. Duplications supprimées vs subsistantes

**Supprimées (une seule implémentation) :**
- Écriture des mouvements de lots `RESERVATION`/`DEDUCTION` → `writeLotMovementsWithManager`.
- Restitution d'un lot à la libération (expiré → `REGULARISATION` gelée) → `restoreLotOnReleaseWithManager`.
- Restitution après consommation (expiré → `REGULARISATION`, jamais de recrédit silencieux) → `restoreLotAfterConsumptionWithManager`.
- Transformation réservation→consommation → `consumeReservationWithManager`.
- Libération d'une réservation → `releaseWithManager`.

**Subsistantes (hors périmètre ledger, légitimes) :**
- Écriture des mouvements ordinaires (L4 uniquement — le ledger ne traite pas l'ordinaire).
- Recrédit des mouvements `DEDUCTION` ordinaires dans `restore` (L4 uniquement).
- `allocateOrdinary` (répartition N-1 puis N) — propre à L4.

## 4. Anomalies réelles détectées et corrigées

1. **Deadlock « deux VALIDATE simultanés »** : `consumeReservationWithManager`/`releaseWithManager` verrouillaient `lot_allocations` (FOR UPDATE) en premier, puis inséraient dans la même table → deadlock de gap-lock (`ER_LOCK_DEADLOCK`, HTTP 500 au lieu de 409). **Corrigé** : verrouillage des **compteurs d'abord** (ordre déterministe par id), puis contrôle d'unicité. `retest-l4-final` repasse à 409/201.
2. **Deadlock croisé L4/E2** (`L4.consume` vs `ledger.consumeDirect`) : L4 verrouillait les compteurs avant les lots, E2 les lots avant les compteurs. **Corrigé** : `buildPlan` verrouille désormais les **lots avant les compteurs** (ordre identique au ledger).
3. Aucune autre anomalie métier.

## 5. Preuves d'atomicité et de rollback

- Test e2e **trigger** : un `BEFORE INSERT ON lot_allocations` émet `SIGNAL` à la 2ᵉ insertion → la transaction entière est annulée : **0 mouvement, 0 allocation, lots inchangés** (rollback après une écriture SQL réelle).
- Toutes les opérations partagent la transaction de l'appelant (`*WithManager`) : une erreur annule ensemble lots, compteurs, mouvements et audit.

## 6. Résultats détaillés des tests

| Vérification | Résultat |
|---|---|
| TypeScript + build | **exit 0** |
| Jest unitaire | **30 suites / 442 passés / 38 skip / 0 échec** |
| e2e ledger (`carryover-lot-ledger`) | **29/29 OK** |
| e2e unifié (`carryover-lot-l4-ledger`) | **3/3 OK** |
| L3 / L4 / L4-final / L4-isolation / L5-unified / L7 | **29/29 · 16/16 · 13/13 · 11/11 · 10/10 · 12/12 OK** |
| L6-final | **flaky F8** (15/18 sur ce passage, 18/18 sur le précédent) — défaut d'horodatage déjà documenté, **non corrigé** (hors périmètre) |

### Scénarios obligatoires couverts
1. Consommation directe L4 — `retest-l4` (M1/M3) + e2e `consumeDirect`.
2. Réservation / consommation / libération / restitution — e2e ledger + `retest-l4`.
3. Combiné lots + jours ordinaires — e2e `carryover-lot-l4-ledger` (« lot 2 j + ordinaire 1 j ») + `retest-l4` M3.
4. Demi-journées réparties entre plusieurs sources — e2e ledger (2 lots × 0,5 j).
5. Concurrence croisée L4/E2 — e2e `carryover-lot-l4-ledger` (aucun dépassement, 4 j de lot consommés exactement).
6. Même demande non comptabilisée deux fois par deux services — e2e `carryover-lot-l4-ledger` (L4 consomme, `ledger.consumeDirect` → 409).
7. Erreur après écriture SQL réelle → rollback — e2e trigger.
8. Unicité + deadlock — e2e (répétition → 409, simultané → 1×201/1×409) ; les deux deadlocks découverts ont été **corrigés** par l'ordre de verrouillage.
9. Expirés/gelés en enchaînement réel — e2e « gel réel » (réservation → expiration → libération → régularisation gelée comptée ensuite).
10. Date d'opération `America/Martinique` autour de minuit — unit test `martiniqueDateString` (03:30Z→veille, 04:30Z→jour même) ; le ledger utilise désormais `martiniqueDateString`.

## 7. Risques et blocages restants

- **Ordre de verrouillage de `restore`** : `balance_movements` → lots → compteurs, encore différent des chemins réserve/consomme (lots/compteurs d'abord). Concurrence croisée de `restore` non couverte (nécessite une consommation préalable). Risque résiduel documenté.
- **Pas de réessai de deadlock** (`ER_LOCK_DEADLOCK` non retenté) : les deux deadlocks observés ont été éliminés par l'ordre de verrouillage, pas par réessai.
- **`app.e2e-spec.ts`** (placeholder préexistant qui démarre l'AppModule complet) échoue avec « Pool is closed » — hors périmètre, sans lien avec E3-A.
- **L6 F8/F9/F10** reste ouvert (défaut d'horodatage `datetime` sans fraction de seconde), à traiter séparément.

## 8. Prérequis pour E3-B

1. Raccorder le ledger à `applyPaidLeaveForRequest()` / `reservePaidLeaveForRequest()` / `releasePaidLeaveReservationForRequest()` / `recreditPaidLeaveForCancelledRequest()` (interdit à cette étape).
2. Définir la retombée des jours `uncovered` sur l'allocation ordinaire N-1/N existante.
3. Décider : moment de réservation (validation vs début effectif) et restitution après expiration (gel `frozen_in_balance` vs recrédit) — homologation RH.
4. Traiter séparément l'instabilité L6 F8 (autorisation dédiée).
5. Maintenir `CARRYOVER_LOTS_ENABLED` jusqu'à homologation juridique.

---

**Aucun raccordement à `reservePaidLeaveForRequest`/`applyPaidLeaveForRequest`/`releasePaidLeaveReservationForRequest`/`recreditPaidLeaveForCancelledRequest`, aucun changement des circuits C1-C4 ni du scheduler, aucune activation production, aucun envoi réel, aucun commit/push. Base réelle `gestion_conges_gmes` intouchée (0 table L5/L6, ports 3000/5173 non démarrés). JUR-027 reste « Bloqué ».**

---

## ADDENDUM — Contrôles complémentaires avant E3-B

### 1. Invariants comptables L4 vs E2

**Anomalie démontrée et corrigée** : L4 `buildPlan()` ne vérifiait que `∑(reliquats de lots) > disponible` ; il **ignorait** les jours réservés et gelés. Le ledger E2, lui, appliquait déjà `reliquats + réservés + gelés ≤ disponible` (`lockAndValidateCounters`).

Scénario de preuve (e2e `carryover-lot-l4-ledger`, test « L4 applique l'invariant unifié ») : compteur N-1 `disponibles=10`, lot `reliquat=10`, `réservés=3` → L4 refuse désormais **HTTP 400**, reliquat inchangé (10), **0 mouvement**. Le même scénario est refusé par E2.

**Correction** : `buildPlan()` applique maintenant la règle unifiée `reliquats + réservés + gelés ≤ disponible` (message identique au ledger). Lots expirés/suspendus/reliquat inconnu et jours gelés (`frozen_in_balance`) restent gérés par les protections existantes.

### 2. Sécurisation des primitives partagées

**Anomalie démontrée et corrigée** : `writeLotMovementsWithManager()` **ignorait silencieusement** (`continue`) un lot ou un compteur introuvable, et ne contrôlait ni le reliquat ni l'appartenance du compteur à l'employé.

**Correction** : la primitive lève désormais une `BadRequestException` explicite si :
- lot introuvable dans le plan ;
- compteur N-1 introuvable pour le lot ;
- compteur n'appartenant pas à l'employé (`balance.employeeId !== input.employeeId`) ;
- reliquat insuffisant (`lot.remainingDays < allocation`).

Toute donnée manquante/incohérente provoque une erreur + rollback (transaction de l'appelant). La double comptabilisation reste empêchée par les contrôles d'état (`DEDUCTION`/`RESERVATION`/`RECREDIT`) + la contrainte `UQ_lot_allocations_request_lot_op`. L'audit est posé par les orchestrateurs (`reserveWithManager`, `consumeDirectWithManager`, `writePlan`) après l'écriture — aucun chemin d'écriture sans audit.

### 3. Rollback combiné L4 + ledger

Nouveau test e2e (`carryover-lot-l4-ledger`, « rollback L4 + ledger ») : demande de **3 jours (2 lots + 1 ordinaire)** via L4 `consume`. Un trigger `BEFORE INSERT ON balance_movements` émet `SIGNAL` à la **2ᵉ insertion** (le mouvement ordinaire, après l'écriture effective du lot).

**Preuve SQL** : reliquat du lot inchangé (2), compteur `available=5`/`consumed=0` inchangés, **0 mouvement, 0 allocation**. Les écritures lot et ordinaire sont annulées **ensemble**. Le trigger est supprimé dans un bloc `finally`.

### 4. Diagnostic `app.e2e-spec.ts`

**Preuve de la cause** (stack réelle) : `[LeaveRequestSchedulerService] Impossible de planifier la maintenance de bascule de période.` puis `Error: Pool is closed.`

Le scheduler lance `onApplicationBootstrap` en **fire-and-forget** (`void this.runMaintenance()` et `void this.scheduleNextSwitchMaintenance()`). Le test ferme l'application (`app.close()`) aussitôt après le GET : le pool TypeORM est fermé **pendant** que `runMaintenance()` l'utilise encore → rejet non géré « Pool is closed ». En production, l'application ne se ferme pas immédiatement : ce n'est pas un défaut métier.

**Correctif limité au test** (aucun service métier modifié) : `jest.setTimeout(30000)` + attente de 1,5 s après `app.init()` pour laisser la maintenance initiale se terminer. **Résultat** : `app.e2e-spec.ts` passe isolément et en `--runInBand`.

### 5. Concurrence restitution

Nouveau test e2e (`carryover-lot-ledger`, « restitution concurrente avec une nouvelle réservation sur le même lot ») : `restore` (sur une demande consommée) exécuté **concurremment** avec `reserve` (nouvelle demande) sur le même lot/compteur.

**Résultat observé** : les deux opérations réussissent (`['ok','ok']`), état final cohérent (reliquat ≥ 0, réservés ≤ disponibles, consommés ≤ disponibles). **Aucun deadlock observé** sur ce passage.

**Risque résiduel documenté** : l'ordre de verrouillage de `restore` (`balance_movements → lot_allocations → lots → compteurs`) diffère encore de celui de `reserve`/`consume` (`lots → compteurs`). Un deadlock croisé reste **théoriquement possible** (non reproduit ici) ; il n'y a **pas de réessai** d'`ER_LOCK_DEADLOCK`.

### 6. Contrat d'allocation (clarification)

- **Jours non couverts par les lots maladie** : retournés en `uncovered` par le ledger — jamais transformés en droits ordinaires par le ledger.
- **Jours repris sur les compteurs ordinaires** : traités uniquement par L4 via `allocateOrdinary` (N-1 puis N), à partir de `uncovered`.
- **Jours effectivement sans couverture** : si l'ordinaire est insuffisant, `buildPlan` lève `BadRequestException` (aucune allocation partielle silencieuse).

### 7. Résultats des contrôles complémentaires

| Vérification | Résultat |
|---|---|
| Invariant L4 = E2 (reliquats + réservés + gelés ≤ disponibles) | **CORRIGÉ, CONFORME** (test L4 400 + SQL) |
| Primitives sans succès partiel silencieux | **CORRIGÉ, CONFORME** (throws + rollback) |
| Rollback combiné lot + ordinaire | **CONFORME** (trigger, 0 écriture) |
| `app.e2e-spec.ts` | **DIAGNOSTIQUÉ, CORRIGÉ (test-only)** — passe isolément et en `--runInBand` |
| Concurrence restitution | **CONFORME** (pas de deadlock observé ; risque théorique résiduel) |

### 8. Conclusion

**E3-A : CONFORME AVEC RÉSERVES.**

Réserves :
1. Ordre de verrouillage de `restore` encore asymétrique (deadlock croisé théorique, non reproduit).
2. Pas de réessai d'`ER_LOCK_DEADLOCK` (les deux deadlocks rencontrés ont été éliminés par l'ordre de verrouillage, pas par retry).
3. L6 F8/F9/F10 reste ouvert (défaut d'horodatage, hors périmètre).

E3-B non commencée. JUR-027 reste « Bloqué ».
