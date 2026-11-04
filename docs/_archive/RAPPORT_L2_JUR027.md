# JUR-027 — Rapport du lot L2 (moteur pur de calcul des échéances) — v2

**Date** : 27/10/2026 — **version 2 (3 corrections de sécurité intégrées)**
**Périmètre** : moteur TypeScript **pur** (sans base de données, sans service métier, sans écriture). Aucune migration, aucune opération SQL, aucune modification des compteurs, circuits, clôture, notifications ou cahiers Word.
**Statut** : **JUR-027 reste « Bloqué »** — le moteur est livré en module isolé, non intégré à l'application.

---

## 1. Fichiers

| Fichier | Rôle |
|---|---|
| `backend/src/leave-balances/carryover-expiry/carryover-expiry.types.ts` | Types, enums, constantes (régimes, situation d'absence, états du délai, entrée/sortie) |
| `backend/src/leave-balances/carryover-expiry/carryover-expiry.util.ts` | Utilitaires de dates purs : `addMonthsClamp`, `addDays`, `daysBetween`, `compareDates`, `isValidDateString` |
| `backend/src/leave-balances/carryover-expiry/carryover-expiry.service.ts` | Moteur : `computeCarryoverExpiry(input)` + enveloppe `CarryoverExpiryService` |
| `backend/src/leave-balances/carryover-expiry/carryover-expiry.service.spec.ts` | **51** tests unitaires Jest |
| `backend/src/leave-balances/carryover-expiry/carryover-expiry.examples.ts` | Exemples chiffrés exécutables |

Aucun fichier existant modifié. Aucune intégration (pas de `forFeature`, pas de contrôleur, pas de migration).

## 2. Corrections de sécurité (v2)

### A. Preuve d'information — échéance opposable vs indicative
- Une échéance n'est **OPPOSABLE** (peut fonder une expiration automatique) **que si** `informationDateCertain === true`.
- Sinon (`false` ou non renseigné) : **aucune `effectiveExpiresAt`** ; seule une **`indicativeExpiresAt`** (date informative) est renvoyée et le statut est **`A_VERIFIER`**.
- Les champs sont séparés : `effectiveExpiresAt` (opposable) et `indicativeExpiresAt` (indicatif, jamais utilisé pour expirer un droit).

### B. Absence en cours vs date inconnue
- Nouvelle entrée explicite **`absenceStatus`** : `ABSENT` (toujours absent, confirmé), `REPRIS` (repris avec date fiable), `INCONNU` (défaut).
- Une date de reprise **absente ou invalide n'est plus interprétée comme « toujours absent »** : elle produit `A_VERIFIER` (ou un statut déduit `REPRIS` avec avertissement si la date est valide).
- Une **date invalide est signalée explicitement** (`Date invalide (reprise/information/fin de période de référence) : « … »`), jamais silencieusement traitée.
- Même prudence appliquée à `informationDate`, `referencePeriodEnd` et `today`.

### C. Conditions L3141-19-2 — validation des deux conditions
- Le régime `ARRET_LONG` exige désormais **les deux conditions** `true` :
  1. `acquiredDuringL3141_5_5or7` — congés acquis pendant les périodes L3141-5 (5° ou 7°).
  2. `suspensionAtLeastOneYearAtPeriodEnd` — suspension d'au moins un an à la fin de la période de référence.
- Une condition inconnue (`null`) ou fausse (`false`) → **`A_VERIFIER`, aucune expiration** au titre de L3141-19-2 (pas de déduction depuis le nom du régime).

## 3. Fonctionnement (règles inchangées hors garde-fous)

- **L3141-19-1 (GENERAL)** : échéance = `information_date + N mois` (N = 15 par défaut, configurable L3141-21-1). Opposable seulement si `informationDateCertain === true`.
- **L3141-19-2 (ARRET_LONG)** : base = `fin de période + N mois` ; toujours absent → expire à la base ; reprise **après** échéance → `EXPIRE` sans prolongation ; reprise **avant** échéance → reliquat `(base − reprise)` suspendu, échéance = `base + (information − reprise)` ; information non datée → `SUSPENDU`.
- Échéance **inclusive** : le jour même est consommable, le lendemain est expiré.

## 4. Tests — résultats réellement obtenus

| Vérification | Résultat |
|---|---|
| Tests dédiés L2 | **51/51 OK** (`npx jest carryover-expiry`) |
| Suite backend complète (non-régression) | **27 suites / 385 tests passés, 38 skip préexistants, 0 échec** |
| TypeScript complet | `npx tsc --noEmit -p tsconfig.json` → **exit 0** |

Les 34 tests initiaux ont été **conservés** (adaptés aux nouveaux garde-fous : `absenceStatus: 'ABSENT'` explicite, `acquiredDuringL3141_5_5or7: true`, `informationDateCertain: true` pour les échéances opposables). **17 nouveaux tests** couvrent les garde-fous A/B/C et leurs combinaisons.

## 5. Exemples chiffrés (sortie réelle du moteur)

| Cas | Échéance opposable | Échéance indicative | État |
|---|---|---|---|
| Général : info certaine 25/06/2025 | 25/09/2026 | — | EN_COURS |
| Général : info non confirmée (date certaine = false) | — | 25/09/2026 | A_VERIFIER |
| Général : info absente | — | — | A_VERIFIER |
| Arrêt long ABSENT (fin période 31/05/2025) | 31/08/2026 | — | EXPIRE (01/09/2026) |
| Arrêt long REPRIS : reprise 01/03/2026, info 01/04/2026 | 01/10/2026 (reliquat 183 j, suspension 31 j) | — | EN_COURS |
| Arrêt long REPRIS : reprise 01/10/2026 (après échéance) | 31/08/2026 | — | EXPIRE |
| Arrêt long : info tardive 01/06/2026 | 01/12/2026 (+92 j) | — | EN_COURS |
| Arrêt long : info non datée | — | — | SUSPENDU (reliquat 183 j) |
| Arrêt long : situation de reprise non renseignée | — | — | A_VERIFIER |
| Arrêt long : condition L3141-19-2 non renseignée | — | — | A_VERIFIER |
| Conventionnel 18 mois (L3141-21-1) | 25/12/2026 | — | EN_COURS |
| Bissextile : info 29/02/2024 | 29/05/2025 | — | EN_COURS |

## 6. Sécurité / isolation

Aucune connexion base, aucune migration, aucun SQL. Bases, `carryover_lots`, compteurs, circuits, clôture, notifications : **aucune modification**. Serveurs 3000/5173 **non démarrés**, configuration non touchée. Moteur **non enregistré** dans `app.module.ts` ni dans un module.

## 7. Décisions juridiques restant à confirmer avant activation (L3+)

1. **Durée** : 15 mois + points de départ confirmés.
2. **L3141-21-1** : accord/convention GMES à prouver ; à défaut 15 mois (moteur configurable).
3. **Preuve d'information** : moyen admis comme « date certaine » (accusé daté, bulletin, courrier) — le moteur exige `informationDateCertain === true` pour toute échéance opposable.
4. **Conditions L3141-19-2** : sources de données pour établir « congés acquis pendant L3141-5 5°/7° » et « suspension ≥ 1 an à la fin de période » (reçues en entrée, non calculées).
5. **Taxonomie** : `MALADIE`/`AT_MP`/`AUTRE` et régimes `GENERAL`/`ARRET_LONG`.
6. **Consommation (L4)** : FIFO par échéance + ventilation par dates effectives.
7. **Données manquantes** : `A_VERIFIER`/`SUSPENDU` sans expiration automatique (implémenté).
8. **Recrédit après expiration** : règle RH (jamais de transformation automatique en jours ordinaires).

**Aucun commit ni push. JUR-027 reste « Bloqué ». L2 finalisé — L3 non entamé.**
