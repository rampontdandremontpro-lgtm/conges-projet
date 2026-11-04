# Dossier d'homologation RH — JUR-025 / JUR-027 / JUR-032 / JUR-037

> Document de synthèse destiné à la RH. Il distingue ce qui est **techniquement
> implémenté et testé**, ce qui relève des **textes**, les **choix de paramétrage**
> à confirmer, les **questions juridiques ouvertes** et la **décision exacte
> attendue** pour autoriser l'homologation.
>
> Aucune règle n'est présentée comme homologuée tant qu'elle n'a pas été validée
> par la RH. Les statuts du cahier v2.12 (457 scénarios) restent : 443 conformes,
> 10 techniquement conformes, 2 partiels (JUR-025, JUR-037), 2 bloqués
> (JUR-027, JUR-032), 0 non conforme.

---

## 1. JUR-025 — Acquisition pendant les AT/MP et traitement historique

### 1.1 Techniquement implémenté et testé
- L'AT/MP est **assimilé au travail effectif** : **2,5 jours ouvrables/mois**,
  **sans limite d'un an depuis le 24/04/2024** (loi 2024-364).
- **Avant le 24/04/2024** : l'assimilation est limitée à **une durée
  ininterrompue d'un an appréciée par DATE ANNIVERSAIRE** (et non par « 365 jours »),
  années bissextiles et 29 février inclus ; les déclarations consécutives sont
  fusionnées, une interruption réelle réinitialise le compteur.
- Au-delà d'un an (période historique), les journées sont **provisoires**
  (`HISTORICAL_PENDING`) : **jamais définitivement privées de droits**
  (Cass. soc. 13/09/2023 n° 22-17.638). La protection contre les corrections
  négatives est **limitée à la part historiquement indéterminée** ; les
  corrections certaines restent appliquées.
- Chevauchements contradictoires suivis en anomalies persistantes, décision RH
  **scopée au conflit précis**, classification retenue strictement validée.
- Décisions antérieures à la structuration : `LEGACY_PENDING` **conserve les
  droits déjà crédités sans en créer de nouveaux**.
- Unicité SQL stricte des anomalies (index sur colonnes générées).
- **Tests** : `retest-jur025-037.mjs` **69/69 OK** ; `_retest-anomaly-uniqueness.mjs`
  **4/4 OK** ; unitaires **547 passés / 32 ignorés**.

### 1.2 Règles déjà établies par les textes
- Code du travail : **L3141-5** (assimilation AT/MP au travail effectif) et
  **L3141-5-1** (maladie non professionnelle : 2 jours ouvrables/mois).
- **Art. 37 II de la loi 2024-364** : traitement transitoire (application encadrée
  depuis le 01/12/2009, plafond de 24 jours, prescription de 2 ans expirée le
  24/04/2026).
- **Cass. soc. 13/09/2023 n° 22-17.638** : la limite d'un an s'apprécie par date
  anniversaire ; les droits au-delà ne sont pas définitivement perdus.

### 1.3 Choix de paramétrage à confirmer par la RH
- Le **plafond de 24 jours** et les **conditions du transitoire** (art. 37 II) :
  le moteur les applique-t-il tels quels, ou faut-il un paramétrage par entité ?
- Le régime **Syntec 5.5** (maintien de salaire) s'applique-t-il à toutes les
  entités ou seulement à certaines ?

### 1.4 Questions juridiques réellement ouvertes
- Le périmètre exact du traitement transitoire de l'art. 37 II (quels salariés,
  quelles périodes, quel plafond) reste à valider juridiquement.

### 1.5 Décision exacte attendue
> Confirmer par écrit : « Les règles d'acquisition pendant AT/MP (2,5 j/mois,
> sans limite depuis le 24/04/2024 ; avant cette date, limite d'un an par date
> anniversaire, jours au-delà provisoires et jamais définitivement perdus) sont
> homologuées. » Et, le cas échéant : « Le plafond transitoire de 24 jours de
> l'art. 37 II de la loi 2024-364 est confirmé tel qu'implémenté. »

---

## 2. JUR-037 — Maladie non professionnelle, maintien de salaire et plafond

### 2.1 Techniquement implémenté et testé
- Maladie non professionnelle : **2 jours ouvrables/mois** (L3141-5-1),
  **plafond de 24 jours** strictement isolé par salarié et par période de
  référence, déterministe.
- **Maintien de salaire individuel** (Syntec 5.5) sur **fondement structuré et
  vérifiable** : nature (Syntec/accord/clause contractuelle/autre), période de
  validité datée, **justificatif réellement téléversé puis validé par la RH
  (justification)** ; statuts `PROPOSED` / `VALIDATED` / `LEGACY_PENDING`.
- Périmètre RH par entité (hors périmètre → 403) ; un document d'un autre
  salarié ou invalidé est refusé/réévalué ; accord d'entreprise adossé à un
  justificatif d'accord vérifié (un simple PATCH de dates ne vaut pas preuve).
- Arrondi unique sur le total (L3141-7).
- **Tests** : `retest-jur025-037.mjs` **69/69 OK** ; `_ui-basis-document-flow.mjs`
  **5/5 OK** (parcours navigateur : téléversement EN ATTENTE → validation RH →
  décision → compteur 2,5) ; `_ui-jur025-037.mjs` **11/11 OK**.

### 2.2 Règles déjà établies par les textes
- Code du travail : **L3141-5-1** (2 jours ouvrables/mois, plafond 24 jours).
- **Syntec IDCC 1486, art. 5.5** (maintien de salaire conventionnel assimilé au
  travail effectif).

### 2.3 Choix de paramétrage à confirmer par la RH
- La **grille de décision** du maintien de salaire : nature de l'arrêt, maintien
  (oui/non), taux et plafond applicables.
- Les **entités** auxquelles le Syntec 5.5 s'applique.

### 2.4 Questions juridiques réellement ouvertes
- La grille de décision RH n'est pas encore formalisée (les décisions
  individuelles sont techniquement possibles, mais la règle générale reste à
  documenter et tracer).

### 2.5 Décision exacte attendue
> Fournir la grille de décision RH (nature de l'arrêt → maintien de salaire →
> taux/plafond) et confirmer son applicabilité par entité, afin d'homologuer le
> traitement de la maladie non professionnelle et du maintien de salaire.

---

## 3. JUR-027 — Report des congés après maladie

### 3.1 Techniquement implémenté et testé
- **Report exceptionnel RH** opérationnel : nombre de jours exact, motif
  obligatoire, auteur, audit, notification salarié, **distinct du transfert
  N→N-1**, débit de la source et crédit de la cible dans la même transaction,
  contrôle du solde libre (`availableDays − reservedDays`), refus du double
  report et des dépassements.
- **3 règles provisoires en attente de confirmation RH** :
  - **D1** — lots maladie éligibles par expiration croissante, puis congés
    ordinaires N-1 et N (choix de gestion protecteur, non une obligation légale
    explicite).
  - **D2** — débit définitif conservé à la prise effective ; engagements
    prévisionnels pris en compte pour éviter les doubles affectations, sans
    nouvelle réservation comptable.
  - **D3** — annulation après expiration : régularisation traçable, sans
    recrédit automatique ni extinction définitive automatique avant examen des
    conditions juridiques.
- **Tests** : recette technique terminée et validée (12/12, 24/24, 7/7 selon les
  campagnes ; circuit réel API confirmé).

### 3.2 Règles déjà établies par les textes
- Code du travail : **L3141-19-1 à L3141-19-3**.
- Syntec IDCC 1486, **art. 5.3 et 5.5**.
- **Cass. soc. 13/11/2025, n° 24-14.084**.
- Référence de délai : **15 mois** (Service-Public F37482).

### 3.3 Choix de paramétrage à confirmer par la RH
- Le **délai de report applicable** (15 mois) et ses **exceptions** (arrêts
  longs).
- **Qui suit l'échéance** : le logiciel (champ « date limite » à tracer) ou la
  RH (suivi manuel).

### 3.4 Questions juridiques réellement ouvertes
- Le délai légal de 15 mois n'est **ni contrôlé ni tracé** par le logiciel ; les
  jours reportés sont rattachés au N-1 de la période suivante et pourraient
  expirer à la clôture GMES (~31/05) **avant** l'échéance légale de 15 mois.
- La notification salarié ne mentionne aucune date limite.

### 3.5 Décision exacte attendue
> Confirmer : (a) le délai de report applicable (15 mois) et ses exceptions ;
> (b) les 3 règles provisoires D1/D2/D3 ; (c) qui suit l'échéance (logiciel ou
> RH). L'activation en production reste non autorisée tant que ces points ne sont
> pas tranchés.

---

## 4. JUR-032 — Application des dispositions Syntec 2026

### 4.1 Techniquement implémenté et testé
- Règles Syntec **versionnées** (2023-2026 / 2026+) implémentées.
- Type requis « **Congé supplémentaire de naissance** » déjà présent (créé par
  l'application au démarrage).

### 4.2 Règles déjà établies par les textes
- Convention collective Syntec (IDCC 1486) — les dispositions en vigueur en 2026
  restent à identifier précisément (Légifrance).

### 4.3 Choix de paramétrage à confirmer par la RH
- Les **durées et conditions** des nouveaux droits Syntec 2026 (ex. congé
  supplémentaire de naissance) à encoder le cas échéant.

### 4.4 Questions juridiques réellement ouvertes
- **Confirmation juridique des textes Syntec 2026** : quelles dispositions
  entrent en vigueur, à quelle date, pour quelles entités.

### 4.5 Décision exacte attendue
> Fournir la référence Légifrance des dispositions Syntec 2026 applicables
> (identifiant KALIARTI et date d'effet), puis confirmer les durées/conditions à
> configurer. Sans cette confirmation, le scénario reste bloqué.

---

## Synthèse des décisions attendues

| Scénario | Décision RH attendue |
|---|---|
| **JUR-025** | Homologuer la règle AT/MP (2,5 j/mois sans limite depuis le 24/04/2024 ; limite d'un an par date anniversaire avant) et confirmer le plafond transitoire 24 j (art. 37 II loi 2024-364). |
| **JUR-037** | Fournir la grille de décision (nature arrêt → maintien → taux/plafond) et son applicabilité par entité. |
| **JUR-027** | Confirmer le délai de 15 mois + exceptions, les règles provisoires D1/D2/D3, et qui suit l'échéance. |
| **JUR-032** | Fournir la référence Légifrance des textes Syntec 2026 et les durées/conditions à configurer. |

---

*Ce document est une synthèse d'aide à la décision : aucune de ces règles n'est
réputée homologuée tant que la RH n'a pas rendu les décisions ci-dessus.*
