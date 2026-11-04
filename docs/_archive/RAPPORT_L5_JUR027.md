# JUR-027 — Rapport du lot L5 (protection des reports à la clôture) — v5

**Date** : 28/10/2026 — **version 5 (clôture unifiée et atomique en recette)**
**Statut** : **JUR-027 reste « Bloqué » (L6/L7 non entamés).** Clôture L5 **unifiée et testée en recette** (`gestion_conges_gmes_test`, API 3001).

---

## 1. Conclusion fonctionnelle

**Clôture unifiée et testée en recette.** Le pré-traitement autonome L5 est **bloqué** : une seule procédure RH (`POST /leave-balances/period/close`) exécute, dans **une seule transaction MySQL**, le traitement des lots maladie puis toutes les opérations GMES, avec **un seul verrou de période** et **un seul marqueur définitif**.

## 2. Architecture finale

### 2.1 Une seule transaction (`closeReferencePeriod`)
En recette (`CARRYOVER_LOTS_ENABLED=true` **ET** base `gestion_conges_gmes_test`), `closeReferencePeriod` exécute dans la transaction du `QueryRunner` (verrou `GET_LOCK('carr_closure_<période>')` conservé jusqu'au COMMIT/ROLLBACK) :

1. Contrôle de fin de période (calendrier Martinique + `REFERENCE_PERIOD_START`).
2. Rejet si la période est déjà définitivement clôturée.
3. Contrôle des demandes de congés non définitivement imputées.
4. **`buildCarryoverLotPlan`** : reclassification L2 de chaque lot, cohérence lots/compteurs, **blocage si dossier incomplet, gelé, réservé ou incohérent**.
5. **`applyCarryoverLotPlan`** : jours expirés déduits du N−1 (mouvement `REPORT_CLOTURE|expirés`, lots `EXPIRE`) ; jours protégés transférés vers le N−1 suivant (mouvements `REPORT_TRANSFERT`, lots rattachés à la nouvelle période).
6. Opérations GMES habituelles : arrondi L3141-7, transfert N→N−1, remise à zéro N/N−1/N+1, notifications.
7. **Marqueur définitif unique** `REFERENCE_PERIOD_CLOSED_<période>` + audit `REFERENCE_PERIOD_CLOSED`.

En cas d'échec à n'importe quelle étape : **rollback intégral** (lots, soldes, mouvements, marqueur), `RELEASE_LOCK` sur la même connexion, connexion rendue au pool.

### 2.2 Service L5 = lecture seule + exécution bloquée
`CarryoverLotClosureService` ne modifie plus aucun compteur :
- `preview()` : plan de lots en lecture seule (aucune écriture, aucun verrou de période) ;
- `execute()` : **bloqué (400)** — « utilisez la clôture de période GMES ».

## 3. Protections contre l'expiration injustifiée

Le garde-fou ne repose **jamais** sur le seul `status != 'EXPIRE'` :

- L'expiration est décidée par le **moteur L2** (`classifyCarryoverLot`) ; un lot `EXPIRE` en base sans confirmation L2 n'est pas « blanchi ».
- **Dossier incomplet → blocage sans remise à zéro** : échéance incertaine (`A_VERIFIER`, `SUSPENDU`, `EN_ATTENTE`), reliquat inconnu (`remaining_days IS NULL`).
- **Gel / réservation / incohérence → blocage** : `frozen_in_balance > 0`, `reservedDays > 0`, `ordinaire < 0`.
- **Cohérence lots/compteurs** : `ordinaire = disponible − réservé − protégé − expiré − gelé`, vérifiée avant écriture.
- Jours expirés **effectivement retirés** avec mouvement explicite ; jours protégés transférés avec mouvements `REPORT_TRANSFERT`.

## 4. Fichiers

- `backend/src/leave-balances/carryover-lots/carryover-lot-closure.core.ts` (nouveau) : `classifyCarryoverLot`, `buildCarryoverLotPlan`, `applyCarryoverLotPlan` (pures, acceptent l'`EntityManager`).
- `backend/src/leave-balances/carryover-lots/carryover-lot-closure.service.ts` : prévisualisation + exécution autonome bloquée.
- `backend/src/leave-balances/reference-period.service.ts` : intégration du plan de lots dans la transaction de clôture.
- Tests : `retest-l5-unified.mjs` (nouveau), `retest-l5-coordination.mjs` (réécrit), `retest-l5.mjs` et `retest-l5-consolidation.mjs` (réécrits), `retest-l5-comparatif.mjs` (supprimé, obsolète).

## 5. Tests de concurrence réellement simultanés

`retest-l5-coordination.mjs` (**11/11**) — `Promise.all()` pour les parcours simultanés :

| # | Scénario | Résultat |
|---|---|---|
| C1 | Deux clôtures simultanées **avec lots** | ✅ 201/409, 1 lot transféré (2 mouvements), 1 marqueur définitif, verrou libéré |
| C2 | Deux clôtures simultanées **sans lot** | ✅ 201/409, 1 marqueur |
| C3 | Clôture unifiée : lot + N arrondi/transféré + N+1 remis à zéro | ✅ 201, N−1 suivant = 25 |
| C4 | Clôture rejouée | ✅ 409 |
| C5 | Pré-traitement autonome L5 | ✅ bloqué (400), aucune écriture |
| C6 | Verrou occupé | ✅ 409 après ~10 s, `IS_FREE_LOCK=1` |
| C7 | **Rollback complet** : lots traités puis erreur GMES (`CLOTURE_TRANSFERT_N`) | ✅ 500, lots/soldes/mouvements/marqueur intacts |
| C8 | Après rollback : re-clôture | ✅ 201 puis 409 |
| C9 | Période future | ✅ 400 sans écriture |
| C10 | Période terminée | ✅ 201 |

## 6. Clôture mixte représentative — soldes SQL avant/après

`retest-l5-unified.mjs` (**10/10**) — période `2020-2021` :

- **Salarié A** : N−1 = 12 (lot confirmé 4 + ordinaire 8), N = 20.5 (arrondi), N+1 = 3, report exceptionnel 2.
  - Avant : N−1 = 12, N = 20.5, N+1 = 3.
  - Après : N−1 = 0, N = 0, N+1 = 0, **N−1 suivant = 27** (report 2 + lot 4 + N arrondi 21).
  - Lot confirmé : `target_reference_period` → `2021-2022`, statut conservé `ACTIF`.
- **Salarié B (sans lot)** : N−1 = 7, N = 12, N+1 = 2 → N−1 = 0, N = 0, N−1 suivant = 12.
- Mouvements : `REPORT_EXCEPTIONNEL_DEBIT`, `REPORT_EXCEPTIONNEL`, `REPORT_TRANSFERT`×2, `CLOTURE_ARRONDI_L3141_7`, `CLOTURE_TRANSFERT_N`, `CLOTURE_PERIODE`×3.
- Marqueur : `REFERENCE_PERIOD_CLOSED_2020_2021` = 1, `CARRYOVER_LOTS_TREATED_*` = 0.
- Notifications `REFERENCE_PERIOD_CLOSED` = 2 ; audit `REFERENCE_PERIOD_CLOSED` = 1.
- **Lot incertain (A_VERIFIER)** sur `2019-2020` → **400**, N−1 inchangé, 0 mouvement, 0 marqueur.

## 7. Résultats complets (28/10/2026)

| Vérification | Résultat |
|---|---|
| `retest-l5.mjs` | **10/10 OK** |
| `retest-l5-consolidation.mjs` | **7/7 OK** |
| `retest-l5-coordination.mjs` | **11/11 OK** |
| `retest-l5-unified.mjs` | **10/10 OK** |
| L4-final / L4 / L4-isolation | **13/13 · 16/16 · 11/11 OK** |
| L3 | **29/29 OK** |
| Suite backend Jest | **29 suites / 424 passés, 38 skip, 0 échec** |
| TypeScript + build | **exit 0** |
| Non-régression : arrondis L3141 (11+18), correction-clôture (7), étape 3 (7), preview (17), correction JUR-027 (24), report+absences (12), **4 circuits (50/50)** | **tous OK** |
| Sans flag (`CARRYOVER_LOTS_ENABLED=false`) | **404** (preview + execute L5), clôture normale fonctionnelle |

## 8. Base réelle

`gestion_conges_gmes` : **pas de `carryover_lots`, pas de `lot_allocations`**, **0 marqueur** de clôture/pré-traitement. Serveurs 3000/5173 **non démarrés**. Écritures uniquement sur `gestion_conges_gmes_test`.

## 9. Points encore ouverts

- La clôture unifiée est **en recette uniquement** (flag + base test). Le raccordement bout-en-bout du parcours RH (approbations réelles) reste un objectif L6/L7.
- Couverture ⚠️ des 25 scénarios (arrêt long suspendu/expiré à la clôture, lots multi-périodes) à finaliser.
- Aucune activation en production.

**Aucun commit ni push. JUR-027 reste « Bloqué ». STOP — L6 non entamé.**
