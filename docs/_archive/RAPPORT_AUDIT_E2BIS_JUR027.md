# JUR-027 — Rapport d'audit E2-bis (sécurité transactionnelle du ledger)

**Date** : 28/10/2026
**Statut** : **audit réalisé, anomalies du ledger corrigées, aucune intégration.** JUR-027 reste « Bloqué ».

---

## 1. Contrôles effectués

| # | Contrôle | Verdict |
|---|---|---|
| 1 | Duplication L4 / E2 (comparaison ligne à ligne) | **NON CONFORME** → doublons identifiés, cible proposée, refactor E3 reporté |
| 2 | Droits disponibles réels (sur-réservation compteur) | **NON CONFORME au départ → CORRIGÉ → CONFORME** |
| 3 | Concurrence renforcée + deadlock | **CONFORME** (6 scénarios, aucun deadlock) |
| 4 | Protections métier explicites | **NON CONFORME au départ → CORRIGÉ → CONFORME** |
| 5 | Sécurité d'accès au ledger | **CONFORME** (aucun consommateur) |
| 6 | Instabilité L6 F8/F9/F10 | **diagnostic établi** ; correction hors périmètre → **BLOQUÉ** |

## 2. Duplication de logique L4 / E2

**Fonctions dupliquées** entre `CarryoverLotAllocationService` (L4, gated recette+RH) et `CarryoverLotLedgerService` (E2, sans gate) :
- Éligibilité des lots (`isLotConsumable` + filtres) ;
- Écriture des mouvements `RESERVATION` / `DEDUCTION` / `LIBERATION_RESERVATION` / `RECREDIT` (mêmes champs `balanceBefore/After`, `days`, `reason`) ;
- Restitution de lot à la libération (expiré → `REGULARISATION` gelée `frozenInBalance` vs `ANNULATION` + `lot.remainingDays`) ;
- Restitution après expiration (→ `REGULARISATION`, pas de recrédit) ;
- Verrous `pessimistic_write` sur lots/compteurs + détection de doublons (contrôle mouvements + `UQ_lot_allocations_request_lot_op` + traduction `ER_DUP_ENTRY`).

**Cible (une seule implémentation transactionnelle faisant autorité)** : `CarryoverLotLedgerService` devient l'autorité pour les opérations **lots uniquement**. Le service L4 conserve :
- son `buildPlan` / `allocateOrdinary` (partie jours ordinaires, hors périmètre ledger) ;
- ses gardes `assertEnvironment` + `assertRh` ;
- ses contrôles de statut de demande (`loadRequest`) ;
- ses DTO/endpoints.

**Conséquence précise du refactor (non réalisé — E3+)** :
- `reserve`/`consume` L4 : appeler `ledger.reserve/consume` pour la part lot, puis écrire la part ordinaire via la boucle ordinaire existante.
- `release` L4 : déléguer la part lot au ledger, conserver la boucle de libération ordinaire.
- `restore` L4 : déléguer la part lot au ledger, conserver le recrédit des mouvements `DEDUCTION` **ordinaires** (le ledger ne traite pas l'ordinaire).
- Nécessité d'exposer des variantes `*WithManager(manager, …)` sur le ledger afin d'être appelées **dans** la transaction L4 (TypeORM ne ré-entrant pas proprement `dataSource.transaction` imbriqué).

## 3. Anomalies réelles corrigées dans le ledger (E2-bis)

1. **Sur-réservation de compteur possible** : `reserve` décrémentait le reliquat du lot et incrémentait `reservedDays` sans vérifier la capacité du compteur. → ajout de `lockAndValidateCounters` : verrouille les compteurs N-1 concernés et impose, **avant toute écriture** :
   `∑(reliquats de lots connus) + réservés + gelés ≤ disponible`.
2. **Restitution après expiration erronée** : `restore` recréditait le compteur et créait un `RECREDIT` même pour un lot expiré. → aligné sur L4 : lot expiré ⇒ **aucun recrédit, aucune restitution de lot**, simple `REGULARISATION` RH (champ `regularisationDays` ajouté au résultat).
3. **Distinction « expiré à la date d'opération » manquante** : un lot `ACTIF` dont `expiresAt < aujourd'hui` était considéré consommable. → `planAllocation` marque désormais ces lots `EXPIRE_A_LA_DATE_OPERATION` (distinct d'une échéance qui précède seulement la journée de congé).
4. **Gardes défensives** : `consume`/`release`/`restore` refusent désormais tout dépassement (`availableDays`/`reservedDays`/`consumedDays` insuffisants).

## 4. Nouveaux tests et résultats

### 4.1 e2e ledger — **26/26 OK** (14 existants + 12 nouveaux)

- **Droits réels** : lot > compteur → 400 sans écriture ; compteur déjà réservé → 400 ; deux demandes même compteur → pas de sur-réservation ; allocation partielle → `uncovered` signalé, **0 mouvement ordinaire**, `available` inchangé.
- **Concurrence** : deux demandes différentes sur les mêmes lots → somme exacte, pas de sur-réservation ; deux consommations → 1×201/1×409 ; consommation vs libération → un seul gagnant, état cohérent ; deux restitutions → 1 seul `RECREDIT`.
- **Protections** : expiré à la date d'opération (`EXPIRE_A_LA_DATE_OPERATION`) vs échéance précédant la journée (jour `uncovered`) ; `frozen_in_balance` compté dans la capacité ; restitution après expiration → `REGULARISATION`, pas de recrédit, lot non restitué.
- **Invariants vérifiés en SQL avant/après** : `reserved ≤ available`, `consumed ≤ acquired`, jamais de `remaining_days` négatif, mouvements sans doublon.

### 4.2 Non-régression

| Vérification | Résultat |
|---|---|
| TypeScript + build | **exit 0** |
| Jest unitaire | **30 suites / 441 passés / 38 skip** |
| L3 / L4 / L4-final / L4-isolation / L5-unified / L7 | **29/29 · 16/16 · 13/13 · 11/11 · 10/10 · 12/12 OK** |
| L6-final | **flaky F8** (voir §5), indépendant du ledger |

## 5. Instabilité L6 F8/F9/F10 — diagnostic établi

### Cause racine démontrée (capture réelle)

`transmitted_at` est une colonne **`datetime` sans fraction de seconde** (`carryover-notification.entity.ts`, `type: 'datetime'`). MySQL **arrondit** la valeur à la seconde lors de l'insertion.

Diagnostic `tests/recette/scripts/_diag-l6-f8.mjs` (12 itérations) :

| itération | `transmitted_at` précis | `receivedAt` (client) | delta | HTTP attach |
|---|---|---|---|---|
| #2 | `18:28:22.000000` | `17:28:21.588Z` | **-412 ms** | **400** |
| #3 | `18:28:22.000000` | `17:28:21.791Z` | **-209 ms** | **400** |
| #5 | `18:28:22.000000` | `17:28:22.150Z` | +150 ms | 201 |
| #10 | `18:28:23.000000` | `17:28:23.087Z` | +87 ms | 201 |

Le `transmit` pose `transmittedAt = new Date()` (ex. `…21.588`), MySQL l'arrondit à `…22.000`. Le client capture `receivedAt = new Date().toISOString()` encore dans la seconde précédente (`…21.588+ε`), donc `< transmittedAt` → **400 « Date de réception antérieure à la date de transmission »**.

### F9/F10 = conséquences directes de F8

- F8 `okD` → 400 ⇒ `okD.data?.id` est `undefined`.
- F9 appelle `verify(nidD, undefined, OK)` ⇒ échec (≠ 201) ⇒ `information_date` reste `NULL` ⇒ `info=null`.
- F10 : même cascade ⇒ `expires_at` reste `NULL` ⇒ `expires=null`.

Le second passage à 18/18 est **un artefact de l'arrondi** (les millisecondes de la transmission tombent alors en dessous de 500 ms), pas une résolution.

### Statut

**BLOQUÉ** : la correction (fraction de seconde sur `transmitted_at`, ou comparaison sur secondes tronquées) touche le service/entité L6, **exclue de cette intervention** sans autorisation. Aucune assertion n'a été modifiée.

## 6. Sécurité d'accès au ledger

`CarryoverLotLedgerService` est référencé **uniquement** :
- dans son propre fichier ;
- dans `carryover-lots.module.ts` (providers + exports).

**Aucun contrôleur, aucune route HTTP, aucun utilisateur, aucun traitement automatique (scheduler), aucun autre service ne l'injecte.** L'export est préparatoire (E3). Le test e2e utilise un module de test privé (pas d'endpoint exposé). Aucun endpoint de test ajouté.

## 7. Risques résiduels

- **Deadlock théorique** entre ordres de verrouillage (`reserve` : lots→compteurs ; `consume/release/restore` : allocations→compteurs). Aucun deadlock observé sur les 6 scénarios de concurrence. Le `guard` ne réessaie pas un deadlock (ER_LOCK_DEADLOCK) — à prévoir en E3 (réessai borné ou ordre de verrouillage unique).
- Le ledger est **sans gate** (par conception) : la garde environnement/RH reste à la charge de l'appelant.
- Le refactor anti-duplication L4→ledger n'est **pas encore réalisé**.

## 8. Conditions précises pour autoriser E3

1. **Valider la cible mono-implémentation** : ledger = autorité pour les lots ; L4 délègue via variantes `*WithManager` (sans transaction imbriquée).
2. **Définir la signature de retombée des jours `uncovered`** sur l'allocation ordinaire N-1/N existante.
3. **Décider** : moment de réservation (validation vs début effectif) et restitution après expiration (`frozen_in_balance` vs recrédit) — homologation RH.
4. **Traiter séparément l'instabilité L6 F8** (autorisation dédiée) avant de la considérer acquise.
5. **Maintenir** `CARRYOVER_LOTS_ENABLED` jusqu'à homologation juridique.

---

**Aucun raccordement C1-C4, aucun changement du scheduler ni des méthodes comptables existantes, aucun commit/push, aucun envoi réel. Base réelle `gestion_conges_gmes` intouchée (0 table L5/L6, ports 3000/5173 non démarrés). JUR-027 reste « Bloqué ».**
