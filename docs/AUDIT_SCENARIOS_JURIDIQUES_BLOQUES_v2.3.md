# Audit des 14 scénarios juridiques bloqués — cahier v2.3

**Date** : 26/10/2026
**Périmètre** : module 20 « Conformité juridique » — scénarios JUR-019 → JUR-032 + JUR-037 (14 scénarios bloqués).
**Objet** : déterminer ce qui est couvert par les fonctionnalités existantes (notamment les opérations manuelles RH), ce qui relève d'une procédure RH externe, et ce qui nécessite réellement une évolution logicielle.
**Règle directrice** : aucune fonctionnalité n'a été développée ; aucune nouvelle fonctionnalité ne doit être développée sans autorisation. Les opérations manuelles RH tracées font partie des fonctionnalités existantes.

---

## 1. Synthèse générale

- **6 scénarios sur 14 peuvent être débloqués sans développement** : leur besoin est couvert par une fonctionnalité existante (correction manuelle RH, report exceptionnel, types d'absence déclaratifs, justificatifs, historique, audit, notifications, entreprises de rattachement), sous réserve d'une **validation ou d'une procédure RH**.
- **7 scénarios sur 14 nécessiteraient une évolution logicielle** pour automatiser ce qui n'existe pas (ancienneté, fractionnement, période de prise, interaction arrêt/congé, convention par entité). Pour **5 d'entre eux**, un contournement manuel existe déjà (correction RH positive/négative, report exceptionnel) : l'évolution est donc **facultative**.
- **1 scénario (JUR-037)** relève d'une **validation RH externe** (droits pendant arrêt maladie) : le logiciel fournit la traçabilité, mais la détermination des droits appartient à la RH.
- **9 scénarios dépendent de la confirmation de la convention collective Syntec ou d'un accord d'entreprise** (E).

### Catégories utilisées
- **A** — Couvert par une fonctionnalité existante et potentiellement testable.
- **B** — Couvert partiellement, avec des limites à préciser.
- **C** — Nécessite une validation ou une procédure RH extérieure à l'application.
- **D** — Nécessite réellement une évolution de l'application.
- **E** — Dépend de la confirmation de la convention collective ou d'un accord d'entreprise.

---

## 2. Tableau des 14 scénarios

| ID | Thème | Catégorie | Statut actuel | Déblocable sans dev ? |
|---|---|---|---|---|
| JUR-019 | Ancienneté Syntec (+1/+2/+3/+4 j) | B + C + D + E | **Conforme techniquement — homologation RH en attente** | **Oui** (attribution auto idempotente + traçabilité, config par entité) |
| JUR-020 | Date d'appréciation de l'ancienneté | B + C + E | **Conforme techniquement — homologation RH en attente** | **Oui** (date de référence configurable, années révolues) |
| JUR-021 | Fractionnement Syntec (jours ouvrés) | B + C + D + E | **Conforme techniquement — homologation RH en attente** | **Oui** (calcul auto sur congés pris + recalcul après annulation) |
| JUR-022 | Fractionnement légal supplétif | B + C + D + E | **Conforme techniquement — homologation RH en attente** | **Oui** (régime configurable par entité, sans cumul) |
| JUR-023 | Période de prise 13 mois | B + C + D + E | **Conforme techniquement — homologation RH en attente** | **Oui** (fenêtre 13 mois paramétrable + alerte échéance + soldes non supprimés) |
| JUR-024 | Dispositions plus favorables | B + C + E (D implémenté) | **Conforme techniquement — homologation RH en attente** | Oui (configuration de la convention par entité, aucune présumée) |
| JUR-025 | Acquisition pendant AT/MP | A + C | Bloqué | **Oui** (couverture implicite : l'acquisition ne réduit pas) |
| JUR-027 | Report congés après maladie | A + B + C | **Technique validée (test) — homologation RH en attente** | **Oui** (recette technique terminée et validée ; 3 règles provisoires en attente de confirmation RH) |
| JUR-028 | Interaction arrêt / congés posés | B + C + D | Bloqué | Non (automatisation absente ; contournement manuel) |
| JUR-029 | Événements familiaux | A + B + C + E | Bloqué | **Oui** (types configurables + justificatifs) |
| JUR-030 | Deuil / situations familiales | A + B + C + E | Bloqué | **Oui** (idem JUR-029) |
| JUR-031 | Maternité, paternité, adoption | A + B + C + E | Bloqué | **Oui** (types déclaratifs auto-créés, testé) |
| JUR-032 | Dispositions Syntec 2026 | A + C + E | Bloqué | **Oui** (type « congé supplémentaire de naissance » déjà présent) |
| JUR-037 | Droits pendant arrêt maladie | B + C | Bloqué | Non (validation RH externe requise) |

---

## 3. Analyse détaillée

### JUR-027 — Report des congés non pris après maladie (PRIORITÉ)

**Ce que demande le scénario** : reporter les congés non pris en raison d'un arrêt maladie / AT-MP, avec un délai de report (15 mois — Service-Public F37482).

**Ce que l'application permet aujourd'hui** (mécanisme de report exceptionnel RH, `POST /leave-balances/period/carryover`, rôle RH) :
1. ✅ La RH peut reporter manuellement des jours (endpoint dédié).
2. ✅ Elle choisit le nombre exact de jours (`days`, min 0,01, 2 décimales).
3. ✅ Le solde est mis à jour (le compteur N-1 de la période suivante est crédité en `acquiredDays` + `availableDays`).
4. ✅ Le motif est conservé (`reason` obligatoire, dans la raison du mouvement `REPORT_EXCEPTIONNEL|{période}|{motif}` et dans l'audit).
5. ✅ L'auteur est enregistré (`actorId` dans le mouvement et dans l'audit).
6. ❌ **Aucune date limite de prise des jours reportés n'est suivie** (aucun champ « échéance » pour le report ; la seule notion d'échéance existante concerne les dérogations, pas le report).
7. ✅ Le report est **distinguable** d'un transfert ordinaire N→N-1 (raison `REPORT_EXCEPTIONNEL|…` vs `CLOTURE_TRANSFERT_N|…`).
8. ⚠️ **Information du salarié** : une notification `EXCEPTIONAL_CARRYOVER_APPROVED` est envoyée (« X jour(s) ont été reportés vers la période … »), mais elle **ne mentionne pas de délai d'utilisation** ; les jours reportés sont visibles dans le compteur N-1 de la période suivante.
9. ⚠️ **Obligations légales de durée** : le mécanisme permet le report, mais le respect du délai de 15 mois et de ses exceptions n'est **ni contrôlé ni tracé** par le logiciel — c'est la RH qui l'applique.

**Services / API / composants** : `reference-period.service.ts` (`approveExceptionalCarryover`), `leave-balances.controller.ts` (`POST /period/carryover`), `BalanceMovement` (type `CORRECTION_POSITIVE`, raison préfixée `REPORT_EXCEPTIONNEL`), `AuditLog` (`EXCEPTIONAL_CARRYOVER_APPROVED`), `NotificationsService` (`EXCEPTIONAL_CARRYOVER_APPROVED`).

**Preuves disponibles** : `tests/recette/reports/retest-jur027-report-et-absences.json` + `.log` (12/12 OK) — report de 4 jours avec motif L3141-19-1, mouvement tracé, audit, notification.

**Ce que la RH doit encore confirmer** : le délai de report applicable (15 mois) et ses exceptions ; qui suit l'échéance (logiciel vs RH).

**Lacunes** : absence de suivi de l'échéance (15 mois) ; absence de mention du délai dans la notification salarié.

**Statut justifié** : **Bloqué** tant que la procédure RH sur le délai n'est pas validée. Le mécanisme technique, lui, est **démontré conforme** (catégorie A), mais ne suffit pas à prouver à lui seul la conformité juridique du report.

**Vérification approfondie du cycle complet (26/10/2026) :**

- **Cycle SQL** (preuve `retest-jur027-cycle-cloture.json` — **11/12, 1 assertion inadaptée**) : report → source non débitée (10) + cible 4 ; consommation totale simulée (SQL) → clôture → source 0 + cible 4 = 14 ; pas de double crédit à la clôture.
- **Cycle API métier réel** (preuve `retest-jur027-circuit-reel.json` — **10/10 OK**) : la consommation est effectuée par le service métier réel `applyPaidLeaveForRequest` via un **congé direct RH** (`POST /leave-requests/rh/direct`, 10 jours imputés). Résultat identique : source 10 → 0 (mouvement `DEDUCTION`), cible = 4 (`REPORT_EXCEPTIONNEL` conservé) → **double usage confirmé par le circuit réel : 10 consommés + 4 conservés = 14 pour 10 initiaux**.
- ✅ Le report n'est **pas re-crédité** à la clôture (un seul mouvement `REPORT_EXCEPTIONNEL`).
- ❌ **Limites de suivi des échéances légales** : aucun champ « date limite » (15 mois) ; les jours reportés sont rattachés au compteur N-1 de la période suivante, qui expire à la clôture GMES suivante (~31/05), ce qui peut être **antérieur** au délai légal de 15 mois ; la notification salarié ne mentionne aucune date limite.
- ⚠️ **Obligations prises en charge manuellement par la RH** : détermination du nombre de jours à reporter, délai applicable (15 mois et exceptions pour arrêts longs), information datée au salarié (hors logiciel), suivi de l'échéance.

**Cas limites étudiés (code + tests) :**

| Cas | Résultat |
|---|---|
| Report 4/10 puis consommation de 6 jours | La source reste à 10 après report ; consommer 6 laisse 4 sur la source + 4 reportés = 8, au lieu de 6 libres attendus. Pas de débit → écart. |
| Report 4/10 puis demande de 10 jours | Acceptée (source suffisante à 10) → source 0 + cible 4 = 14 (double usage, **confirmé API réel**). |
| Report demandé plusieurs fois | `alreadyApproved` sommé : le total des reports ne peut dépasser la source (`getApprovedCarryover`). Mais la source n'est jamais débitée. |
| Report supérieur au solde restant | Refusé (400 « Le total des reports exceptionnels dépasse le reliquat N-1 disponible »). |
| Report avec jours déjà réservés | Le contrôle porte sur `availableDays` (pas `availableDays − reservedDays`) — à confirmer par test : le report peut être accordé alors que des jours sont réservés (dépassement potentiel). |
| Annulation d'une demande après report | Le report n'est lié à aucune demande : l'annulation n'impacte pas le report (pas de recrédit erroné). |
| Report suivi d'une clôture | Source remise à zéro (si > 0), report conservé ; pas de double crédit (confirmé). |
| Nouvelle tentative de clôture | Refusée (409, marqueur de clôture). |
| Reports et consommations concurrents | Transactions distinctes (`pessimistic_write`) ; la source n'étant pas débitée au report, la fenêtre de double usage subsiste. |

**Comparaison de la correction minimale :**

| Option | Effets |
|---|---|
| **Débiter immédiatement la source** | `availableDays -= jours` + mouvement tracé (ex. `REPORT_EXCEPTIONNEL` côté source). Simple ; historique cohérent ; les jours apparaissent « sortis » de la source. |
| **Réserver/isololer les jours reportés** | `reservedDays += jours` sur la source jusqu'à la clôture. Préserve la visibilité « à reporter » ; bloque la consommation ; mais nécessite de libérer à la clôture et de gérer les annulations. |

**Recommandation** : **débiter la source** au moment du report (option la plus simple), avec un mouvement tracé distinct (crédit cible + débit source). Impacts à vérifier : `acquiredDays` (ne pas le diminuer à tort), `availableDays` (débit), `reservedDays` (inchangé), `consumedDays` (ne pas l'incrémenter : le jour est reporté, pas consommé), corrections RH (inchangées), annulations (sans objet), clôture N→N-1 (la source déjà débitée ne sera pas remise à zéro deux fois), reports déjà enregistrés (compatibilité), opérations concurrentes (verrou `pessimistic_write` sur la source dans la transaction du report).

**Correction appliquée et validée (26/10/2026)** : `approveExceptionalCarryover` débite désormais la source (`availableDays` et `acquiredDays`) et crédite la cible dans la même transaction, avec contrôle du solde libre (`availableDays − reservedDays`). Preuves : `retest-jur027-correction.json` (24/24 OK), `retest-jur027-correction-cloture.json` (7/7 OK), non-régression L3141-7 (11/11 et 18/18 OK).

**Échéances légales (15 mois vs clôture GMES) :**

- Aujourd'hui, les jours reportés sont rattachés au N-1 de la période suivante et seraient remis à zéro à la **clôture GMES suivante (~31/05)**, potentiellement **avant** l'échéance légale de 15 mois.
- La RH ne peut donc pas garantir le maintien des jours jusqu'à l'échéance légale sans intervention manuelle (nouveau report exceptionnel à chaque clôture, ou suivi hors logiciel).
- **Changement minimal** (sans gestion complète des arrêts maladie) : tracer une **date d'échéance facultative** sur le report afin d'exclure ces jours de la remise à zéro jusqu'à leur échéance, ou maintenir les jours reportés pour maladie au-delà de la clôture tant que l'échéance n'est pas atteinte.

**Mise à jour 29/10/2026 — validation technique JUR-027 (≠ homologation RH) :**

- **Recette technique terminée et validée en environnement de test** (build 0 · unit 448 · e2e 37/37 · L3/L4/L7 flag OFF · real-flow/corrections/matrix/concurrence flag ON · L6 18/18 ×3).
- **Trois règles métier provisoires enregistrées, en attente de confirmation RH** :
  - **D1** — lots maladie éligibles par expiration croissante, puis congés ordinaires N-1 et N (choix de gestion protecteur, non une obligation légale explicite).
  - **D2** — débit définitif conservé à la prise effective ; engagements prévisionnels à prendre en compte pour éviter les doubles affectations, sans nouvelle réservation comptable.
  - **D3** — annulation après expiration : régularisation traçable, sans recrédit automatique ni extinction définitive automatique des droits avant examen des conditions juridiques.
- **Références** : Code du travail L3141-19-1 à L3141-19-3 ; Syntec IDCC 1486, articles 5.3 et 5.5 ; Cass. soc. 13 novembre 2025, n° 24-14.084.
- **Statut** : « JUR-027 — Recette technique terminée et validée en environnement de test. Trois règles métier provisoires en attente de confirmation RH. Activation en production non autorisée. »
- **Ce statut valide la technique, PAS la conformité métier** : le test n'est pas déclaré définitivement conforme sur le plan métier.

---

### JUR-037 — Droits pendant les arrêts maladie (PRIORITÉ)

**Ce que demande le scénario** : vérifier la conformité juridique des droits acquis pendant un arrêt maladie (Code du travail L3141-5, L3141-5-1 ; Syntec 5.5 — maintien de salaire assimilé à du temps de travail effectif).

**Ce que l'application permet aujourd'hui** :
- La RH consulte les compteurs et l'historique des mouvements (`GET /leave-balances/employee/:id/history`) ; les corrections manuelles sont **tracées** (mouvement `CORRECTION_POSITIVE/NEGATIVE` + audit `RH_BALANCE_CORRECTED` — cf. JUR-026, 12/12 OK).
- L'application **ne calcule pas** automatiquement les droits pendant un arrêt (et ne doit pas : règle GMES confirmée).

**Informations que la RH doit obtenir hors logiciel** : nature de l'arrêt (maladie non professionnelle / AT / MP), maintien de salaire éventuel (paie), applicabilité Syntec, taux et plafond applicables, dispositions plus favorables.

**Distinction Code du travail / Syntec** :
- Code du travail : L3141-5 (AT/MP sans limite d'un an depuis le 24/04/2024) ; L3141-5-1 (maladie non professionnelle 2 j/mois, plafond 24 j).
- Syntec 5.5 (lorsque applicable) : arrêts maladie/accident donnant lieu à **maintien de salaire par l'employeur** assimilés à du **temps de travail effectif** (source Légifrance : KALISCTA000047504922).

**Preuves à demander aux RH pour valider** : une grille de décision RH documentant (nature de l'arrêt, maintien de salaire, taux/plafond retenu) ; éventuellement un dossier collaborateur type traité et tracé.

**Statut justifié** : **Bloqué** (validation RH externe). Une correction manuelle ne prouve pas automatiquement la conformité juridique du montant accordé.

---

### JUR-025 — Acquisition pendant un arrêt AT/MP

**Demande** : l'arrêt AT/MP est assimilé à du travail effectif sans limite d'un an.

**Ce que l'application permet** : l'acquisition mensuelle (`findEligibleEmployees` + `computePresence`) ne réduit **aucune** absence — un collaborateur actif en arrêt continue d'être crédité 2,5 j/mois en fonction de sa présence calendaire (hireDate/exitDate). **Aucune limite d'un an n'existe dans le code** → la règle est satisfaite **de fait**, mais de façon **implicite** (aucune logique AT/MP dédiée, aucune traçabilité spécifique « AT/MP »).

**Catégorie** : A (couvert implicitement) + C (confirmation RH sur l'explicitation).

**RH à confirmer** : le comportement « pas de réduction pendant l'absence » est-il suffisant, ou faut-il un type d'absence AT/MP explicite pour l'auditabilité ?

**Statut justifié** : **Bloqué** (en attente de la décision RH). Potentiellement déblocable sans développement si la RH valide le comportement actuel.

---

### JUR-019 / JUR-020 — Congés d'ancienneté Syntec

**Demande** : +1/+2/+3/+4 jours ouvrés selon l'ancienneté (5/10/15/20 ans), appréciée à l'ouverture de la période de prise (1er mai).

**Ce que l'application permet désormais** : **fonctionnalité opérationnelle** `SeniorityExtraDaysService` + endpoints RH (`GET/PUT /leave-balances/seniority-extra/config`, `GET /leave-balances/seniority-extra/preview/:period`, `POST /leave-balances/seniority-extra/apply`).
- Ancienneté **révolue** calculée à la **date de référence configurable** (1er mai par défaut) via `syntec-seniority.util.ts` (réutilisé par le service).
- Paliers **configurables** (seuils, date de référence, entités) via `SENIORITY_EXTRA_DAYS_CONFIG`.
- **Attribution automatique conditionnée à la configuration RH par entité** : aucune attribution pour une entité non listée.
- **Idempotence** (mouvement `SENIORITY_EXTRA` unique par période/compteur) et **concurrence** (verrou + upsert atomique).
- **Traçabilité** : mouvement dédié + audit `SENIORITY_EXTRA_ALLOCATED`.
- **Affichage** : les jours alimentent `acquiredDays`/`availableDays` du compteur N (visibles dans les écrans de soldes et l'historique).

**Catégorie** : B + C + D + E.

**Statut justifié** : **Conforme techniquement — homologation RH en attente** (applicabilité Syntec par entité + date de référence à confirmer).

**Preuves** : `tests/recette/scripts/retest-jur019-022-integration.mjs` (15/15 OK) ; `retest-jur019-022-consolidation.mjs` (10/10 OK) ; `_ui-extra-days.mjs` (navigateur, 8/8 OK) ; `syntec-seniority.util.spec.ts` (13 tests) ; `conformite-legale.spec.ts` CONFORMITÉ B (active).

---

### JUR-021 / JUR-022 — Fractionnement

**Demande** : +1/+2 jours selon la prise hors période (Syntec 5.1 en jours ouvrés ; supplétif L3141-23 en jours ouvrables).

**Ce que l'application permet désormais** : **fonctionnalité opérationnelle** `FractionnementService` + endpoints RH (`GET/PUT /leave-balances/fractionnement/config`, `GET /leave-balances/fractionnement/preview/:period`, `POST /leave-balances/fractionnement/apply`, `POST /leave-balances/fractionnement/recompute`).
- **Identifie les congés réellement pris** (statut `DEFINITIF`, hors congés annulés) et calcule les jours **hors période légale** (01/05 → 31/10 par défaut).
- **Distingue jours ouvrés (Syntec, lundi→vendredi) et ouvrables (légal, lundi→samedi)** ; fériés, week-ends et demi-journées pris en compte.
- **Classification fiable des demandes** (`leave_requests.leave_classification`, enum `UNDETERMINED`/`MAIN`/`FIFTH_WEEK`, défaut `UNDETERMINED`) : une demande **non classifiée n'est jamais comptée** pour un calcul automatique de fractionnement ; seule `MAIN` (congé principal confirmé) est comptée et `FIFTH_WEEK` est exclue. Reclassification RH sur demande existante (`PATCH /leave-requests/:id/classification`, réservée à la RH, audit `LEAVE_REQUEST_CLASSIFIED`).
- **Période d'origine déterministe par répartition datée** : les journées/demi-journées sont réparties aux compteurs N/N-1 dans l'unité de décompte de l'application (jours entiers/demis, N-1 consommé d'abord), puis converties au régime juridique (samedis exclus pour Syntec). Historique non reconstituable → signalé (`uncertainRequests`) et exclu, jamais de bonus incertain.
- **5e semaine exclue** (marqueur `FIFTH_WEEK` + plafond 20 ouvrés / 24 ouvrables en filet de sécurité).
- **Régime paramétrable par entité** (`FRACTIONNEMENT_CONFIG.entities[].regime`), **sans cumul** entre Syntec et supplétif.
- **Recalcul après annulation** : `recomputeForEmployee` dans la transaction d'annulation (ajustement positif/négatif tracé).
- **Idempotence** (mouvement `FRACTIONNEMENT`), **traçabilité** (audit `FRACTIONNEMENT_ALLOCATED` / `FRACTIONNEMENT_RECALCULATED`).

**Catégorie** : B + C + D + E.

**Statut justifié** : **Conforme techniquement — homologation RH en attente** (applicabilité Syntec, conditions de renonciation écrite, régime supplétif).

**Preuves** : `tests/recette/scripts/retest-jur019-022-integration.mjs` (15/15 OK) ; `retest-jur019-022-consolidation.mjs` (10/10 OK) ; `retest-jur019-022-classification.mjs` (6/6 OK) ; `_ui-extra-days.mjs` (navigateur, 8/8 OK) ; `fractionnement.util.spec.ts` (11 tests) ; `schema-compatibility.spec.ts` (3 tests).

---

### JUR-023 — Période de prise (13 mois)

**Demande** : prise à partir du 1er mai, 13 mois max, report au-delà sur demande écrite.

**Ce que l'application permet désormais** : **fonctionnalité opérationnelle** `TakePeriodService` + endpoints RH `GET /leave-balances/take-period/:period`, `GET /leave-balances/take-period/:period/reports`, `POST /leave-balances/take-period/report` + carte UI « Période de prise ».
- **Fenêtre de prise rattachée à l'ANNÉE DE FIN** (`TAKE_PERIOD_START` = 05-01, `TAKE_PERIOD_DURATION_MONTHS` = 13) : pour « AAAA-(AAAA+1) » → 01/05/(AAAA+1) → 31/05/(AAAA+2).
- **Statut aux dates limites** : non ouverte / dans la période / échéance proche (`TAKE_PERIOD_ALERT_DAYS`) / dépassée.
- **Soldes N non pris listés** (non supprimés) — reportables.
- **Parcours de report RH réellement appliqué** : enregistrement d'une demande écrite tracée (auteur, justification, **document réellement conservé** — `document_id` vers `documents`, fichier physique vérifié + statut ACCEPTE, joint ou sélectionné depuis l'interface RH — nouvelle échéance) ; la **nouvelle échéance est utilisée dans le suivi** ; échéance **contrôlée** ; **double report refusé** ; **modification avec historique** (audit `TAKE_PERIOD_REPORT_UPDATED`) ; droits conservés. **Report sans justificatif → EN ATTENTE DE PREUVE** (provisoire, jamais validé juridiquement : l'échéance légale reste appliquée tant que la preuve n'est pas validée). **Reports maladie via JUR-027**. Migration **strictement non destructive** : aucun DELETE/DROP de reports ; **refus sécurisé AVANT toute modification du schéma** si des reports maladie historiques existent.

**Catégorie** : B + C + D + E.

**Statut justifié** : **Conforme techniquement — homologation RH en attente** (dates exactes et procédure de report sur demande écrite à confirmer par la RH).

**Preuves** : `tests/recette/scripts/retest-jur023-reports.mjs` (10/10 OK) ; `retest-jur023-proof.mjs` (12/12 OK) ; `retest-jur023-prise.mjs` (5/5 OK) ; `_ui-report.mjs` (navigateur, 7/7 OK) ; `take-period.util.spec.ts` (6 tests).

---

### JUR-024 — Dispositions conventionnelles plus favorables

**Demande** : appliquer la disposition la plus favorable (Code du travail vs Syntec vs accord d'entreprise).

**Ce que l'application permet** : `legal_entities` (GMES, Efficience, GMES Ingénierie) et `users.legal_entity_id` (rattachement). **Configuration explicite de la convention par entité** (`convention_type` NON_RENSEIGNEE/LEGAL/SYNTEC/ACCORD_ENTREPRISE + `idcc` + `convention_name`), **aucune convention présumée**. **La convention DÉTERMINE les règles** : ancienneté uniquement si SYNTEC ; fractionnement régime dérivé de la convention avec **source enregistrée** (Code du travail / convention / accord) ; **configuration contradictoire → aucun calcul automatique**. Deux entreprises configurées différemment avec droits réellement calculés.

**Réexamen** : la comparaison « disposition la plus favorable » (Code du travail vs Syntec vs accord) reste une **analyse RH/juridique** ; la priorité est résolue par matière (ancienneté = conventionnelle ; fractionnement = base légale + convention) sans présumer qu'une disposition plus favorable prévaut.

**Catégorie** : B + C + E ; D (identification) **implémenté**.

**Statut justifié** : **Conforme techniquement — homologation RH en attente** (identification effective Syntec/accord/aucun par entité à confirmer par la RH).

---

### JUR-028 — Interaction arrêt maladie / congés posés

**Demande** : les jours couverts par un arrêt ne sont pas perdus et sont reportables.

**Ce que l'application permet** : détection du chevauchement arrêt maladie / congé validé + **restitution automatique idempotente** (mouvement `ARRET_RESTITUTION` tracé) + **inversion à l'annulation** de l'arrêt. Configuration RH (activée/désactivée, types d'absence « arrêt maladie »), **désactivée par défaut**. **Reconnaissance du type arrêt maladie indépendante de l'activation** : classification métier **explicite, persistante et paramétrable** (`leave_types.absence_kind` : NON_CLASSIFIE / NON_MEDICAL / ARRET_MALADIE / ENFANT_MALADE / AT_MP, défaut NON_CLASSIFIE) — **aucune correspondance de mots**. Seul un type classé ARRET_MALADIE déclenche la restitution. La déclaration d'un arrêt maladie est autorisée malgré le chevauchement (les jours ne sont pas perdus). **Sécurisation (29/10/2026)** : les jours ACQUIS restent inchangés (seule la disponibilité est restaurée) ; enregistrement/annulation et restitution/inversion **transactionnels** (aucune erreur ignorée silencieusement) ; idempotence et **concurrence** (aucun double crédit) ; **arrêts multiples** et restitution partielle plafonnés au total décompté ; **inversion refusée tant que l'arrêt est valide** ; si l'automatisation est désactivée, la déclaration reste possible et un **signalement RH** indique la régularisation manuelle nécessaire.

**Catégorie** : C + D (automatisation).

**Statut justifié** : **Conforme techniquement — homologation RH en attente** (périmètre exact L3141-19-1 et s. et liste des types d'arrêt à confirmer par la RH).

---

### JUR-029 / JUR-030 — Événements familiaux et deuil

**Demande** : autorisations d'absence selon les durées applicables (Code du travail / Syntec 5.7).

**Ce que l'application permet** : **types d'absence configurables** (catégorie `DECLARATION_ABSENCE`), **déclaration RH**, **gestion des justificatifs**, absence sans déduction de solde (si `deductsPaidLeaveBalance=false`). Aucune durée légale encodée.

**Catégorie** : A (déclaration + justificatifs) + B (durées non encodées) + C + E.

**Statut justifié** : **Bloqué** (configuration RH des types et durées à réaliser). Déblocable sans développement par simple configuration.

---

### JUR-031 — Maternité, paternité, adoption

**Demande** : congés déclaratifs, périodes assimilées (Syntec 5.5).

**Ce que l'application permet** : types requis **auto-créés** — « Congé d'adoption », « Congé parental », « Congé parental d'éducation », « Congé supplémentaire de naissance » (déclaratif, `deductsPaidLeaveBalance=false`, `rhOnly=true`). **Testé** (12/12 OK) : déclaration « Congé d'adoption » créée et soumise, aucune déduction de solde. **Pas de type « paternité » par défaut.**

**Catégorie** : A (couvert pour adoption/parental) + B (paternité à configurer) + C + E.

**Statut justifié** : **Bloqué** (ajout du type paternité + durées par configuration RH).

---

### JUR-032 — Dispositions Syntec 2026

**Demande** : identifier les dispositions en vigueur en 2026 (ex. congé supplémentaire de naissance).

**Ce que l'application permet** : « Congé supplémentaire de naissance » déjà présent en type d'absence requis. Aucune durée encodée.

**Catégorie** : A + C + E.

**Statut justifié** : **Bloqué** (confirmation juridique des textes 2026).

---

## 4. Scénarios pouvant être débloqués sans développement

Sous réserve d'une **validation/configuration RH** et, le cas échéant, de la **confirmation Syntec** :

| ID | Déblocage |
|---|---|
| **JUR-027** | Report exceptionnel RH **déjà testé (12/12 OK)**. Déblocable sur le mécanisme technique ; le délai de 15 mois reste une procédure RH à documenter. |
| **JUR-025** | Couverture implicite de l'acquisition pendant AT/MP (aucune réduction). Déblocable si la RH valide le comportement actuel. |
| **JUR-029** | Types d'absence configurables + justificatifs + déclaration RH. Déblocable par configuration des événements et durées. |
| **JUR-030** | Idem JUR-029. |
| **JUR-031** | Types déclaratifs auto-créés (adoption, parental, supplémentaire de naissance) **testés**. Déblocable par configuration (ajouter paternité). |
| **JUR-032** | Type « congé supplémentaire de naissance » déjà présent. Déblocable après confirmation des textes 2026. |

**Total : 6 scénarios déblocables sans développement.**

---

## 5. Scénarios nécessitant réellement un développement

| ID | Évolution minimale (sans code ici) | Indispensable / Facultative |
|---|---|---|
| **JUR-024** | **Implémenté (29/10/2026)** : configuration de la convention collective par entité (AUCUN par défaut, Syntec, accord d'entreprise), aucune présumée. Homologation RH seule restante. | Implémentée. |
| **JUR-028** | **Implémenté (29/10/2026)** : détection du chevauchement arrêt/congé + restitution automatique idempotente + inversion à l'annulation (configuration RH, désactivée par défaut). Homologation RH seule restante. | Implémentée. |

**Total : 2 scénarios dont l'automatisation reste facultative** (un contournement manuel tracé existe). **JUR-019/020/021/022/023 sont désormais implémentés et testés** (voir §3 et §9).

---

## 6. Décisions nécessaires de la RH

1. **Convention applicable par entité** : Syntec (IDCC 1486) pour GMES / Efficience / GMES Ingénierie ? Accords d'entreprise ? (prérequis JUR-019 → 024, 029 → 032).
2. **Droits pendant arrêt maladie (JUR-037)** : grille de décision (nature de l'arrêt, maintien de salaire, taux/plafond) — à documenter et à tracer.
3. **Report maladie (JUR-027)** : délai de 15 mois et exceptions ; qui suit l'échéance (logiciel ou RH).
4. **AT/MP (JUR-025)** : le comportement actuel « pas de réduction » est-il suffisant, ou faut-il un type AT/MP explicite ?
5. **Événements familiaux / parentalité (JUR-029 → 032)** : quels types configurer et avec quelles durées.
6. **Ancienneté / fractionnement (JUR-019 → 022)** : la fonctionnalité est implémentée et testée ; il reste à confirmer l'applicabilité Syntec par entité, les conditions de renonciation écrite et le régime supplétif applicable (configuration RH, aucun développement restant).
7. **Période de prise (JUR-023)** : confirmer les dates exactes (1er mai, 13 mois) et la procédure de report sur demande écrite — la fonctionnalité de suivi est implémentée.

---

## 7. Évolutions indispensables vs facultatives

- **JUR-019/020/021/022 implémentés (29/10/2026)** : attribution automatique idempotente de l'ancienneté et calcul automatique du fractionnement (congés réellement pris, ouvrés/ouvrables, 5e semaine exclue, recalcul après annulation), traçabilité complète, configuration par entité. Restent en attente de la seule homologation RH.
- **Facultatives** : automatisation de la période de prise, de l'interaction arrêt/congé, et du champ convention/IDCC par entité.
- **Correction appliquée et validée (26/10/2026)** : le report exceptionnel débite désormais le compteur source N-1 (crédit cible + débit source atomiques, contrôle du solde libre). Tests de non-régression 42/42 OK.

---

## 8. Ordre de priorité pour la suite

> **Mise à jour 29/10/2026** : JUR-019/020 (ancienneté Syntec), JUR-021/022 (fractionnement) et JUR-023 (période de prise) sont **conformes techniquement** (fonctionnalités opérationnelles et testées) ; il ne reste que l'homologation RH. JUR-027 est techniquement validé (homologation RH en attente). Référence principale : **cahier v2.9 (29/10/2026)**.

### A. En attente de décision RH (questions conservées, sans bloquer le travail technique)

| ID | Question RH en attente | Priorité |
|---|---|---|
| JUR-037 | Droits pendant arrêt maladie (applicabilité Syntec, maintien de salaire, taux/plafond) | P1 |
| JUR-024 | Convention collective applicable par entité | P1 |
| JUR-027 | Homologation des 3 règles provisoires D1/D2/D3 + procédure de report (délai 15 mois) | P1 |
| JUR-019 / JUR-020 | Applicabilité Syntec par entité + date de référence (1er mai) — **fonctionnalité implémentée, homologation seule restante** | P2 |
| JUR-021 / JUR-022 | Applicabilité Syntec + conditions de renonciation écrite + régime supplétif — **fonctionnalité implémentée, homologation seule restante** | P2 |
| JUR-023 | Dates exactes (1er mai, 13 mois) + procédure de report sur demande écrite — **fonctionnalité implémentée, homologation seule restante** | P2 |
| JUR-025 | La couverture implicite AT/MP (aucune réduction) est-elle suffisante ? | P2 |
| JUR-029 / 030 / 031 / 032 | Types et durées d'absence à configurer | P2 |
| JUR-023 | Le transfert GMES N→N-1 suffit-il pour la période de prise ? | P2 |

### B. Techniquement réalisables sans attendre la RH (automatisations facultatives)

| ID | Travail technique possible | Priorité |
|---|---|---|
| JUR-028 | Détection du chevauchement arrêt/congé + restitution/report automatique | P2 (facultatif) |

**Règle** : aucune de ces évolutions n'est indispensable (un contournement manuel tracé existe). Ne pas développer sans autorisation explicite ; avancer d'abord sur ce qui est vérifiable techniquement sans modification de code (recette, non-régression, préparation de preuves).

### C. Ordre de reprise retenu

1. **JUR-037** (P1) — collecter la grille de décision RH ; en parallèle vérifier/formaliser la traçabilité des corrections manuelles (déjà disponible).
2. **JUR-024** (P1) — recenser les entités et la convention applicable (procédure RH, sans développement).
3. **JUR-025** — confirmer par recette la couverture implicite AT/MP (sans code).
4. **JUR-029 / 030 / 031 / 032** — configurer les types d'absence et durées (sans code).
5. **JUR-028** — décider l'automatisation ; sinon documenter le contournement manuel.
6. **JUR-027 / JUR-019 / JUR-020 / JUR-021 / JUR-022 / JUR-023** — homologation RH (aucun développement en attente).

---

## 9. Preuves techniques générées

- `tests/recette/reports/retest-jur027-report-et-absences.json` (12/12 OK) + `.log`
  - JUR-027 : report exceptionnel RH opérationnel (motif, auteur, montant, audit, notification, distinct du transfert N→N-1).
  - JUR-031 : absence déclarative « Congé d'adoption » sans déduction de solde.
- `tests/recette/reports/retest-jur027-cycle-cloture.json` (**11/12, 1 assertion inadaptée**) + `.log`
  - Cycle complet report → clôture (consommation simulée par SQL) ; **double usage démontré** (10 consommés + 4 conservés = 14 pour 10 initiaux) ; pas de double crédit à la clôture.
- `tests/recette/reports/retest-jur027-circuit-reel.json` (**10/10 OK**) + `.log`
  - **Confirmation par le circuit métier réel** : congé direct RH de 10 jours imputé via `applyPaidLeaveForRequest` → source 0 + cible 4 = 14 (double usage confirmé sans simulation SQL de la consommation).
- `tests/recette/reports/retest-jur027-correction.json` (**24/24 OK**) + `.log`
  - **Après correction** : report 4/10 → source 6 + cible 4 ; consommation 6 autorisée ; consommation 10 → source 0 + N négatif (les 4 jours reportés indisponibles sur la source) ; reports multiples ; report > solde libre refusé ; réservations prises en compte ; concurrence ; traçabilité.
- `tests/recette/reports/retest-jur027-correction-cloture.json` (**7/7 OK**) + `.log`
  - Report puis clôture : pas de double crédit ; seconde clôture refusée (409).
- `tests/recette/reports/retest-arrondi-l3141-7.json` (**11/11 OK**) et `retest-arrondi-l3141-7-cas.json` (**18/18 OK**)
  - Non-régression L3141-7 (arrondi) et transfert GMES N→N-1 (26,5 → 27).
- `tests/recette/scripts/retest-jur019-022-integration.mjs` (**15/15 OK**) — JUR-019 → 022
  - Ancienneté : configuration par entité, aperçu/attribution (+1/+2/+4), idempotence, concurrence (une seule écriture), mouvement SENIORITY_EXTRA + audit.
  - Fractionnement : configuration des régimes, calcul sur congés réellement pris (3 j ouvrés → +1 ; 5 j → +2), 5e semaine exclue, idempotence, **recalcul après annulation** (ajustement -1 tracé).
- `tests/recette/scripts/retest-jur019-022-consolidation.mjs` (**10/10 OK**) — consolidation
  - Cohérence des unités (acquisition → affichage → déduction 1:1 → solde → historique), 5e semaine identifiée par marqueur explicite, annulation après consommation (solde cohérent, conso préservée), congé futur non compté, **deux recalculs simultanés → une seule écriture**, recalcul après changement de seuils.
- `tests/recette/scripts/_ui-extra-days.mjs` (**8/8 OK, navigateur**) — écran RH « Droits supplémentaires » : configuration par entité, prévisualisation, attribution, recalcul, erreurs API, permissions, responsive 390×844.
- `tests/recette/scripts/retest-jur019-022-classification.mjs` (**6/6 OK**) — classification fiable
  - UNDETERMINED (non classifiée) → 0 bonus ; MAIN → +2 ; FIFTH_WEEK → 0 ; reclassification RH tracée (audit) ; non-RH → 403 ; congé partiellement financé par N-1 → seule la part N est comptée (→ 0, pas +2).
- `tests/recette/scripts/retest-jur023-prise.mjs` (**5/5 OK**) — JUR-023 période de prise
  - Fenêtre rattachée à l'année de fin : 2026-2027 → 01/05/2027 → 31/05/2028 ; statut aux dates limites ; soldes N non pris listés et non supprimés.
- `tests/recette/scripts/retest-jur023-reports.mjs` (**11/11 OK**) — JUR-023 reports + corrections
  - Rattachement 2025-2026 → 01/05/2026 → 31/05/2027 ; échéance dépassée 2024-2025 ; report ordinaire tracé (audit) ; double report refusé (409) ; report maladie distinct ; demande mixte N-1/N exclue et signalée ; reclassification MAIN→FIFTH_WEEK remet le bonus à zéro (ajustement -2 tracé).
- `tests/recette/scripts/retest-jur028-chevauchement.mjs` (**13/13 OK**) + `_ui-jur028.mjs` (navigateur, **4/4 OK**) — JUR-028
  - Désactivé par défaut → chevauchement arrêt/congé refusé (409) ; activé → déclaration autorisée et jours chevauchés restitués (mouvement `ARRET_RESTITUTION`), idempotence (aucun double crédit), inversion à l'annulation (trace marquée), type non maladie ignoré.
- `tests/recette/scripts/retest-jur029-030-evenements.mjs` (**7/7 OK**) + `family-event-rules.util.spec.ts` (**8 tests**) — JUR-029/030
  - Durées légales versionnées : mariage Syntec 5 j ouvrés / légal 4 j ouvrables ; naissance 3 j ; deuil enfant 8 j ouvrables distincts ; annonce handicap < 14/06/2026 = 5 j ouvrés (Syntec), ≥ 14/06/2026 = 10 j ouvrables (légal) ; absence non débitée des congés payés.
- `tests/recette/scripts/retest-jur028-securisation.mjs` (**9/9 OK**) — sécurisation JUR-028
  - 25 acquis / 6 déduits / 5 restitués → **25 acquis inchangés, 24 disponibles, net consommé 1** ; inversion refusée sur arrêt valide ; annulation → inversion ; restitution partielle ; arrêts multiples plafonnés ; concurrence (une seule écriture) ; désactivé → déclaration possible + **signalement RH**.
- `tests/recette/scripts/retest-jur028-classification.mjs` (**5/5 OK**) — classification métier des absences
  - `absence_kind` explicite (persistant) : ARRET_MALADIE → restitution ; ENFANT_MALADE / AT_MP / NON_MEDICAL / NON_CLASSIFIE → jamais de crédit automatique (pas de correspondance de mots).
- `tests/recette/scripts/retest-jur024-convention.mjs` (**8/8 OK**) + `retest-jur024-droits.mjs` (**5/5 OK**) + `_ui-jur024.mjs` (navigateur, **3/3 OK**) — JUR-024
  - NON_RENSEIGNEE par défaut ; LEGAL confirmé distinct ; Syntec IDCC 1486 ; accord d'entreprise ; audit tracé. La convention détermine les règles : ancienneté (GMES=Syntec +2, EFFICIENCE=légal 0) ; fractionnement régime dérivé + source ; configuration contradictoire → aucun calcul auto.
- `backend/src/leave-balances/fractionnement.util.spec.ts` (**11 tests**) et `syntec-seniority.util.spec.ts` (**13 tests**) — moteurs purs (ouurés/ouvrables, bornes 31/10 et 01/11, demi-journées, 5e semaine). `take-period.util.spec.ts` (**5 tests**) et `schema-compatibility.spec.ts` (**3 tests**).
- **Garde-fou migrations** : `migrationsRun` n'est actif que sur `gestion_conges_gmes_test` ou avec `MIGRATIONS_AUTHORIZED=true` (aucune migration automatique sur la base réelle sans autorisation).

Ces preuves techniques **ne constituent pas une validation juridique complète**.

---

## 10. Note d'intégrité

- **Modifications applicatives JUR-019 → 023 (29/10/2026)** : ajout de `SeniorityExtraDaysService`, `FractionnementService`, `TakePeriodService`, `fractionnement.util.ts`, `take-period.util.ts`, types de mouvement `SENIORITY_EXTRA`/`FRACTIONNEMENT` (migration `AddExtraDaysMovementTypes20261029100000`), classification tri-état `leave_classification` sur `leave_requests` (migration `AddLeaveClassification20261029130000`), endpoints RH et écran RH « Droits supplémentaires ». Ces modifications ne touchent **jamais** la base réelle `gestion_conges_gmes` : migrations et tests exécutés exclusivement sur `gestion_conges_gmes_test` (API 3001).
- **Garde-fou migrations + schéma** : `migrationsRun` actif uniquement sur `gestion_conges_gmes_test` ou avec `MIGRATIONS_AUTHORIZED=true` ; au démarrage, `assertDatabaseSchemaCompatible` (main.ts) **échoue rapidement** si le schéma est incompatible (ex. `leave_classification` absente) avec une consigne explicite — empêche de démarrer un code récent sur un schéma non migré.
- **Procédure de déploiement (non exécutée ici, base réelle jamais touchée)** : 1) arrêter l'application ; 2) sauvegarder la base ; 3) démarrer une fois avec `MIGRATIONS_AUTHORIZED=true` pour appliquer les migrations idempotentes ; 4) vérifier le schéma (démarrage sans erreur = compatible) ; 5) déployer le nouveau code ; 6) activer les fonctionnalités via la configuration RH (elles restent désactivées par défaut).
- Tests exécutés exclusivement sur `gestion_conges_gmes_test` (API 3001), processus de recette démarré puis arrêté.
- Serveurs personnels 3000/5173 non interrompus.
- Aucun commit ni push.
- Le cahier Word **v2.12 (29/10/2026)** — mis à jour **in place** (aucune nouvelle version) : migration strictement non destructive de take_period_reports (aucun DELETE/DROP ; refus sécurisé si reports maladie historiques avant toute modification), preuve de report par document réellement conservé (fichier physique vérifié + statut ACCEPTE, joint/sélectionné depuis l'interface RH), report sans justificatif en attente de preuve, blocage des attributions automatiques en cas d'incertitude. Totaux : 443 conformes, 7 conformes techniquement, 7 bloqués, 457 scénarios.

---

## 11. Confrontation des scénarios restants bloqués aux critères exacts (29/10/2026)

**A. Fonctionnalité complète testée — seule une décision RH/homologation reste en attente**
- **JUR-027** : report maladie/AT-MP implémenté et testé (report exceptionnel tracé, débit source N-1 + crédit cible atomique, consommation, clôture). Le **délai de 15 mois** et les exceptions restent une procédure RH à homologuer (non encodés dans le logiciel).

**B. Fonctionnalité partielle — correction technique identifiée (données RH requises, non codées en dur)**
- **JUR-031** (maternité/paternité/adoption) : déclaratif opérationnel (adoption/parental/supplémentaire naissance auto-créés, testés), mais **type paternité absent** et **assimilation Syntec 5.5 des périodes (acquisition) non implémentée** (nécessite l'applicabilité Syntec par entité + RH).
- **JUR-025** (AT/MP sans limite) : couverture **implicite** (aucune réduction d'acquisition pendant une absence), mais pas de traçabilité AT/MP dédiée ; décision RH (l'implicite suffit-il ?) + éventuelle traçabilité explicite via `absence_kind = AT_MP`.

**D. Légalement corrigé (29/10/2026) — intégration aux demandes EN COURS (non « conforme techniquement »)**
- **JUR-029 / JUR-030** : durées légales corrigées et testées (mariage Syntec 4 j ouvrés ; annonce handicap 5 j ouvrables avant / 10 j après le 14/06/2026 ; décès enfant 12/14 j ; deuil 8 j distinct ; enfant malade 3/5 j non rémunéré), unités réelles conservées (pas de conversion proportionnelle), sécurité de consultation. Reste : contrôle backend à la soumission/validation, affichage dans les formulaires RH/collaborateur, comparaison jours demandés vs droits.

**C. Véritable décision juridique/RH — impossible à remplacer par du code**
- **JUR-032** : identification de la version Syntec en vigueur (Légifrance) — recherche juridique, pas de code.
- **JUR-037** : droits pendant arrêt maladie (L3141-5-1 2 j/mois plafond 24 j ; Syntec 5.5 maintien de salaire) — dépend de la paie (maintien de salaire) et d'une grille de décision RH ; le logiciel fournit la traçabilité, pas le calcul.
