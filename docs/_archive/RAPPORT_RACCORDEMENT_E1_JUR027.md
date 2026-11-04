# JUR-027 — Rapport E1 (extraction du moteur d'allocation des lots maladie)

**Date** : 28/10/2026
**Statut** : **E1 terminé** — logique d'allocation extraite dans un module métier partagé, sans branchement aux circuits. JUR-027 reste « Bloqué ».

---

## 1. Fichiers modifiés / créés

| Fichier | Action |
|---|---|
| `backend/src/leave-balances/carryover-allocation.core.ts` | **créé** — moteur pur partagé (extraction) |
| `backend/src/leave-balances/carryover-lots/carryover-lot-allocation.util.ts` | **réduit** à un ré-export (compatibilité) |
| `backend/src/leave-balances/carryover-lots/carryover-lot-allocation.service.ts` | import pointé vers le core |
| `backend/src/leave-balances/carryover-allocation.core.spec.ts` | **créé** — tests unitaires (17 cas) |

## 2. Fonctions extraites (module partagé `carryover-allocation.core.ts`)

- `calculateDeductedLeaveDayList(startDate, endDate, startPeriod, endPeriod, nonDeductibleDates)` — liste datée des jours décomptés (dimanches, jours non décomptés, demi-journées, règle GMES du samedi).
- `isLotConsumable(lot)` — éligibilité d'un lot (reliquat connu et > 0, statut ACTIF, confirmation non `EN_ATTENTE`, échéance définie, origine rapprochée).
- `allocateCarryoverLots(datedDays, lots)` — répartition FIFO par échéance (puis id), demi-journées, jours non couverts (`uncovered`), lots inéligibles (`skipped`).

Ces fonctions sont **pures** : aucune dépendance base/service/HTTP, aucune écriture, aucune notification, aucun changement de compteur.

## 3. Règles conservées

- Ventilation par **dates effectives** (jamais la seule date de début).
- FIFO par **échéance la plus proche**, puis par id.
- **Demi-journées** (0.5/1) reproduites à l'identique de `calculateDeductedLeaveDays`.
- Jours non couverts → restent **ordinaires** (inchangés).
- **Protections** : reliquat inconnu/épuisé, statut non ACTIF (EXPIRE/SUSPENDU), confirmation EN_ATTENTE, échéance indéfinie, origine non rapprochée → lot non consommé (skippé).
- Aucune seconde implémentation : l'ancien fichier est un simple ré-export.

## 4. Résultats des tests

| Vérification | Résultat |
|---|---|
| Unitaires `carryover-allocation.core.spec.ts` (ordinaires, limites, multi-périodes, demi-journées, échéances identiques) | **17/17 OK** |
| Unitaires `carryover-lot-allocation.util.spec.ts` (via ré-export) | **27/27 OK** |
| Suite Jest complète | **30 suites / 441 passés, 38 skip, 0 échec** |
| TypeScript + build | **exit 0** |
| Non-régression L3 / L4 / L4-final / L4-isolation / L5-unified / L6-final / L7 | **29/29 · 16/16 · 13/13 · 11/11 · 10/10 · 18/18 · 12/12 OK** |

## 5. Anomalies

Aucune anomalie métier. Une erreur d'import (`DayPeriod`) lors de l'extraction a été corrigée immédiatement (chemin relatif).

## 6. Garanties de non-régression et d'absence d'écriture métier

- Le comportement des allocations L4 est **inchangé** (ré-export + import centralisé, pas de duplication).
- Aucune écriture en base, aucun compteur modifié, aucune notification déclenchée par le module extrait.
- Base réelle `gestion_conges_gmes` : **aucune table L5/L6, aucun marqueur** ; ports 3000/5173 non démarrés ; aucun commit/push ; aucun envoi réel.

## 7. Points restant à décider avant E2

1. Signature d'appel du ledger depuis `applyPaidLeaveForRequest` (entrées : jours datés + lots consommables ; sorties : allocations lots + jours non couverts).
2. Traitement des jours non couverts par un lot (report sur l'ordinaire N-1 puis N, comme aujourd'hui).
3. Réservation à la validation vs au début effectif (proposition : réservation à la validation, débit au début effectif).
4. Restitution après expiration (gel `frozen_in_balance` vs recrédit) — décision RH.
5. Activation derrière `CARRYOVER_LOTS_ENABLED` jusqu'à homologation.

---

**E1 terminé. E2-E6 non entamés. JUR-027 reste « Bloqué ». Aucun commit/push.**
