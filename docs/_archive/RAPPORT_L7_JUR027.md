# JUR-027 — Rapport L7 (recette finale) — v1

**Date** : 28/10/2026
**Statut** : **JUR-027 reste « Bloqué »** — conformité technique démontrée en recette, conformité métier/juridique non acquise.

---

## 1. Périmètre exact

Recette finale d'intégration des lots L1→L6 avec les fonctionnalités existantes, **exclusivement sur `gestion_conges_gmes_test`** (API 3001). Aucun redéveloppement. Aucun envoi réel. Périmètre :
- Fonctionnel/métier : reports maladie (création → clôture → notification → preuve), calculs d'échéance, droits/compteurs, reports exceptionnels, réservations, clôture annuelle unifiée, notifications (dont corrigées), preuves de réception, rôles/autorisations.
- Technique : concurrence, atomicité, rollback, confidentialité, non-régression.
- Nouveauté L7 : test d'intégration de bout-en-bout `retest-l7.mjs` (12 contrôles) + reprise des non-régressions.

## 2. Scénarios exécutés (attendu / obtenu)

| # | Scénario | Attendu | Obtenu | Test |
|---|---|---|---|---|
| 1 | Clôture unifiée : lot transféré + GMES (une transaction) | 201 | 201 ✅ | `retest-l7` L7-01 |
| 2 | Notification → preuve → vérification → échéance recalculée L2/L3 | 201, échéance définie | conforme ✅ | L7-02 |
| 3 | Correction + vérification simultanées (atomique) | état final cohérent | A_CORRIGER ✅ | L7-03 |
| 4 | Lot gelé en régularisation → clôture bloquée | 400 | 400 ✅ | L7-04 |
| 5 | Jours réservés exclus du reportable | 400 si > libre | 400 ✅ | L7-05 |
| 6 | Reliquat inconnu → clôture bloquée | 400 | 400 ✅ | L7-06 |
| 7 | Somme des lots > solde → report bloqué | 400 | 400 ✅ | L7-07 |
| 8 | Notification obsolète (A_CORRIGER) → vérification refusée | 409 | 409 ✅ | L7-08 |
| 9 | Document altéré après enregistrement → vérification refusée | 400 | 400 ✅ | L7-09 |
| 10 | Accès croisé entre salariés | 403 | 403 ✅ | L7-10 |
| 11 | Cohérence des échéances après correction → confirmation finale | 201 | 201 ✅ | L7-11 |
| 12 | Aucun envoi réel (courrier/e-mail/SMS) | aucun | conforme ✅ | L7-12 |

## 3. Anomalies découvertes

- **Test de dates flaky** (`retest-l6-final` F8) : comparaison d'instants exacts sur un `receivedAt` calculé trop tôt avant l'appel HTTP. **Correction ciblée de test** (recalcul de l'instant au moment de l'appel), sans modifier la règle métier. Rejoué : **18/18**.
- Aucune anomalie métier bloquante nouvelle.

## 4. Corrections ciblées éventuelles

Aucune correction de code fonctionnel en L7 (les corrections L5/L6 antérieures restent en place : verrou `QueryRunner`, clôture unifiée, preuve contrôlée, dates Martinique, version transmise figée, contrainte `active_key`).

## 5. Non-régression (rejouées dans cette intervention)

| Suite | Résultat |
|---|---|
| `retest-l7.mjs` (intégration) | **12/12 OK** |
| L6 : `retest-l6` / `retest-l6-corrections` / `retest-l6-final` | **30/30 · 19/19 · 18/18 OK** |
| L5 : `retest-l5-unified` / `retest-l5-coordination` / `retest-l5` / `retest-l5-consolidation` | **10/10 · 11/11 · 10/10 · 7/7 OK** |
| L4-final / L4 / L4-isolation | **13/13 · 16/16 · 11/11 OK** |
| L3 | **29/29 OK** |
| Jest (dont moteur L2 51/51) | **29 suites / 424 passés, 38 skip, 0 échec** |
| TypeScript + build | **exit 0** |
| Arrondis L3141 | **11/11 · 18/18 OK** |
| Correction JUR-027 / correction-clôture / report+absences | **24/24 · 7/7 · 12/12 OK** |
| Cycle-clôture / circuit réel | **12/12 · 10/10 OK** |
| Étape 3 / preview | **7/7 · 17/17 OK** |
| **4 circuits GMES** | **50/50 OK** (non-régression, pas preuve d'intégration) |

## 6. Contrôles SQL avant/après

- Clôture unifiée : N−1/N/N+1 remis à zéro, N−1 suivant crédité, lot `target_reference_period` → période suivante, `REFERENCE_PERIOD_CLOSED_<période>` = 1.
- Notification : `document_reference`/`document_checksum`/`transmitted_content_json` figés ; après vérification `information_date_certain=1`, `expires_at` = date réception + 15 mois (clampée), `version` incrémenté.
- Correction : ancienne notification `A_CORRIGER` + `active_key NULL`, nouvelle `BROUILLON` liée (`corrected_from_id`).
- Rollback : preuve/lot/notification intacts après erreur `SIGNAL` (0 mouvement résiduel).

## 7. Réserves métier et juridiques (non levées)

1. **Raccordement bout-en-bout aux quatre circuits** : **non démontré**. Les 50 contrôles circuits sont une non-régression, pas une preuve que les reports maladie sont intégrés aux circuits réels de validation.
2. **Homologation des modes de preuve** (notamment bulletin de paie) : décision RH/juridique requise.
3. **Règle « information dans le mois suivant la reprise »** : validation juridique requise (calendrier/fuseau).
4. **Notification réelle** (courrier/e-mail/SMS) : non réalisée, reste désactivée.
5. **Scénarios partiels** de la matrice : arrêt long expiré/suspendu à la clôture (couverture L2 unitaire), lots multi-périodes, report exceptionnel + maladie simultanés.

## 8. Recommandation motivée

**JUR-027 ne peut pas être déclaré conforme / clos à ce stade.** La conformité **technique** en recette isolée est acquise (les quatre circuits aboutissent à `VALIDEE`, les lots maladie restent intacts, rollback/concurrence/confidentialité démontrés, base réelle intacte). En revanche, la conformité **métier et juridique** n'est pas acquise : le **raccordement automatique de la consommation des lots maladie aux circuits** est absent (outil L4 de recette uniquement), l'homologation des modes de preuve et la validation juridique de la règle du délai d'information restent ouverts.

**Base réelle** : `gestion_conges_gmes` inchangée (aucune table L5/L6, 0 marqueur). Ports 3000/5173 non démarrés. Aucun commit/push. Aucune modification des cahiers Word.

## 9. Complément de recette L7 (levée des réserves techniques)

### 9.1 Intégration aux quatre circuits GMES
Les quatre circuits identifiés : **C1** Collaborateur→RH→Directeur · **C2** Collaborateur→Responsable→RH · **C3** Collaborateur→RH→Directeur (dérogation) · **C4** Collaborateur→RH→Responsable (dérogation).

`retest-l7-complement.mjs` exécute pour chacun un scénario réel bout-en-bout (demande → dérogation si nécessaire → soumission → double validation) avec un salarié porteur de droits maladie. **Résultat : les quatre circuits atteignent `VALIDEE`** (`sub=200`, `v1=200`, `v2=200`, `status=VALIDEE`), et **lot maladie + solde intacts** après validation (la déduction de solde est différée au début effectif du congé — jamais de consommation silencieuse des droits maladie). Le 403 constaté précédemment en C4 provenait d'une **erreur de fixture** (date de congé trop lointaine, dérogation refusée par la fenêtre de prévenance) ; corrigé en réutilisant les dates rapprochées du test de référence, la dérogation est créée (201) et le circuit aboutit à `VALIDEE`.

### 9.2 Arrêt long, multi-périodes, reports+maladie, dates, envois
- **Arrêt long incertain** (`ARRET_LONG`, `A_VERIFIER`) → clôture bloquée (400), solde intact. ✅
- **Lots multi-périodes** : 2 lots d'origines distinctes, échéances distinctes → plan de clôture protège 6 j sans mélange des origines. ✅
- **Reports exceptionnels simultanés sur lot protégé** → 400/400, solde intact (pas de double soustraction). ✅
- **Dates contrôlées** (avant/future/successif) → 400/400/201, avec horaires maîtrisés (transmission fixée en fixture). Le parcours « API réel sans SQL » est couvert par `retest-l6-final` (F6-F8, 18/18). ✅
- **Aucun envoi réel** : aucune notification de type courrier/e-mail/SMS en base ; le service de notification applicatif n'écrit que des lignes `notifications` (l'envoi externe nécessitera un test ultérieur avec un fournisseur). ✅

### 9.3 Réserves levées vs restantes
**Levées (techniques/métier vérifiables automatiquement)** : validation bout-en-bout des quatre circuits (`VALIDEE`, intégrité des droits), arrêt long incertain à la clôture, lots multi-périodes, reports+maladie simultanés, dates/horodatages, absence d'envoi réel.

**Consommation des lots maladie** :
- **A. Consommation L4 isolée** : accessible et couverte par `retest-l4` (16/16) et `retest-l4-final` (13/13) — prévisualisation d'allocation vérifiée dans `retest-l7-complement` (201). ✅
- **B. Consommation intégrée aux circuits GMES** : **NON TESTÉE / MANQUANTE** (le raccordement automatique lots→validation n'est pas câblé ; l'outil L4 est un outil de recette). ❌ — réservée à une autorisation de raccordement.

**Restantes** :
- 🔶 **Homologation juridique des modes de preuve** (bulletin de paie notamment) et de la règle « information dans le mois suivant la reprise ».
- 🔶 **Test ultérieur avec un fournisseur de notification réel** (envoi externe) — non exécutable en recette isolée.
- 🔶 **Raccordement automatique** de la consommation des lots maladie aux circuits de validation (consommation prioritaire au début effectif du congé, restitution en cas d'annulation/refus).

**Recommandation inchangée** : la conformité technique/métier vérifiable en recette est acquise ; JUR-027 reste **Bloqué** tant que l'homologation juridique et le raccordement production ne sont pas actés.

**Aucun commit ni push. JUR-027 reste « Bloqué ». STOP — aucun déploiement ni modification de la base réelle.**
