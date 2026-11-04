# JUR-027 — Plan d'implémentation : lots de report de congés pour maladie

**Date** : 26/10/2026
**Statut** : **proposition** — aucun développement avant validation RH/Juridique (§Décisions du document d'audit). JUR-027 reste **Bloqué**.
**Prérequis** : document d'audit corrigé `AUDIT_JUR027_REPORT_MALADIE_FINAL.md` (v2).

Ce plan est découpé en **étapes indépendantes et cumulatives**. Chaque étape est livrable et testable isolément. Aucune ne modifie les quatre circuits, l'acquisition 2,5 j/mois, les arrondis GMES ni la base réelle.

---

## Étape 0 — Validation préalable (bloquante)

Aucune étape suivante ne démarre sans :
- validation du régime juridique (15 mois, deux régimes L3141-19-1 / L3141-19-2, L3141-21-1) ;
- choix de la preuve d'information à date certaine ;
- choix de la taxonomie d'origine et du comportement « données manquantes ».

---

## Étape 1 — Migration : table `carryover_lots`

**Migration TypeORM** `AddCarryoverLots` :
- Table `carryover_lots` (colonnes cf. audit §4.1) : `id`, `employee_id` (FK users RESTRICT), `regime` enum(`GENERAL`,`ARRET_LONG`), `origin` enum(`MALADIE`,`AT_MP`,`AUTRE`), `source_reference_period`, `target_reference_period`, `target_counter_type` enum(`N-1`,`N`,`N+1`), `days`, `remaining_days`, `absence_start_date`/`absence_end_date`, `reprise_date`, `information_date`, `information_mode` enum nullable, `proof_id` (FK documents SET NULL), `expires_at` date nullable, `expiry_basis` text, `status` enum(`ACTIF`,`SUSPENDU`,`EXPIRE`,`A_VERIFIER`), `reason`, `created_at`, `created_by` (FK users SET NULL).
- Index : `(employee_id, status)`, `(target_reference_period, target_counter_type)`, `(expires_at)`.
- **Traitement des anciens reports** : insérer un lot par mouvement `REPORT_EXCEPTIONNEL` existant (hors débits) avec `origin=AUTRE`, `regime=GENERAL`, `expires_at=NULL`, `status=A_VERIFIER`, `remaining_days=days` (initial), **sans requalification** basée sur le texte du motif. Le motif contenant « maladie » n'est **pas** une preuve d'origine.

**Tests** : migration sur base de recette ; vérifier le backfill des anciens reports et l'absence de double comptage (`Σ remaining_days` = total reporté).

---

## Étape 2 — Service backend `CarryoverLotsService` + calcul d'échéance

- `createLot(...)` : création avec traçabilité (audit `CARRYOVER_LOT_CREATED`).
- `computeExpiry(regime, data)` (pur, testable unitairement) :
  - `GENERAL` : `information_date + durée` ; sans `information_date` → `A_VERIFIER` (aucune expiration).
  - `ARRET_LONG` : vérifier suspension ≥ 1 an à la fin de la période de référence ; `base = reference_period_end + durée` ; si `reprise_date < base` alors `expires_at = base + (information_date − reprise_date)` (sinon `SUSPENDU` tant que l'information est absente) ; si toujours absent à `base` → `expires_at = base`.
  - `durée` = 15 mois par défaut, surchargeable par configuration **uniquement après confirmation** (L3141-21-1).
- `consumeLots(...)` : ventilation FIFO par `expires_at` croissante, décrément de `remaining_days`.
- `markExpired(...)` / `flagForReview(...)`.

**Tests unitaires** : les exemples §5 de l'audit (général, arrêt long reprise avant/après échéance, toujours absent, information absente/tardive).

---

## Étape 3 — Intégration au report exceptionnel

Modifier `ReferencePeriodService.approveExceptionalCarryover` (ou un nouvel endpoint) :
- Le DTO existant reste compatible (report `AUTRE`/`GENERAL` sans échéance → lot `A_VERIFIER` si aucune donnée).
- Nouveau DTO optionnel enrichi : `regime`, `origin`, dates d'arrêt/reprise, `informationDate`, `informationMode`, `proofId`.
- À la création : débit source + crédit cible (comportement actuel **conservé**) **+** création du lot rattaché à la cible, `remaining_days = days`, `expires_at` calculé.
- **Invariant** vérifié en transaction : `Σ remaining_days ≤ availableDays(cible)`.

**Tests** : non-régression JUR-027 (débit source 24/24), création de lot, calcul d'échéance, audit/notification.

---

## Étape 4 — Consommation ventilée

Modifier `leave-allocation.util.ts`/`leave-balances.service.ts` :
- `allocatePaidLeave` accepte la liste des lots du compteur de destination.
- Ventilation FIFO par échéance ; le reste sur les jours ordinaires ; `availableDays`/`consumedDays` du compteur inchangés dans leur sémantique.
- Mouvement `DEDUCTION` existant conservé ; ajout d'une trace de ventilation (`reason` ou table de liaison lot↔mouvement).

**Tests** : multi-lots à échéances différentes ; pas de double déduction ; solde négatif N inchangé.

---

## Étape 5 — Clôture : remise à zéro conditionnelle + transport

Modifier `ReferencePeriodService.closeReferencePeriod` (et `previewClosure`) :
- Pour chaque N-1 clôturé : `protégés = Σ remaining_days(lots ACTIF/SUSPENDU/A_VERIFIER non expirés)` ; `ordinaires = availableDays − protégés`.
- `protégés` → **transport** vers N-1 de la période suivante (mouvement `REPORT_TRANSFERT`), lots re-rattachés (`target_reference_period`/`target_counter_type` mis à jour), **sans modifier `remaining_days`**.
- `ordinaires` + lots `EXPIRE` → `REMISE_A_ZERO` / `REPORT_EXPIRATION`.
- Le transfert ordinaire N → N-1 et l'arrondi L3141-7 **inchangés**.
- `previewClosure` expose : `protectedDays`, `protectedLots`, `reviewRequiredLots`, en plus des totaux actuels.
- **Règle** : jamais de suppression d'un lot `A_VERIFIER`/`SUSPENDU`/non expiré.

**Tests** : deux clôtures successives ; transport sans double crédit ; lots expirés remis à zéro ; non-régression L3141-7 et prévisualisation.

---

## Étape 6 — Interface RH

- **Formulaire de report** : champs régime/origine, période d'origine, jours, dates arrêt/reprise, `information_date`+`mode`, justificatif ; affichage de l'échéance calculée + fondement.
- **Nouvelle vue « Reports maladie »** (liste des lots, filtres par statut/échéance).
- **Fenêtre de clôture** : récap distinguant `jours ordinaires` / `jours protégés` / `situations à vérifier` ; confirmation incluant les jours protégés conservés.
- **Contrôles** : impossibilité d'expirer manuellement un lot sans `expires_at` calculé.

**Tests navigateur** (Playwright, env. 5174/3001) : création d'un lot, affichage échéance, prévisualisation avec jours protégés, confirmation.

---

## Étape 7 — Interface collaborateur + preuve d'information

- **Solde** : détail des lots « X jours à prendre avant le JJ/MM/AAAA ».
- **Notification** de report : nombre + date limite.
- **Accusé de connaissance daté** (bouton dédié enregistrant `information_date` si le mode choisi est applicatif), distinct d'une simple notification.
- Le mode « bulletin de paie/courrier » reste saisi par la RH (preuve externe).

**Tests** : affichage du solde par lot ; accusé daté ; la notification sans accusé ne déclenche pas le délai (régime général).

---

## Étape 8 — Rapports, audit et garde-fous

- Audit log : `CARRYOVER_LOT_CREATED`, `CARRYOVER_LOT_EXPIRED`, `CARRYOVER_LOT_TRANSPORTED`, `CARRYOVER_LOT_FLAGGED`.
- Garde-fou : contrôle périodique `Σ remaining_days ≤ availableDays(cible)` ; alerte RH en cas d'écart.
- Notification RH des lots `A_VERIFIER`/`SUSPENDU` à traiter avant clôture.

---

## Récapitulatif des décisions bloquantes (rappel)

Voir §8 du document d'audit : durée, régime, convention collective (L3141-21-1), taxonomie, FIFO, preuve d'information, comportement données manquantes, calcul d'échéance, anciens reports.

**Aucun développement, aucune migration, aucune modification de base réelle, aucun commit/push tant que ces décisions ne sont pas validées.**
