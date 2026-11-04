# JUR-027 — Plan final sécurisé (v3) + périmètre du lot L1

**Date** : 26/10/2026 — **version 3 (corrections intégrées)**
**Statut** : **proposition** — aucun développement, aucune migration, aucune modification de base. **JUR-027 reste « Bloqué ».**
**Prérequis** : audit corrigé `AUDIT_JUR027_REPORT_MALADIE_FINAL.md` (v2).

Cette version corrige les cinq risques signalés : (1) ventilation par dates effectives, (2) distinction solde comptable / jours utilisables, (3) migration des anciens reports sans zéro artificiel, (4) annulations et recrédits rattachés au droit d'origine, (5) déploiement et retour arrière sûrs.

---

# PARTIE A — Garde-fous corrigés

## A1. Expiration en cours d'année — ventilation par dates effectives

Le prédicat `request.startDate ≤ expires_at` est **abandonné** (insuffisant pour un congé chevauchant l'échéance).

### Principe
- La ventilation s'opère **jour par jour / demi-journée**, sur les **dates effectives décomptées** du congé, et non sur la seule date de début.
- On réutilise la logique existante `calculateDeductedLeaveDays` (boucle jour par jour, exclusion des dimanches et jours non décomptables, demi-journées matin/après-midi, règles GMES du samedi) pour produire la **liste des dates décomptées** (avec leur valeur 1 ou 0,5).
- Pour chaque date décomptée `d` :
  - `d ≤ expires_at` → consommable depuis le lot (dans la limite de `remaining_days`) ;
  - `d > expires_at` → **non consommable** depuis le lot.
- Les jours postérieurs à l'échéance ne peuvent être couverts que par **d'autres jours utilisables** (lots non expirés ou jours ordinaires). Sinon : **couverture partielle** → signalement RH, sans extension automatique des droits.

### Validation antérieure
Une demande **validée avant l'échéance** ne **prolonge pas** les droits par principe. Toute dérogation (ex. « le droit a été exercé avant l'échéance ») doit être **juridiquement justifiée et validée par la RH** ; le logiciel ne l'applique pas automatiquement.

### Annulations et dates
L'annulation d'une demande imputée déclenche un **recrédit rattaché au lot d'origine** (cf. A4). Les demandes partiellement prises sont traitées par la ventilation par dates : seules les dates réellement décomptées et imputées sont recréditées.

## A2. Anciens reports — inventaire « À vérifier » sans zéro artificiel

- **Aucune attribution automatique de reliquat** : ni `0`, ni `days`.
- Chaque crédit historique `REPORT_EXCEPTIONNEL` donne lieu à un **lot inerte** : `origin=AUTRE`, `regime=GENERAL`, `status=A_VERIFIER`, `remaining_days = NULL` (inconnu), `expires_at = NULL`.
- **Inventaire de rapprochement en lecture seule** : par salarié/période, Σ crédits `REPORT_EXCEPTIONNEL`, Σ `DEDUCTION`, Σ `REMISE_A_ZERO`, `availableDays` courant, et une **fourchette indicative** `[0, days]` — **sans attribution**.
- **Aucune modification des compteurs historiques**, aucune qualification automatique en « report maladie ».
- L'activation d'une **protection** ou la **clôture de droits incertains** exige une **résolution RH documentée** (fixation manuelle de `remaining_days`, `origin`, `regime`, `expires_at`, avec justificatif daté).
- Tant qu'un lot est `A_VERIFIER`/`remaining_days=NULL`, il ne participe **ni** au pool utilisable, **ni** à une protection, **ni** à une expiration : il est purement informatif.

## A3. Cohérence comptable — solde vs utilisable, et rattachement des mouvements

### Quatre notions distinctes
| Notion | Définition |
|---|---|
| **Solde comptable** | `availableDays` du compteur (inclut les jours expirés non encore régularisés). |
| **Jours utilisables** | `usableDays = availableDays − expiredPendingDays` (jours effectivement imputables). |
| **Jours expirés en attente** | `expiredPendingDays = Σ remaining_days(lots EXPIRE non régularisés)` — retirés du pool, régularisés à la clôture. |
| **Jours à vérifier** | `toReviewDays = Σ remaining_days(lots A_VERIFIER/SUSPENDU)` — utilisables mais **signalés** à la RH. |

### Règle d'allocation
L'allocateur consomme **uniquement** dans `usableDays` : FIFO parmi les lots **non expirés**, puis jours ordinaires. **Un lot expiré ne peut jamais être consommé comme jour ordinaire** (les jours expirés sont exclus du pool avant ventilation).

### Rattachement lot ↔ mouvement (pour recrédit exact)
- Table de liaison `lot_allocations` : `(movement_id, lot_id, days)` enregistrée à chaque `DEDUCTION` ventilée.
- Le recrédit inverse lit `lot_allocations` et restaure **le même lot** (pas de lot « ordinaire » de substitution).

### Invariants
- **I1** : `availableDays(c) = jours_ordinaires(c) + Σ remaining_days(lots rattachés à c)`.
- **I2** : `acquiredDays`/`availableDays`/`consumedDays`/`reservedDays` = cumul des mouvements (types existants + `REPORT_TRANSFERT`, `REPORT_EXPIRATION`).
- **I3** : `0 ≤ remaining_days ≤ days` (ou `remaining_days = NULL` pour un lot non résolu).
- **I4** : chaque `DEDUCTION` ventilée décrémente `remaining_days` du lot du même montant (via `lot_allocations`).
- **I5** : un `REPORT_TRANSFERT` est neutre sur le total (débit ancien = crédit nouveau, lot réattribué).
- **I6** : un lot `EXPIRE` n'est jamais consommable ; son `remaining_days` n'est remis à zéro qu'à la clôture.
- **I7** : `usableDays(c) = availableDays(c) − expiredPendingDays(c)` ; l'allocateur ne consomme jamais au-delà.
- **I8** : toute `lot_allocations` a une contrepartie (consommation maintenue, recrédit au lot d'origine, ou régularisation RH documentée).

### Transactions (verrous `pessimistic_write`)
| Opération | Verrous | Étapes atomiques |
|---|---|---|
| **Création** | source N-1 + cible N-1 | contrôle `days ≤ availableDays(source) − reservedDays(source)` → débit source + crédit cible → lot (`remaining_days=days`) → audit/notification |
| **Consommation** | cible N-1 (+ N) + lots | exclusion des lots expirés → FIFO par `expires_at`/`id` → `DEDUCTION` + `lot_allocations` + décréments |
| **Transfert (clôture)** | compteurs de la période + lots | `protégés = Σ remaining_days(non expirés)` ; `ordinaires = availableDays − protégés` → `REPORT_TRANSFERT` (protégés) + `REMISE_A_ZERO` (ordinaires + expirés) → lots réattribués |
| **Expiration** | lot + compteur | à la clôture : `EXPIRE` + `REPORT_EXPIRATION` ; en cours d'année : simple exclusion du pool (aucune mutation) |
| **Recrédit (annulation)** | lot + compteur | via `lot_allocations` : `remaining_days += j`, `availableDays += j`, `consumedDays -= j` si lot **non expiré** ; sinon **régularisation RH contrôlée** (jamais de transformation automatique en jours ordinaires) |

Concurrence : une transaction unique verrouille compteur **et** lots ; ordre FIFO déterministe.

## A4. Dates légales (limites à tester)

- `addMonthsClamp(date, 15)` : plafonnement au dernier jour du mois (31/01 → 30/04 ; 31/05 → 31/08).
- Années bissextiles : 29/02 (entrée et sortie).
- Suspension : `expires_at = base + (information_date − reprise_date)` en jours calendaires.
- Information tardive : reprise 01/03/2026, information 01/06/2026 → +92 j.
- Bornes : date de congé **le jour même** de `expires_at` → consommable ; **le lendemain** → non consommable.
- Salarié toujours absent : `expires_at = base` ; lendemain → non consommable.
- **Ventilation par dates** : congé chevauchant l'échéance (ex. 28/08 → 03/09, échéance 31/08) → les dates ≤ 31/08 sur le lot, les dates > 31/08 hors lot.
- Demi-journées : matin/après-midi autour de l'échéance (ex. après-midi du 31/08 sur lot, matin du 01/09 hors lot).
- Règles GMES du samedi appliquées à la ventilation (vendredi après-midi → samedi).

## A5. Données médicales (minimisation et accès)

- `carryover_lots` : **aucun contenu médical** (pas de diagnostic, pas de certificat).
- Uniquement : `origin`, `absence_start_date`/`absence_end_date` (dates seules), `reprise_date`, `information_date`/`information_mode`.
- `proof_id` = **preuve d'information** (bulletin/courrier/accusé), pas le justificatif médical.
- Justificatifs médicaux : restent dans `absence_declarations`/`documents` avec les permissions existantes (RH + salarié concerné).
- Accès lots : **RH + salarié concerné uniquement** ; dates d'absence non visibles des managers/validateurs.
- Si une donnée médicale serait nécessaire → lot `A_VERIFIER`, sans enregistrement.

## A6. Accords GMES (à confirmer par la RH)

1. Convention collective applicable à GMES (Syntec ? autre ?) — **à prouver**.
2. Dispositions « report maladie » (durée > 15 mois, conditions).
3. Accord d'entreprise/établissement fixant une durée supérieure (L3141-21-1).
4. Cartographie `legal_entities` : règles par entité.
5. Moyen d'information admis comme « date certaine » en interne.
6. À défaut de preuve : **15 mois** (socle légal).

## A7. Déploiement et retour arrière sûrs

### Interdiction de réactiver une clôture destructrice
- Le flag `CARRYOVER_CLOSURE_PROTECTION` **ne peut pas être désactivé** s'il existe des lots protégés non expirés : dans ce cas, `closeReferencePeriod` **refuse la clôture** (ou exige une confirmation RH explicite) au lieu de retomber sur l'ancienne remise à zéro inconditionnelle.
- **Interlock** : toute clôture vérifie, en transaction, l'absence de lots protégés non expirés avant de remettre à zéro. Aucune configuration ne peut contourner ce garde-fou.

### Stratégie de compatibilité
- `CARRYOVER_LOTS_ENABLED` (saisie), `CARRYOVER_EXPIRY_ENFORCED` (expiration à l'imputation), `CARRYOVER_CLOSURE_PROTECTION` (clôture conditionnelle) : **L4 et L5 ne sont activés qu'après une recette conjointe** (consommation, expiration et clôture cohérentes ensemble).
- Les lots créés avant l'activation restent **inertes** (aucun effet) ; les données déjà créées ne sont **jamais** supprimées par un changement de configuration.

### Sauvegarde / restauration
- **Sauvegarde intégrale restaurable** avant chaque phase (dump + schéma).
- **Restauration vérifiée** : test de restauration réelle sur l'environnement isolé avant et après chaque phase ; contrôle des invariants I1–I8 après activation et après rollback.
- Le rollback réel = **restauration de la sauvegarde** (pas un simple toggle), si nécessaire ; sinon, désactivation des flags + lots inertes (aucune perte de données).

---

# PARTIE B — Découpage en lots de développement

| Lot | Contenu | Modifications autorisées | Tests obligatoires | Critères de validation |
|---|---|---|---|---|
| **L0** | Décisions RH/Juridique (bloquant) | — | — | Réponses aux décisions §D ci-dessous. |
| **L1** | Structure additive + inventaire (cf. Partie C) | Migration additive `carryover_lots` ; entity ; inventaire lecture seule ; backfill inerte | Non-régression intégrale ; inventaire exact ; lots inertes | Aucun effet sur soldes/mouvements/clôture ; aucune requalification |
| **L2** | `computeExpiry` pur + `addMonthsClamp` + suspension | Service pur | Cas de dates A4 | 100 % des cas ; jamais d'expiration sur donnée manquante |
| **L3** | Report enrichi + vue RH | DTO, création de lots, écran « Reports maladie » | Création lot, échéance affichée + fondement | Invariants I1/I3 ; non-régression report |
| **L4** | Consommation ventilée par dates + expiration + recrédit | `calculateDeductedLeaveDays` (liste datée), `leave-allocation.util.ts`, `leave-balances.service.ts`, `lot_allocations`, annulations | Chevauchenement d'échéance ; demi-journées ; FIFO ; lot expiré non consommable ; recrédit avant/après échéance ; demandes partielles ; validations tardives ; concurrence | Aucune double déduction ; I4/I6/I7/I8 ; jamais de lot expiré consommé en ordinaire |
| **L5** | Clôture conditionnelle + transport + interlock | `reference-period.service.ts` (close + preview), `PeriodClosureModal.jsx` | Deux clôtures ; transport sans double crédit ; protégés conservés ; lots expirés remis à zéro ; interlock anti-désactivation | I1/I2/I5 ; prévisualisation ordinaires/protégés/à vérifier |
| **L6** | Espace collaborateur + preuve d'information | `MyBalancePage.jsx`, notifications, accusé daté | Affichage échéance ; accusé daté ; notification ≠ preuve | Aucune donnée médicale exposée |
| **L7** | Audit, alertes RH, contrôle I1–I8, rollback | service audit/alertes, doc exploitation | Alertes ; rupture d'invariant ; rollback testé | Aucune règle incomplète sans flag ; rollback sans perte |

**Ordre** : L0 (bloquant) → L1 → L2 → L3 → **L4 + L5 co-validés ensemble** (puis L6) → L7. L4/L5 ne sont jamais activés séparément en production.

---

# PARTIE C — Périmètre exact du lot L1

**Objectif** : poser la structure de données (additive), produire un inventaire historique **en lecture seule**, et garantir la non-régression. **Aucun calcul, aucune expiration, aucune protection, aucune modification de comportement.**

### C1. Migration additive `AddCarryoverLots` (non exécutée à ce stade)
- Création de la table `carryover_lots` (colonnes cf. audit §4.1) avec `remaining_days` **nullable** (inconnu), enums `regime`, `origin`, `status`, `target_counter_type`, `information_mode`.
- Index : `(employee_id, status)`, `(target_reference_period, target_counter_type)`, `(expires_at)`.
- **Aucune** `ALTER` sur les tables existantes, **aucune** suppression de données.
- Idempotent (rejouable).

### C2. Entité + dépôt minimal
- `CarryoverLot` (TypeORM), lecture seule à ce stade.

### C3. Inventaire de rapprochement (lecture seule)
- Service/script listant les mouvements `REPORT_EXCEPTIONNEL` (crédits uniquement, hors `REPORT_EXCEPTIONNEL_DEBIT`), par salarié/période :
  - Σ jours reportés ;
  - `availableDays` courant du compteur cible ;
  - Σ `DEDUCTION`, Σ `REMISE_A_ZERO` sur le compteur cible ;
  - fourchette indicative `[0, days]` — **sans attribution**.
- **Aucune écriture** sur `leave_balances`, `balance_movements` ou `audit_logs`.

### C4. Backfill inerte
- Insertion de lots **informatifs** : `origin=AUTRE`, `regime=GENERAL`, `status=A_VERIFIER`, `remaining_days=NULL`, `expires_at=NULL`, `days = mouvement.days`.
- Ces lots ne participent à **aucun** pool, protection ou expiration.
- **Aucune requalification automatique** (« maladie » dans un motif n'est pas une preuve).

### C5. Tests de non-régression (à réexécuter sur l'environnement isolé)
- JUR-027 correction (débit source) : `retest-jur027-correction` (24/24), `retest-jur027-correction-cloture` (7/7).
- L3141-7 + GMES : 11/11 + 18/18.
- Prévisualisation : `retest-preview-cloture` (17/17), `retest-preview-l3141` (3/3).
- Protections de clôture (demandes non imputées) : `retest-etape3-apres` (7/7).
- Quatre circuits de validation (recette existante).
- **Nouveau** : `retest-l1-inventory` (l'inventaire est exact et sans écriture) ; `retest-l1-inert` (les lots L1 ne modifient ni soldes, ni mouvements, ni clôture).

### C6. Fichiers et scripts envisagés (non créés, non exécutés)
- `backend/src/migrations/<timestamp>-add-carryover-lots.ts`
- `backend/src/leave-balances/carryover-lot.entity.ts`
- `backend/src/leave-balances/carryover-lots.service.ts` (méthode d'inventaire lecture seule)
- `tests/recette/scripts/retest-l1-inventory.mjs`
- `tests/recette/scripts/retest-l1-inert.mjs`

**Critère de sortie du L1** : migration additive rejouable ; inventaire exact et sans écriture ; lots L1 inertes (aucune variation de `availableDays`/`acquiredDays`/`consumedDays`/`reservedDays`, comportement de clôture/consommation identique) ; non-régression verte.

---

# PARTIE D — Décisions RH/Juridiques restantes (indispensables avant L2–L5)

1. **Durée** : 15 mois confirmés ; points de départ par régime (L3141-19-1 / L3141-19-2) validés.
2. **Convention/accord** (L3141-21-1) : texte applicable à GMES, durée supérieure éventuelle, **à prouver**.
3. **Taxonomie** : `MALADIE`/`AT_MP`/`AUTRE` et régimes `GENERAL`/`ARRET_LONG`.
4. **Consommation** : FIFO par échéance la plus proche ; ventilation par dates effectives (avec règles GMES du samedi et demi-journées) validée.
5. **Preuve d'information** (L3141-19-3) : moyen admis comme « date certaine » (accusé daté, bulletin, courrier).
6. **Données manquantes/contradictoires** : `A_VERIFIER`/`SUSPENDU`, jamais d'expiration automatique.
7. **Chevauchement d'échéance** : toute dérogation à la règle stricte (validation antérieure) doit être justifiée et validée.
8. **Recrédit** : règle RH pour un recrédit dont le lot est expiré (régularisation contrôlée, jamais automatique).
9. **Anciens reports** : résolution documentée obligatoire avant d'activer toute protection ou clôture de droits incertains.

---

**Rappel** : aucune migration, aucun code, aucune base, aucun commit/push tant que L0/D ne sont pas validés. **JUR-027 reste « Bloqué ».**
