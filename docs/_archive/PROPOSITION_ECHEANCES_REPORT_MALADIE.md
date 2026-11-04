# Proposition technique — échéances des congés reportés pour maladie (sans implémentation)

**Date** : 26/10/2026
**Contexte** : correction JUR-027 (report exceptionnel) réalisée ; cette proposition traite, séparément, le maintien des jours reportés jusqu'à leur échéance légale.
**Références** : L3141-19-1, L3141-19-2, L3141-19-3 du Code du travail (à confirmer sur Légifrance).

## 1. Problème

- Les jours reportés pour arrêt maladie / AT-MP sont crédités sur le compteur **N-1 de la période suivante**.
- Ce compteur est **remis à zéro à la clôture GMES suivante (~31/05)**, qui peut être **antérieure** à l'échéance légale de report (15 mois, et ses exceptions pour arrêts longs).
- Plusieurs reports (plusieurs épisodes d'arrêt) peuvent avoir **des dates d'échéance différentes**.
- Une **date d'échéance unique sur le compteur entier est insuffisante** : elle ne permet pas de distinguer plusieurs « lots » de jours reportés avec des échéances différentes, ni de séparer les jours reportés des jours issus du transfert ordinaire N→N-1.

## 2. Contrainte

Ne pas développer une gestion complète des arrêts maladie. Chercher le **changement minimal** permettant de :
1. connaître les jours reportés et leur **origine / période de rattachement** ;
2. leur associer une **échéance** individuelle ;
3. les **exclure de la remise à zéro** tant que leur échéance n'est pas atteinte ;
4. informer le salarié du **nombre** et de la **date limite** de prise, avec **preuve datée**.

## 3. Proposition minimale (par lots)

### 3.1. Modèle de données (évolution légère)
Créer une notion de **lot de report** (table `carryover_lots`, par exemple) :
- `id`, `employee_id`, `source_reference_period` (période d'origine),
- `target_reference_period` (période de destination),
- `days` (nombre de jours reportés),
- `origin` (ex. `MALADIE`, `AT_MP`, `AUTRE`),
- `expires_at` (date d'échéance, nullable),
- `remaining_days` (jours non encore consommés du lot),
- `created_at`, `created_by`.

Chaque report exceptionnel (`POST /period/carryover`) créerait **un lot** avec une échéance facultative saisie par la RH (défaut : fin de la période de destination, sauf indication contraire pour maladie).

### 3.2. Consommation par échéance
- À l'imputation d'un congé (`applyPaidLeaveForRequest`), la consommation sur le compteur N-1 de destination devrait être **ventilée par lot** (les lots dont l'échéance est la plus proche en premier), en décrémentant `remaining_days`.
- Le solde disponible affiché au salarié distinguerait les lots avec leur **échéance** (« X jours à prendre avant le JJ/MM/AAAA »).

### 3.3. Remise à zéro conditionnelle
- À la clôture, la remise à zéro du compteur N-1 ne s'appliquerait qu'aux jours **sans échéance légale future**.
- Les lots dont `expires_at > date de clôture` resteraient disponibles (reportés sur la période suivante, ou conservés dans un sous-compteur dédié).

### 3.4. Information du salarié
- La notification de report mentionnerait le **nombre de jours** et la **date limite**.
- Une trace datée (notification + audit) constituerait la preuve de l'information.

## 4. Variante minimale sans nouvelle table

Si l'ajout d'une table est jugé trop lourd, une variante consiste à :
- encoder l'échéance dans la **raison du mouvement** (`REPORT_EXCEPTIONNEL|période|échéance|motif`) ;
- dériver l'échéance au moment de la clôture en relisant les mouvements ;
- exclure de la remise à zéro les jours dont l'échéance est postérieure.

**Limite** : sans `remaining_days` par lot, la ventilation précise de la consommation par échéance est plus fragile (il faut reconstituer la chronologie des mouvements).

## 5. Décisions RH nécessaires avant implémentation

1. Quelle est l'**échéance applicable** (15 mois ? dérogations pour arrêts longs ?) et comment la RH la saisit-elle ?
2. Faut-il distinguer plusieurs **origines** (maladie non professionnelle, AT/MP) ?
3. La **consommation par échéance la plus proche** est-elle la règle souhaitée ?
4. Quelle **preuve d'information** au salarié est attendue (notification datée, accusé, courrier) ?

## 6. Périmètre hors proposition

Aucun calcul automatique de droits pendant arrêt maladie, aucune gestion de la paie, aucune modification des règles d'acquisition (2,5 j/mois) ni des quatre circuits de validation.
