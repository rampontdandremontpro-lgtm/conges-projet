# JUR-027 — Rapport E3-B.1A (préparation technique du raccordement)

**Date** : 28/10/2026
**Statut** : **E3-B.1A terminé** — briques isolées et sécurisation technique, sans raccordement réel. JUR-027 reste « Bloqué ».

---

## 1. Fichiers modifiés / créés

| Fichier | Changement |
|---|---|
| `backend/src/leave-balances/carryover-allocation.core.ts` | ajout `sumDatedDays()` (somme arrondie des journées datées) |
| `backend/src/leave-balances/dated-leave-days.util.ts` | **créé** — `buildDatedLeaveDays()` + contrat d'intégration future |
| `backend/src/leave-balances/carryover-lots/carryover-lot-ledger.service.ts` | ajout du contrôle `lot.employeeId === input.employeeId` dans `writeLotMovementsWithManager` |
| `backend/src/leave-balances/dated-leave-days.util.spec.ts` | **créé** — 6 tests unitaires |
| `backend/test/app.e2e-spec.ts` | remplacement de l'attente fixe par un **stub déterministe du scheduler** (test-only) |
| `backend/test/carryover-lot-ledger.e2e-spec.ts` | rollback renforcé : vérification du code et du message SQL |
| `backend/test/carryover-lot-l4-ledger.e2e-spec.ts` | rollback renforcé + nouveau test de protection des compteurs |
| `docs/PLAN_IMPLEMENTATION_E3B_JUR027.md` | §9 : séquencement corrigé (E3-B.1A → B.1B → B.2 → B.3 → B.4 → B.5) |

Aucun appelant réel modifié. Aucun changement de comportement dans `applyPaidLeaveForRequest()`, `recreditPaidLeaveForCancelledRequest()`, le scheduler ou les circuits.

## 2. Calcul fiable des journées datées

- Réutilisation de `calculateDeductedLeaveDayList()` (E1) : dimanches, dates non déductibles, demi-journées, règle GMES du samedi.
- Nouveau `buildDatedLeaveDays({ startDate, endDate, startPeriod, endPeriod, nonDeductibleDates, expectedDays })` :
  - produit la liste datée exacte ;
  - **lève une `BadRequestException` explicite si la somme ne correspond pas à `deductedDays`** (jamais de débit silencieux) ;
  - gère les demandes multi-mois/multi-périodes (chaque journée porte sa date effective) ;
  - date métier `America/Martinique` via `martiniqueDateString` (déjà utilisé par le ledger).
- **Contrat E3-B** documenté : `datedDays` sera **obligatoire** dès que la gestion des lots est réellement utilisée ; son absence ne devra jamais aboutir à un débit uniquement ordinaire silencieux.

Tests unitaires (6) : jours complets cohérents, demi-journée, exclusion dimanche/non-déductible, traversée de mois, incohérence → erreur explicite, `sumDatedDays` arrondi. **6/6 OK.**

## 3. Protections des compteurs (invariants)

Nouveau test e2e isolé (`carryover-lot-l4-ledger`, « compteur N-1 avec jours protégés et gelés ») :

| Élément | Valeur |
|---|---|
| Compteur N-1 disponible | 10 |
| Lots protégés (`remaining_days`) | 6 |
| Jours gelés (`REGULARISATION` frozen) | 2 |
| Demande (3 j ordinaires, après échéance du lot) | attendu **refus** |

**Observé** : `BadRequestException` (400) — seuls `10 − 6 − 2 = 2` jours ordinaires sont mobilisables, inférieurs aux 3 demandés. Compteur inchangé, 0 mouvement.

Invariants vérifiés : pas de consommation de droits protégés en ordinaire, pas de sur-réservation, pas de reliquat négatif, pas de double comptabilisation, pas de création artificielle de droits. Aucune nouvelle priorité implémentée.

## 4. Protections techniques finalisées

- **Propriété** : `writeLotMovementsWithManager` vérifie désormais `lot.employeeId === input.employeeId` **et** `balance.employeeId === input.employeeId` (erreur explicite sinon).
- **Rollback renforcé** : les deux tests de rollback (ledger et L4+ledger) vérifient désormais le **code SQL `ER_SIGNAL_EXCEPTION`** et le **message du trigger** (« controlled rollback … »), prouvant que l'erreur survient **après l'écriture réelle du 1ᵉʳ mouvement de lot** ; données avant/après contrôlées (0 mouvement, 0 allocation, lots inchangés).
- **E2E déterministe** : `app.e2e-spec.ts` remplace l'attente fixe de 1,5 s par un **stub du scheduler** (override `LeaveRequestSchedulerService`), limité au test. Le comportement métier du scheduler n'est pas modifié. `GET /` → 200 « Hello World! », plus de « Pool is closed ».
- **Concurrence** : ordre canonique documenté ci-dessous.

## 5. Ordre canonique de verrouillage (état E3-B.1A)

| Chemin | Ordre de verrouillage | Conforme ? |
|---|---|---|
| `reserveWithManager` / `consumeDirectWithManager` | lots → compteurs | ✅ canonique |
| L4 `buildPlan` (consume/reserve) | lots → compteurs | ✅ canonique |
| `consumeReservationWithManager` / `releaseWithManager` | compteurs → mouvements → lots | ✅ canonique (fixé E3-A) |
| `restoreWithManager` | mouvements → allocations → lots → compteurs | ⚠️ **non conforme** (à harmoniser en E3-B.4) |

Tests de chevauchement transactionnel réel déjà en place (`Promise.allSettled`) : réservation/consommation/libération/restitution concurrentes + croisées L4/E2. **Aucun deadlock observé** sur les passages ; le risque résiduel `restore` vs `reserve/consume` (ordre asymétrique) reste documenté. **Aucun retry automatique introduit** dans une transaction métier (conformément à la consigne).

## 6. Résultats des tests

| Vérification | Résultat |
|---|---|
| TypeScript + build | **exit 0** |
| Jest unitaire | **31 suites / 448 passés / 38 skip / 0 échec** |
| e2e (3 suites, `--runInBand`) | **37/37** (app 1 · ledger 30 · l4-ledger 6) |
| L3 / L4 / L4-final / L4-isolation / L5-unified / L7 | **29/29 · 16/16 · 13/13 · 11/11 · 10/10 · 12/12 OK** |
| L6-final | **18/18 OK** (ce passage ; flake F8 toujours ouvert, non masqué) |

## 7. Risques résiduels

- `restoreWithManager` conserve un ordre de verrouillage distinct (mouvements → lots → compteurs) : deadlock croisé théorique avec `reserve`/`consume`, non reproduit.
- Pas de réessai `ER_LOCK_DEADLOCK` (conformément à la consigne : à valider en E3-B.4, réessai transactionnel borné et idempotent).
- L6 F8/F9/F10 reste un incident ouvert indépendant.

## 8. Conditions pour commencer E3-B.1B

1. Accord sur le **contrat `datedDays`** (obligatoire en mode lot-aware) et sur `buildDatedLeaveDays` comme source unique.
2. Accord sur l'**ordre canonique** de verrouillage et la cible d'harmonisation de `restore` (E3-B.4).
3. Décisions métier toujours **BLOQUÉES** (priorité des lots, réservation éventuelle à la validation, restitution après expiration) — à trancher avant toute activation.
4. `CARRYOVER_LOTS_ENABLED` reste désactivé en production.

---

**Aucun raccordement aux méthodes réelles de débit/réservation/libération/restitution, aucun changement des circuits C1-C4 ni du scheduler métier, aucune migration sur `gestion_conges_gmes`, aucun envoi réel, aucun commit/push. JUR-027 reste « Bloqué ».**
