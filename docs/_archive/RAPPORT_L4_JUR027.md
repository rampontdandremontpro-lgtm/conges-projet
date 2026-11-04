# JUR-027 — Rapport du lot L4 (allocation/consommation/restitution) — v4

**Date** : 27/10/2026 — **version 4 (trois invariants corrigés avant L5)**
**Statut** : **JUR-027 reste « Bloqué ».** Recette isolée uniquement.

---

## 1. Problèmes reproduits et corrigés

### 1.1 Demandes 100 % ordinaires
`finalize`/`release` exigeaient des lignes `lot_allocations` (réservation de lots), bloquant une demande entièrement ordinaire. **Corrigé** : le critère est désormais la présence de **mouvements `RESERVATION`** (fiables et cohérents — la somme doit égaler `deductedDays`), les lignes de lot devenant optionnelles. Parcours vérifié : réservation ordinaire → validation (décrément unique) → annulation (restitution exacte) ; réservation ordinaire → refus (libération exacte). `restore` accepte aussi les demandes sans allocation de lot (restitution ordinaire + double restitution refusée).

### 1.2 Régularisation d'un lot expiré pendant une réservation
La libération d'une réservation dont le lot a expiré réduisait `reservedDays` sans recréditer le lot, laissant `availableDays − reservedDays − Σ remaining_days` augmenter (jours expirés redevenant ordinaires). **Corrigé** : nouvelle colonne `lot_allocations.frozen_in_balance` (1 = jours encore présents dans `availableDays`). Les quantités gelées sont **exclues** du calcul des jours ordinaires : `ordinaire utilisable = availableDays − reservedDays − Σ remaining_days(lots) − Σ frozen_in_balance`. Source fiable par lot/demande/compteur, sans double comptage. Testé : ordinaire utilisable **5 avant / 5 après** la régularisation ; 4 j consommables, 6 j refusés ; lot expiré non recrédité.

### 1.3 Finalisation unique et décisions contradictoires
Les contrôles d'état se faisaient en lecture snapshot (`REPEATABLE READ`), laissant passer deux finalisations simultanées. **Corrigé** : verrouillage pessimiste des compteurs **avant** le contrôle d'état, et contrôle `DEDUCTION`/`LIBERATION_RESERVATION` en **lecture verrouillée (courante)**. Vérifié : 2ᵉ `VALIDATE` → 409 ; `VALIDATE` puis `REFUSE`/`release` → 409 ; `REFUSE` puis `VALIDATE` → 409 ; deux `VALIDATE` simultanés → 201+409 ; `VALIDATE`+`REFUSE` simultanés → 201+409. Le `finalize` autonome reste un **outil de recette** (flag + base test + rôle RH) ; il n'est **pas** raccordé aux 4 circuits et ne peut pas contourner leurs approbations en production.

## 2. Fichiers modifiés

`carryover-lot-allocation.entity.ts` (+`frozen_in_balance`), `carryover-lot-allocation.service.ts` (finalize/release/restore ordinaires, verrouillage + lecture courante, gel des quantités), migration `20261027180000-add-lot-allocations.ts` + `l4-migrate.mjs` (colonne `frozen_in_balance`), tests `retest-l4-final.mjs` (13).

## 3. Résultats réels

| Vérification | Résultat |
|---|---|
| `retest-l4-final.mjs` (3 invariants) | **13/13 OK** |
| `retest-l4.mjs` | **16/16 OK** |
| `retest-l4-isolation.mjs` | **11/11 OK** |
| Moteur L4 unitaire | **27/27 OK** |
| L3 / L2 | **29/29 · 51/51 OK** |
| Suite backend complète | **29 suites / 424 passés, 38 skip, 0 échec** |
| TypeScript + build | **exit 0** |
| Non-régression : L3141 (11+18), JUR-027 (24+7+12), **4 circuits (50/50)**, preview (17+3), clôture (7) | **tous OK** |
| Sans flag | **404** |

## 4. Garanties lots/compteurs/mouvements

Chaque opération écrit atomiquement compteurs + mouvements + lots + `lot_allocations` (+ audit), sous verrous pessimistes. Plan unique avant écriture ; jours protégés/réservés/gelés/à-vérifier exclus du pool ordinaire ; origine de chaque jour identifiable (lot ou ordinaire). Aucun jour créé, aucune échéance prolongée, aucun droit expiré transformé en ordinaire.

## 5. Base réelle

`gestion_conges_gmes` : **pas de `carryover_lots`, pas de `lot_allocations`**, 0 migration. Serveurs 3000/5173 **non démarrés**. Écritures uniquement dans `gestion_conges_gmes_test`.

## 6. Reste désactivé / prérequis L5

- `finalize`/`reserve`/`release`/`restore` : **outils de recette** derrière `CARRYOVER_LOTS_ENABLED=true` **ET** base test **ET** rôle RH — non branchés aux 4 circuits.
- Aucune expiration automatique, aucune clôture, aucun backfill.
- L5 : raccorder les transitions aux décisions réelles des circuits ; régularisation RH des lots expirés ; protection des reports à la clôture (objet principal de L5).

**Aucun commit ni push. JUR-027 reste « Bloqué ». STOP — L5 non entamé.**
