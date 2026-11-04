# JUR-027 — Dossier d'homologation et contrôle final de sécurité

**Date** : 29/10/2026
**Statut** : **JUR-027 — Recette technique terminée et validée en environnement de test. Trois règles métier provisoires en attente de confirmation RH. Activation en production non autorisée.**

---

## 1. Sécurité des bases — analyse et garde-fou

### 1.1 Analyse (code, configuration, journaux — sans interroger la base réelle)

- `backend/.env` contient `DB_DATABASE=gestion_conges_gmes` (base réelle).
- `backend/src/app.module.ts` charge `.env` (`ConfigModule.forRoot({ envFilePath: '.env' })`) et `TypeOrmModule.forRootAsync` utilise `DB_DATABASE` avec **`migrationsRun: true`**.
- `backend/test/app.e2e-spec.ts` importe **l'AppModule complet** (il ne crée pas sa propre source TypeORM). Il n'écrase pas `DB_DATABASE`.
- `backend/test/jest-e2e.json` (avant cette intervention) **ne contenait ni `setupFiles` ni variable d'environnement** : `process.env.DB_DATABASE` était vide.
- Les deux autres suites e2e (`carryover-lot-ledger`, `carryover-lot-l4-ledger`) créent leur propre `TypeOrmModule.forRoot({ database: process.env.DB_DATABASE ?? 'gestion_conges_gmes_test' })` → ciblaient bien la base de test.

**Conclusion** : toute exécution de `npx jest --config test/jest-e2e.json` sans `DB_DATABASE=gestion_conges_gmes_test` **fait démarrer `app.e2e-spec.ts` contre la base réelle** `gestion_conges_gmes` (via `.env`), avec `migrationsRun: true`. Une telle exécution a eu lieu pendant la recette (premier passage e2e). **Je ne peux donc pas garantir qu'aucun accès à la base réelle n'a eu lieu** : la connexion (et potentiellement l'exécution de migrations idempotentes déjà appliquées) a pu se produire. Aucune affirmation d'« aucun accès » ne figure dans ce rapport pour cette exécution antérieure.

### 1.2 Garde-fou ajouté (défense en profondeur)

1. **`app.module.ts`** — la fabrique TypeORM lève une erreur **avant toute connexion** si :
   - `NODE_ENV === 'test'` ET `DB_DATABASE !== 'gestion_conges_gmes_test'` ; ou
   - `CARRYOVER_LOTS_ENABLED === 'true'` ET `DB_DATABASE !== 'gestion_conges_gmes_test'`.
   → Les tests e2e et la recette JUR-027 ne peuvent plus démarrer que sur la base de test.
2. **`main.ts`** — garde fail-fast avant `NestFactory.create` : `CARRYOVER_LOTS_ENABLED=true` exige `DB_DATABASE=gestion_conges_gmes_test` (refus immédiat sinon).
3. **`test/setup-e2e.js` + `test/jest-e2e.json` (`setupFiles`)** — force `NODE_ENV=test` et `DB_DATABASE=gestion_conges_gmes_test` avant tout chargement de module.

**Vérifications effectuées** :
- `CARRYOVER_LOTS_ENABLED=true DB_DATABASE=gestion_conges_gmes node dist/main.js` → **refusé avant connexion** (message de garde-fou).
- `CARRYOVER_LOTS_ENABLED=true node dist/main.js` (sans DB_DATABASE, fallback `.env` réel) → **refusé avant connexion**.
- e2e complet **37/37** avec `setupFiles` (base de test forcée).
- Recette flag ON boote et répond (`API disponible`, `GET /api/leave-types` 200).

---

## 2. Migration L6 — chemin versionné et reproductible

Les colonnes `transmitted_at` / `received_at` en `datetime(6)` disposent désormais d'un chemin de migration **versionné**, distinct du script de recette `l6-migrate.mjs` :

- `backend/src/database/migrations/20261028090000-add-carryover-notifications.ts`
  (`AddCarryoverNotifications20261028090000`, `transmitted_at datetime(6)`, ALTER idempotent).
- `backend/src/database/migrations/20261028091500-add-carryover-reception-proofs.ts`
  (`AddCarryoverReceptionProofs20261028091500`, `received_at datetime(6)`, ALTER idempotent).

Les noms de classes correspondent exactement à ceux enregistrés par `l6-migrate.mjs` (idempotence entre les deux chemins). Conformément au pattern des migrations JUR-027 (L1/L3/L4), elles ne sont **pas** enregistrées dans `app.module.ts` et **n'ont pas été exécutées sur une base réelle**.

---

## 3. Concurrence — réessais bornés, pas de deadlock « impossible »

Les deadlocks MySQL (`ER_LOCK_DEADLOCK`, errno 1213) restent **possibles** ; ils sont **gérés par réessais bornés**, et non éliminés.

- `common/deadlock-retry.util.ts` : 3 tentatives, backoff court, **enveloppant la transaction entière** (jamais une portion interne). Toute autre erreur est propagée sans réessai.
- **Effets de bord internes** (leave_request, mouvements, allocations, notifications, audit via `manager`) : atomiques avec la transaction → rollback puis rejeu, **aucune duplication**.
- **Effets de bord externes** (refresh présence, génération PDF, notification post-validation) : situés **après** la boucle de réessai → exécutés **une seule fois**.
- Deux corrections complémentaires : upsert atomique `INSERT … ON DUPLICATE KEY UPDATE id = id` dans `findOrCreateBalanceForUpdate` (supprime la cause principale du deadlock de création concurrente de compteur) ; réessai borné pour les deadlocks résiduels.

**Preuve** : `retest-e3b-concurrency.mjs` **2/2** (un seul gagnant + sérialisation sans deadlock, aucune écriture double).

---

## 4. Règles métier provisoires enregistrées (en attente de confirmation RH)

Ces trois règles provisoires sont **enregistrées pour l'archivage de la recette technique**. Aucune n'a fait l'objet d'une homologation RH à ce jour ; aucune n'est une décision métier définitive. Elles ne modifient aucune règle métier sans approbation.

**D1 — Priorité de consommation :** lots maladie éligibles par expiration croissante, puis congés ordinaires N-1 et N. Cette priorité est un choix de gestion protecteur, non une obligation légale explicite.

**D2 — Validation des congés futurs :** conserver le débit définitif à la prise effective. Les engagements prévisionnels doivent être pris en compte afin d'éviter les doubles affectations, sans introduire maintenant une nouvelle réservation comptable.

**D3 — Annulation après expiration :** conserver une régularisation traçable, sans recrédit automatique ni extinction définitive automatique des droits avant examen des conditions juridiques.

**Références :** Code du travail L3141-19-1 à L3141-19-3 ; Syntec IDCC 1486, articles 5.3 et 5.5 ; Cass. soc. 13 novembre 2025, n° 24-14.084.

**Statut enregistré :** « JUR-027 — Recette technique terminée et validée en environnement de test. Trois règles métier provisoires en attente de confirmation RH. Activation en production non autorisée. »

---

## 5. Bilan définitif

### 5.1 Développement et recette technique — validés

- Build **exit 0** · unit **448 passés / 31 suites** · e2e **37/37** (`--runInBand`).
- Flag OFF : L3 **29/29** · L4 **16/16** · L7 **12/12**.
- Flag ON : real-flow **4/4** · corrections **3/3** · matrix **9/9** · concurrence **2/2**.
- L6 **18/18 × 3 exécutions** (F8/F9/F10 corrigés par `datetime(6)`).
- Concurrence : deadlocks gérés par réessais bornés transactionnels (pas de duplication d'effets de bord).

### 5.2 Réserves de sécurité / préparation à l'activation

- **Une exécution e2e antérieure sans `DB_DATABASE` explicite a pu connecter la base réelle** via `app.e2e-spec.ts` → AppModule → `.env`. Non garanti « sans effet ». Corrigé par le garde-fou (§1) ; aucune nouvelle exécution ne peut reproduire ce cas.
- Les migrations L6 versionnées sont prêtes mais **non appliquées en production**.
- e2e : exécution séquentielle requise (`--runInBand`) en raison d'un trigger de rollback partagé entre suites.

### 5.3 Validation technique vs homologation RH

- **Validation technique** : terminée et validée en environnement de test (cf. §5.1).
- **Homologation RH** : **non acquise**. Trois règles métier provisoires (D1, D2, D3 — cf. §4) restent en attente de confirmation RH. Le test JUR-027 n'est **pas déclaré conforme sur le plan métier**.
- Le suivi du cahier de recette distingue ces deux niveaux : la recette technique JUR-027 est « terminée et validée en test » ; l'homologation métier reste « en attente ».

---

## 6. Reprise de la liste des tests bloquants et non conformes (priorités conservées)

JUR-027 est désormais **techniquement validé** ; il n'est **pas** à reprendre sauf confirmation RH des trois règles provisoires. La reprise porte sur les tests bloquants/non conformes restants, **dans leur ordre de priorité initial** (issu de `AUDIT_SCENARIOS_JURIDIQUES_BLOQUES_v2.3.md`, §8) :

1. **JUR-037** — validation RH des droits pendant arrêt maladie (P1, le plus sensible juridiquement).
2. **JUR-024** — convention applicable par entité (procédure RH, sans développement).
3. **JUR-025** — couverture implicite de l'acquisition pendant AT/MP (décision RH).
4. **JUR-029 / JUR-030 / JUR-031 / JUR-032** — configuration des types d'absence et durées (sans développement).
5. **JUR-019 / JUR-020 / JUR-021 / JUR-022 / JUR-023 / JUR-028** — décision d'automatisation (sinon contournement manuel documenté).

Aucun de ces scénarios n'est démarré ici : seule la liste de reprise est préparée.

---

**`CARRYOVER_LOTS_REAL_FLOW_ENABLED` reste désactivé par défaut.** Aucun accès volontaire à `gestion_conges_gmes` dans le cadre de ces vérifications, aucun déploiement/commit/push, aucun envoi réel, aucune modification des cahiers Word, ports 3000/3001/5173 arrêtés. Code fonctionnel, soldes, migrations et base réelle non modifiés.
