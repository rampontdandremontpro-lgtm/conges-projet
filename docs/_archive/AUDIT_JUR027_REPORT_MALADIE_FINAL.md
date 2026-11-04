# JUR-027 — Audit final : protection des congés payés reportés pour maladie

**Date** : 26/10/2026 — **version corrigée (v2)**
**Nature** : analyse et conception (aucune modification de code, de donnée ou de cahier).
**Statut JUR-027** : **Bloqué** (aucune évolution sans validation RH).

> **Rectification importante (v2)** : la v1 laissait entendre (i) que tous les reports démarrent à la date d'information et (ii) qu'un salarié toujours absent ne peut jamais perdre ses droits. Ces deux affirmations sont **fausses** pour le régime des arrêts longs (L3141-19-2). La présente version corrige le régime juridique, le calcul des échéances et la conception des lots.

---

## 1. Diagnostic précis du fonctionnement actuel (inchangé par rapport à la v1)

Réponses factuelles aux 10 questions, fondées sur la lecture du code et du schéma (17 tables).

| # | Question | Réponse |
|---|---|---|
| 1 | Identification des congés reportés pour maladie | **Non.** Le report (`POST /leave-balances/period/carryover`) est générique : `employeeId`, `closingReferencePeriod`, `days`, `reason` libre. Aucun champ « maladie ». |
| 2 | Distinction d'un report ordinaire | **Non.** Un seul mécanisme ; l'origine n'est pas structurée (seule trace : `REPORT_EXCEPTIONNEL\|…` en texte libre). |
| 3 | Date de reprise | **Non enregistrée.** `absence_declarations` a `start_date`/`end_date`/`duration_days`/`status`/`verified_at`, pas de « date de reprise ». |
| 4 | Date d'information au salarié | **Non.** Notification = `created_at`/`read_at`/`email_sent_at` ; aucune preuve de réception à date certaine. |
| 5 | Date d'expiration individualisée | **Non.** Aucun `expires_at`. |
| 6 | Plusieurs échéances | **Impossible.** Tous les jours reportés s'agrègent dans le même N-1 de destination. |
| 7 | Consommation | `allocatePaidLeave` : N-1 d'abord (tri par période), puis N. Pas de ventilation par lot/échéance. |
| 8 | Devenir à la clôture | `closeReferencePeriod` fait `REMISE_A_ZERO` de tout solde positif, **y compris les jours reportés maladie** → détruits sans contrôle d'échéance. |
| 9 | Écrans RH/collaborateur | Aucun n'affiche origine ni échéance. |
| 10 | Notifications / preuve | Envoi ≠ réception ; pas de preuve juridiquement certaine. |

---

## 2. Anomalies confirmées et risques non encore reproduits

**Confirmées (code)** : absence d'origine/échéance/date d'information ; clôture supprime sans contrôle ; notification sans date limite. *(Le double usage du report — débit de la source — est déjà corrigé et validé : 24/24 + 7/7.)*

**Risques non reproduits (à recetter)** : report → clôture avant échéance → jours perdus ; multi-lots ; salarié toujours absent (régime L3141-19-2) ; reprise avant/après échéance ; information tardive/absente ; échéance manquante ; coexistence maladie/ordinaire.

---

## 3. Règles juridiques vérifiées (textes officiels, code du travail)

**Textes consultés** (Code du travail numérique / Légifrance, mis à jour 24/04/2024) :

### L3141-19-1 — règle générale
« Lorsqu'un salarié est dans l'impossibilité, pour cause de maladie ou d'accident, de prendre au cours de la période de prise de congés tout ou partie des congés qu'il a acquis, il bénéficie d'une **période de report de quinze mois** afin de pouvoir les utiliser. La période de report **débute à la date à laquelle le salarié reçoit, après sa reprise du travail, les informations prévues à l'article L3141-19-3**. »

→ Régime **« congés non pris à cause d'un arrêt »** : point de départ = **date de réception de l'information** (après reprise). Échéance = `information_date + 15 mois`.

### L3141-19-2 — régime particulier des arrêts longs
« **Par dérogation** au second alinéa de l'article L3141-19-1, lorsque les congés ont été **acquis au cours des périodes mentionnées aux 5° ou 7° de l'article L3141-5**, la période de report **débute à la date à laquelle s'achève la période de référence** au titre de laquelle ces congés ont été acquis **si, à cette date, le contrat de travail est suspendu depuis au moins un an** en raison de la maladie ou de l'accident. **En cas de reprise du travail, la période de report, si elle n'a pas expiré, est suspendue jusqu'à ce que le salarié ait reçu les informations prévues à l'article L3141-19-3.** »

→ Régime **« congés acquis pendant un arrêt long »** :
- Condition : suspension ≥ **1 an** à la fin de la période de référence, pour maladie/accident (L3141-5 5° AT/MP ou 7° maladie non professionnelle).
- Point de départ : **fin de la période de référence** d'acquisition (`reference_period_end`).
- Échéance de base : `reference_period_end + 15 mois`.
- **Reprise avant expiration** : le **reliquat** du délai est **suspendu** de `reprise_date` jusqu'à `information_date` ; l'échéance effective = `reference_period_end + 15 mois + (information_date − reprise_date)`.
- **Salarié encore absent à l'échéance** : le délai a couru depuis la fin de la période de référence ; **les jours peuvent expirer** (aucune suspension sans reprise).

### L3141-19-3 — obligation d'information
« Au terme d'une période d'arrêt de travail pour cause de maladie ou d'accident, l'employeur porte à la connaissance du salarié, **dans le mois qui suit la reprise du travail**, les informations suivantes, **par tout moyen conférant date certaine à leur réception, notamment au moyen du bulletin de paie** : 1° le nombre de jours de congé dont il dispose ; 2° la date jusqu'à laquelle ces jours peuvent être pris. »

→ La **preuve de réception à date certaine** est une condition du déclenchement du délai (régime général) et de la levée de suspension (arrêt long). **Une notification envoyée n'est pas une réception.**

### L3141-21-1 — dispositions conventionnelles plus favorables
« Un accord d'entreprise ou d'établissement ou, à défaut, une convention ou un accord de branche peut fixer une **durée de la période de report supérieure** à celle prévue à l'article L3141-19-1. »

→ Une durée plus longue ne s'applique **qu'après confirmation** du texte applicable à GMES (aucune convention n'est présumée).

### L3141-5 (5° et 7°) — périodes assimilées au travail effectif
- **5°** : suspension pour **accident du travail ou maladie professionnelle** (AT/MP).
- **7°** : suspension pour **arrêt de travail lié à un accident ou une maladie n'ayant pas un caractère professionnel**.

→ L3141-19-2 couvre donc les congés **acquis pendant** ces suspensions (AT/MP comme maladie non professionnelle), lorsque la suspension a atteint **au moins un an** à la fin de la période de référence.

### Synthèse des deux régimes
| | Régime général (L3141-19-1) | Arrêt long (L3141-19-2) |
|---|---|---|
| Objet | Congés **non pris** à cause d'un arrêt | Congés **acquis pendant** un arrêt ≥ 1 an |
| Point de départ | `information_date` (après reprise) | fin de la période de référence d'acquisition |
| Suspension | — | oui, de `reprise_date` à `information_date` (si reprise avant expiration) |
| Salarié toujours absent | sans objet (reprise nécessaire pour informer) | le délai court ; **les jours peuvent expirer** |

---

## 4. Solution technique recommandée (conception comptable des lots)

### 4.1. Table `carryover_lots`

| Colonne | Type | Rôle |
|---|---|---|
| `id` | bigint PK | |
| `employee_id` | bigint FK users | salarié |
| `regime` | enum(`GENERAL`, `ARRET_LONG`) | L3141-19-1 ou L3141-19-2 |
| `origin` | enum(`MALADIE`, `AT_MP`, `AUTRE`) | origine (5° AT/MP, 7° maladie, autre) |
| `source_reference_period` | varchar(20) | période d'origine des droits |
| `target_reference_period` | varchar(20) | période/compteur de rattachement courant |
| `target_counter_type` | enum(`N-1`,`N`,`N+1`) | compteur courant (par défaut N-1 de destination) |
| `days` | decimal(7,2) | quantité initiale |
| `remaining_days` | decimal(7,2) | quantité restante (≥ 0) |
| `absence_start_date` / `absence_end_date` | date nullables | arrêt (si pertinent) |
| `reprise_date` | date nullable | reprise effective |
| `information_date` | date nullable | date de réception certaine (L3141-19-3) |
| `information_mode` | enum nullable | bulletin de paie, courrier, accusé applicatif… |
| `proof_id` | bigint nullable | justificatif / accusé (documents) |
| `expires_at` | date nullable | échéance calculée |
| `expiry_basis` | text | fondement du calcul (traçabilité) |
| `status` | enum(`ACTIF`, `SUSPENDU`, `EXPIRE`, `A_VERIFIER`) | état du lot |
| `reason` | text | justification |
| `created_at` / `created_by` | | traçabilité |

### 4.2. Création d'un lot (RH)
1. La RH saisit : salarié, `regime`/`origin`, période de référence d'origine, nombre de jours, dates d'arrêt/reprise (si pertinentes), `information_date` et `information_mode`, justificatif.
2. Le système calcule `expires_at` (cf. §4.6) et stocke `expiry_basis`.
3. Le lot est **rattaché au compteur de destination** (N-1 de la période suivante, ou N-1 courant selon le flux choisi) ; les jours sont débités de la source et crédités sur la cible **comme aujourd'hui** (mouvements `REPORT_EXCEPTIONNEL_DEBIT` / `REPORT_EXCEPTIONNEL`), **plus** la ligne de lot.
4. **Invariant** : `availableDays(cible) = jours ordinaires(cible) + Σ remaining_days(lots rattachés à la cible)`.

### 4.3. Cohérence avec les compteurs et mouvements
- `acquiredDays` : crédité au report (cible) et débité (source), comme aujourd'hui.
- `availableDays` : somme des jours ordinaires + lots protégés ; inchangé dans sa sémantique.
- `reservedDays` / `consumedDays` : inchangés (le report n'est ni une réservation ni une consommation).
- `remaining_days(lot)` : décrémenté à chaque imputation ventilée sur ce lot.
- `balance_movements` : chaque opération reste tracée (`REPORT_EXCEPTIONNEL*`, `DEDUCTION`, `REMISE_A_ZERO`, `REPORT_TRANSFERT`, `REPORT_EXPIRATION`).
- **Règle d'audit** : `Σ remaining_days ≤ availableDays(cible)` en permanence ; toute rupture est une anomalie bloquante.

### 4.4. Consommation (ventilation par échéance)
`allocatePaidLeave` continue d'imputer N-1 puis N. Sur un compteur porteur de lots, la part imputée est **ventilée FIFO par échéance la plus proche** (`remaining_days -= part`), puis sur les jours ordinaires. Les champs `consumedDays`/`availableDays` du compteur évoluent comme aujourd'hui (pas de double déduction).

### 4.5. Transport entre périodes (sans double crédit)
À la clôture, pour le N-1 clôturé :
1. `jours protégés = Σ remaining_days(lots non expirés ou A_VERIFIER)`.
2. `jours ordinaires = availableDays − jours protégés`.
3. Les **jours protégés sont transportés** vers le N-1 de la période suivante (mouvement `REPORT_TRANSFERT`), et chaque lot voit son `target_reference_period`/`target_counter_type` mis à jour **sans modification de `remaining_days`** (pas de nouveau crédit).
4. Les **jours ordinaires et les lots expirés** sont remis à zéro (`REMISE_A_ZERO`, `REPORT_EXPIRATION`).
5. Le transfert ordinaire N → N-1 reste inchangé. **Aucun double crédit** : les jours protégés sont déplacés, pas recréés.

### 4.6. Calcul des échéances (deux mécanismes)

**Régime général (L3141-19-1)** :
`expires_at = information_date + 15 mois` (ou durée conventionnelle confirmée). Si `information_date` manquante → `status=A_VERIFIER`, **pas d'expiration**.

**Arrêt long (L3141-19-2)** :
- Vérifier : suspension ≥ 1 an à la fin de la période de référence (d'après les absences) et congés acquis pendant les périodes L3141-5 5°/7°.
- `base = reference_period_end + 15 mois`.
- Si `reprise_date < base` : `expires_at = base + (information_date − reprise_date)` (suspension du reliquat). Si `information_date` manquante → `status=SUSPENDU` (pas d'expiration tant que l'information n'est pas datée).
- Si toujours absent à `base` : `expires_at = base` (expiration possible).

**Règle de prudence** : toute donnée **manquante ou contradictoire** (absence, reprise, information, régime) → `status=A_VERIFIER`, **aucune expiration automatique**, signalement RH. Une convention plus favorable n'est appliquée qu'après confirmation.

### 4.7. Espace RH
- Formulaire de report enrichi : `regime`, `origin`, période d'origine, jours, dates arrêt/reprise, `information_date`+`mode`, justificatif, échéance calculée + fondement.
- Vue « Reports maladie » : liste des lots (salarié, régime, origine, jours, restants, échéance, statut).
- **Prévisualisation de clôture** : distinguer `jours ordinaires` / `jours protégés` / `situations à vérifier` (lots `A_VERIFIER` ou `SUSPENDU`).
- **Confirmation de clôture** : rappeler les jours protégés conservés et les lots à vérifier.

### 4.8. Espace collaborateur
- Solde détaillé : « X jours à prendre avant le JJ/MM/AAAA » par lot.
- Notification de report : nombre + **date limite** + mode d'information.
- **Preuve de réception** : accusé de connaissance daté (bouton « j'ai pris connaissance » enregistrant une date) et/ou bulletin de paie/courrier — **à valider** (une notification envoyée n'est pas une preuve).

### 4.9. Historique vérifiable
`carryover_lots` + `balance_movements` + `audit_logs` : qui, quand, combien, origine, régime, échéance, consommation et transport par lot.

---

## 5. Exemples corrigés (dates et jours)

**Exemple 1 — régime général (congés non pris)**
- Période 2024-2025 : 25 j acquis ; arrêt 10/04/2025 → reprise 20/06/2025 ; 10 j non pris.
- Information datée le 25/06/2025 → `expires_at = 25/09/2026` (25/06/2025 + 15 mois).
- Clôture 31/05/2026 : les 10 j **sont conservés** (échéance future). Clôture 31/05/2027 : expirés si non pris.

**Exemple 2 — arrêt long, reprise avant échéance**
- Suspension depuis le 01/01/2025 (maladie non pro) ; à la fin de la période 2024-2025 (31/05/2025), suspension = 5 mois → **pas encore 1 an** → L3141-19-2 ne s'applique pas (régime général).
- Variante : suspension depuis le 01/03/2024 ; au 31/05/2025, suspension = 15 mois (≥ 1 an). Congés **acquis pendant** la suspension : `base = 31/05/2025 + 15 mois = 31/08/2026`.
- Reprise 01/03/2026 (avant `base`), information datée 01/04/2026 → suspension de 1 mois → `expires_at = 30/09/2026`.
- Les clôtures 31/05/2025 et 31/05/2026 conservent les jours.

**Exemple 3 — arrêt long, salarié toujours absent à l'échéance**
- Même `base = 31/08/2026`. Salarié toujours en arrêt au 31/08/2026 (aucune reprise) → **pas de suspension** → les jours **expirent le 31/08/2026**. *(Rectification : l'absence continue n'empêche pas l'expiration.)*

**Exemple 4 — information tardive ou absente**
- `information_date` absente → `status=A_VERIFIER`/`SUSPENDU` : **pas d'expiration**, signalement RH, jours conservés aux clôtures.

**Exemple 5 — plusieurs lots**
- Lot A : 6 j, échéance 30/09/2026 ; lot B : 4 j, échéance 31/01/2027. Congé imputé 7 j → FIFO : 6 j (lot A) + 1 j (lot B) ; `remaining_days` : A=0, B=3.

---

## 6. Fichiers et tables concernés (pour information)

- **Nouvelle table** : `carryover_lots` (+ éventuels enums/colonnes d'index).
- **Backend** : `reference-period.service.ts` (report, clôture, prévisualisation), `leave-balances.service.ts` (ventilation), `leave-allocation.util.ts` (FIFO par échéance), `exceptional-carryover.dto.ts`, contrôleur, nouveau `carryover-lots.service.ts`.
- **Frontend** : `PeriodClosureModal.jsx`, `BalancesPage.jsx`, `MyBalancePage.jsx`, styles.
- **Existant non modifié** : quatre circuits, acquisition 2,5 j/mois, arrondis GMES, `closeReferencePeriod` hors remise à zéro conditionnelle.

---

## 7. Tests de recette indispensables

1. **Régime général** : report avec `information_date` → échéance correcte ; conservation à la clôture avant échéance.
2. **Arrêt long** : congés acquis pendant suspension ≥ 1 an → échéance depuis fin de période ; **reprise avant échéance** → suspension du reliquat ; **reprise après échéance** → expiration.
3. **Salarié toujours absent à l'échéance** → expiration (pas de suspension).
4. **Information tardive** → échéance décalée ; **information absente** → `A_VERIFIER`, pas d'expiration.
5. **Plusieurs lots** à échéances distinctes → consommation FIFO.
6. **Consommation** : imputation ventilée sans double déduction.
7. **Congés en attente de validation** : pas d'imputation avant validation ; verrou de clôture inchangé.
8. **Deux clôtures successives** : transport sans double crédit ni double remise à zéro.
9. **Reports anciens** : migration → `AUTRE`/`A_VERIFIER`, **aucune requalification automatique** depuis un motif contenant « maladie ».
10. **Droits protégés traversant plusieurs périodes** : transport en chaîne.
11. **Non-régression** : double usage JUR-027 (24/24 + 7/7), L3141-7 (11/11 + 18/18), quatre circuits, arrondis GMES, compteurs N−1/N/N+1, prévisualisation/confirmation.

---

## 8. Décisions à valider par la RH avant tout développement

1. **Durée du report** : 15 mois confirmé ? Point de départ par régime (cf. §3) validé ?
2. **Durée conventionnelle** (L3141-21-1) : un accord applicable à GMES fixe-t-il une durée **supérieure** ? (à prouver, sinon 15 mois).
3. **Taxonomie** : `MALADIE` / `AT_MP` / `AUTRE` ; les régimes `GENERAL` / `ARRET_LONG` suffisent-ils ?
4. **Consommation** : FIFO par échéance la plus proche ?
5. **Preuve d'information** (L3141-19-3) : accusé applicatif daté, bulletin de paie, courrier — lequel est exigé comme « moyen conférant date certaine » ?
6. **Données manquantes/contradictoires** : conservation + `A_VERIFIER` (recommandé), jamais d'expiration automatique.
7. **Saisie de l'échéance** : calculée automatiquement (régime + dates) ou ajustable par la RH ?
8. **Reports anciens** : laissés en `AUTRE`/`A_VERIFIER` sans requalification automatique ?

---

**Conclusion** : la conception par lots est conservée, avec **deux régimes d'échéance distincts** (L3141-19-1 et L3141-19-2), une **comptabilité réconciliée** avec les compteurs existants, un **transport sans double crédit** et une **remise à zéro conditionnelle**. Toute donnée manquante empêche l'expiration automatique et déclenche un signalement RH. **JUR-027 reste « Bloqué »** ; aucun développement sans validation.
