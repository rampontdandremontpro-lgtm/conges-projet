# Rapport de décisions RH — Conformité juridique G Congés & Absences

**Date** : 26/10/2026
**Périmètre** : module 20 du cahier de recette v2.0 → v2.3 — scénarios JUR-019 à JUR-037 (14 scénarios bloqués ; JUR-026 conforme sur le mécanisme technique, JUR-037 bloqué en attente de validation RH)
**Objet** : analyse des fonctionnalités juridiques absentes, partielles ou déjà couvertes, et questions à arbitrer avec la RH / la paie.

## Synthèse

- **JUR-026 conforme (mécanisme technique uniquement)** : acquisition automatique de 2,5 j/mois + correction manuelle RH (positive ou négative) historisée (motif/auteur/montant) — validée par 12 contrôles. Aucun calcul automatique de réduction n'est en place ni requis.
- **JUR-037 bloqué (conformité juridique des droits pendant arrêt maladie)** : dépend de l'examen individuel de la RH et de l'applicabilité Syntec (5.5 — maintien de salaire) — en attente de validation RH.
- **Points de vigilance de conformité restants** (à arbitrer prioritairement) :
  1. **JUR-027** — report des congés non pris pour maladie / AT-MP (L3141-19-1 et s., report 15 mois) : l'application ne prévoit pas de report automatique lié à la maladie (seul un report exceptionnel manuel RH existe).
- L'applicabilité de la convention Syntec (IDCC 1486) **n'est pas présumée** pour GMES, Efficience et GMES Ingénierie : à confirmer pour chaque entité.

---

## Fiches par scénario

### JUR-019 — Congés d'ancienneté Syntec 5.1 (+1/+2/+3/+4 jours ouvrés)
- **Obligation / disposition** : Syntec 5.1 (IDCC 1486) — ancienneté 5/10/15/20 ans → +1/+2/+3/+4 jours ouvrés (disposition conventionnelle, conditionnée à l'applicabilité Syntec).
- **Existant** : `users.hire_date` (et `exit_date`) présents ; ancienneté affichée à titre informatif (frontend `seniorityLabel`) ; aucune génération de jours d'ancienneté.
- **Manque** : calcul de l'ancienneté à la date de référence + attribution des jours supplémentaires (mouvement de solde ou type de congé dédié).
- **Paie** : probablement déjà traité par la paie si Syntec s'applique — à confirmer.
- **À confirmer RH** : Syntec applicable ? Faut-il que le logiciel calcule ces jours ou seulement les refléter ? Date d'appréciation (ouverture de la période de prise, 1er mai à défaut) ?
- **Proposition** : si requis, ajouter un paramètre d'ancienneté par entité et une génération de droits au 1er mai. **Priorité P2**, impact moyen.

### JUR-020 — Ancienneté appréciée à l'ouverture de la période de prise (1er mai)
- **Obligation / disposition** : Syntec 5.1 — appréciation à l'ouverture de la période de prise.
- **Existant** : aucun mécanisme de date d'appréciation.
- **Manque** : même fonctionnalité que JUR-019 (date d'appréciation + attribution).
- **À confirmer RH** : date d'appréciation retenue (1er mai ou autre stipulation).
- **Proposition** : couplée à JUR-019. **Priorité P2**.

### JUR-021 — Fractionnement Syntec 5.1 (jours ouvrés)
- **Obligation / disposition** : Syntec 5.1 — 3-4 jours ouvrés hors période → +1 jour ouvré ; ≥ 5 jours → +2 jours ouvrés ; 5e semaine exclue.
- **Existant** : aucun calcul de fractionnement.
- **Manque** : détection de la prise hors période (01/05 → 31/10) et attribution des jours de fractionnement.
- **À confirmer RH** : Syntec applicable ? Faut-il automatiser le fractionnement ?
- **Proposition** : si requis, calcul au moment de la prise du congé principal. **Priorité P2**.

### JUR-022 — Fractionnement supplétif L3141-23 (jours ouvrables)
- **Obligation / disposition** : L3141-23 (régime supplétif si aucune disposition conventionnelle plus favorable).
- **Existant** : aucun calcul.
- **Manque** : même mécanique que JUR-021 mais en jours ouvrables (3-5 j → +1 ; ≥ 6 j → +2 ; au-delà de 24 jours exclus).
- **À confirmer RH** : quel régime s'applique (Syntec vs supplétif vs accord d'entreprise) ?
- **Proposition** : à traiter avec JUR-021 selon le régime retenu. **Priorité P2**.

### JUR-023 — Période de prise Syntec 5.3 (13 mois maximum, départ 1er mai)
- **Obligation / disposition** : Syntec 5.3 — prise à partir du 1er mai ; période de prise de 13 mois maximum ; report au-delà sur demande écrite de l'employeur.
- **Existant** : période d'**acquisition** 01/06 → 31/05 (`REFERENCE_PERIOD_START`) et clôture/transfert GMES. Pas de notion distincte de « période de prise » de 13 mois.
- **Manque** : modélisation de la période de prise (borne de prise, alerte au-delà de 13 mois, report sur demande écrite).
- **À confirmer RH** : le transfert GMES N→N-1 suffit-il, ou faut-il une période de prise distincte ?
- **Proposition** : clarifier la règle de prise ; ne pas supprimer des droits encore légalement reportables. **Priorité P2**.

### JUR-024 — Dispositions conventionnelles plus favorables
- **Obligation / disposition** : comparaison Code du travail vs Syntec vs accord d'entreprise ; application de la disposition la plus favorable.
- **Existant** : entités juridiques (`legal_entities` : GMES, Efficience, GMES Ingénierie) et rattachement des collaborateurs (`users.legal_entity_id`). **Aucune configuration de convention collective (IDCC) par entité.**
- **Manque** : référence conventionnelle par entité + moteur de comparaison.
- **À confirmer RH** : convention applicable par entité ? Existence d'accords d'entreprise ?
- **Proposition** : ajouter un champ convention/IDCC par entité avant tout calcul. **Priorité P2**, prérequis des autres scénarios Syntec.

### JUR-025 — Acquisition pendant un arrêt AT/MP sans limite de durée (L3141-5, loi 2024-364)
- **Obligation** : L3141-5 (modifiée, en vigueur le 24/04/2024) — l'arrêt AT/MP est assimilé à du travail effectif **sans limite d'un an**.
- **Existant** : l'acquisition mensuelle (`findEligibleEmployees` + `computePresence`) ne réduit **aucune** absence : un collaborateur actif en arrêt continue d'être crédité en fonction de sa présence calendaire (2,5 jours/mois). **La limite d'un an n'existe pas** → la règle est satisfaite de fait, mais de façon **implicite** (aucune logique AT/MP dédiée, aucune traçabilité spécifique).
- **Manque** : modélisation explicite AT/MP (type d'absence, assimilation, traçabilité) si l'auditabilité est exigée.
- **À confirmer RH** : le comportement actuel « pas de réduction pendant l'absence » est-il suffisant, ou faut-il un traitement AT/MP explicite ?
- **Proposition** : si suffisant, documenter la règle ; sinon, développement léger. **Priorité P1** (obligation légale).

### JUR-026 — Mécanisme de correction manuelle RH des compteurs (conformité TECHNIQUE)
- **Nature** : scénario **technique** (pas une validation juridique générale des arrêts maladie).
- **Existant (processus réel GMES, validé)** :
  - L'acquisition mensuelle **automatique** crédite 2,5 jours ouvrables/mois.
  - La RH examine individuellement la situation et applique, si nécessaire, une correction manuelle **positive ou négative** (`POST /leave-balances/:id/correction`, motif obligatoire).
  - La correction ajuste `acquiredDays` et `availableDays`, et est **historisée** : mouvement `CORRECTION_NEGATIVE`/`CORRECTION_POSITIVE` (montant, motif, auteur, balance avant/après) + audit `RH_BALANCE_CORRECTED`.
- **Preuve** : retest JUR-026 exécuté le 26/10/2026 sur la base de recette (12/12 OK) — crédit automatique 2,5 j → correction RH -0,5 → 2,0 j (l'exemple -0,5 j est une démonstration technique, pas une règle générale).
- **Conclusion** : **conformité technique validée** ; aucune formule de correction automatique n'existe ni ne doit être ajoutée. La conformité juridique des droits est traitée par **JUR-037**.
- **Priorité** : P1 (mécanisme opérationnel).

### JUR-037 — Conformité juridique des droits acquis pendant un arrêt maladie (BLOQUÉ — validation RH requise)
- **Obligation / disposition** : Code du travail (L3141-5 AT/MP sans limite ; L3141-5-1 maladie non professionnelle 2 j/mois, plafond 24 j) + **Syntec 5.5** : les arrêts maladie ou accident donnant lieu à un **maintien de salaire par l'employeur selon la convention** sont assimilés à du **temps de travail effectif** pour le calcul des congés payés (source Légifrance : KALISCTA000047504922).
- **Existant** : l'application ne calcule **pas** automatiquement les droits pendant un arrêt maladie ; la RH ajuste manuellement (cf. JUR-026).
- **Manque / à valider** : la détermination des droits dépend de l'**examen individuel de la RH** (nature de l'arrêt, maintien de salaire, taux, plafond, dispositions plus favorables) et de l'**applicabilité Syntec** à chaque entité.
- **À confirmer RH/paie** : applicabilité Syntec (GMES / Efficience / GMES Ingénierie) ; maintien de salaire ; taux et plafond retenus.
- **Priorité** : P1 (obligation légale), **traitée par processus RH — contrôle non exécuté (Bloqué)**.

### JUR-027 — Report des congés non pris pour maladie / AT-MP (L3141-19-1 et s., 15 mois)
- **Obligation** : L3141-19-1 et s. — report des congés non pris en raison d'un arrêt maladie / AT-MP ; report de 15 mois (Service-Public F37482).
- **Existant** : report exceptionnel **manuel** RH (`POST /leave-balances/period/carryover`) ; pas de report automatique lié à la maladie, pas de délai de 15 mois.
- **Manque** : détection « congés non pris pour maladie » + report automatique avec échéance.
- **À confirmer RH** : le report exceptionnel manuel suffit-il, ou faut-il automatiser le report maladie ?
- **Proposition** : si requis, évolution du module de report. **Priorité P1** (obligation légale).

### JUR-028 — Interaction arrêt maladie avec congés déjà posés
- **Obligation / disposition** : L3141-19-1 et s. — les jours de congé couverts par un arrêt maladie ne sont pas perdus et sont reportables.
- **Existant** : aucune logique de chevauchement « congé posé / arrêt maladie » (pas d'annulation ni de restitution automatique).
- **Manque** : détection du chevauchement et restitution/report des jours couverts.
- **À confirmer RH** : comportement attendu (annulation automatique, restitution, report) ? Qui le gère (paie vs logiciel) ?
- **Proposition** : à définir avec la RH. **Priorité P2**.

### JUR-029 — Congés pour événements familiaux (mariage/Pacs, naissance, adoption, décès, maladie d'un enfant — Syntec 5.7 + Code du travail)
- **Obligation / disposition** : Code du travail + Syntec 5.7 (durées à vérifier sur Légifrance).
- **Existant** : le logiciel permet de déclarer des absences de **types configurables** (catégorie `DECLARATION_ABSENCE`), sans durée imposée. Aucune durée légale/conventionnelle encodée.
- **Manque** : types d'événements avec durées légales et contrôles (justificatifs, plafonds).
- **À confirmer RH** : quels événements et durées configurer ? Syntec applicable ?
- **Proposition** : configuration de types d'absence dédiés (sans développement lourd). **Priorité P2**.

### JUR-030 — Congé de deuil et annonce d'un handicap / pathologie grave d'un enfant
- **Obligation / disposition** : Code du travail (congé de deuil, annonce d'une pathologie grave) + Syntec 5.7.
- **Existant** : déclaratif uniquement (types configurables), pas de durées.
- **Manque** : mêmes éléments que JUR-029.
- **À confirmer RH** : durées applicables.
- **Proposition** : configuration dédiée. **Priorité P2**.

### JUR-031 — Congés maternité, paternité et accueil de l'enfant, adoption
- **Obligation / disposition** : Code du travail ; périodes assimilées à du travail effectif (Syntec 5.5).
- **Existant** : types d'absence requis auto-créés : « Congé d'adoption », « Congé parental », « Congé parental d'éducation », « Congé supplémentaire de naissance » (déclaratif, sans déduction de solde). **Pas de type « paternité » par défaut.**
- **Manque** : type paternité + durées et éventuels contrôles ; rattachement à la paie.
- **À confirmer RH** : les types déclaratifs suffisent-ils ? Ajouter la paternité ?
- **Proposition** : configuration de types (sans développement lourd). **Priorité P2**.

### JUR-032 — Évolutions conventionnelles Syntec en vigueur en 2026 (ex. congé supplémentaire de naissance)
- **Obligation / disposition** : version en vigueur de Syntec (à confirmer sur Légifrance).
- **Existant** : « Congé supplémentaire de naissance » déjà présent en type d'absence requis (déclaratif). Aucune durée encodée.
- **Manque** : durées et conditions 2026.
- **À confirmer RH** : version Syntec en vigueur et durées.
- **Proposition** : configuration après confirmation des textes. **Priorité P2**.

---

## Questions prioritaires à transmettre à la RH / paie

1. **Syntec (IDCC 1486) s'applique-t-elle** à GMES, à Efficience et à GMES Ingénierie ? Existe-t-il des **accords d'entreprise** ? (prérequis de JUR-019 à 024 et 029 à 032).
2. **Valider les droits pendant arrêt maladie** (JUR-037) : applicabilité Syntec 5.5, maintien de salaire, taux/plafond maladie non professionnelle (2 j/mois, 24 j), dispositions plus favorables ? (le mécanisme technique de correction RH est, lui, conforme — JUR-026.)
3. **Le report des congés non pris pour maladie** (15 mois) doit-il être automatisé dans le logiciel, ou le report exceptionnel manuel RH suffit-il ? (JUR-027, JUR-028).
4. **Faut-il modéliser explicitement l'ancienneté et le fractionnement** dans le logiciel, ou ces droits sont-ils gérés hors logiciel (paie) ? (JUR-019 à 023).
5. **Quels événements familiaux / congés de parentalité** doivent être configurés, avec quelles durées ? (JUR-029 à 032).

## Note sur les textes officiels

L'accès direct à **Légifrance a échoué** (HTTP 403) dans l'environnement de cette campagne. Les références citées proviennent de l'analyse documentée dans `backend/src/leave-balances/conformite-legale.spec.ts` et doivent être confirmées sur Légifrance / Service-Public, **à l'exception de Syntec 5.5** (arrêts maladie/accident avec maintien de salaire assimilés à du temps de travail effectif), dont la source Légifrance a été fournie : https://www.legifrance.gouv.fr/conv_coll/id/KALISCTA000047504922/.
