# JUR-027 — Rapport du lot L1 (structure additive + inventaire)

**Date** : 26/10/2026
**Périmètre** : développement du lot L1 uniquement, sur l'environnement de recette isolé (`gestion_conges_gmes_test`, API 3001).
**Statut** : **JUR-027 reste « Bloqué ».** Aucune règle d'expiration/consommation/clôture activée.

---

## 1. Fichiers créés / modifiés

| Fichier | Rôle | Statut |
|---|---|---|
| `backend/src/database/migrations/20261026180000-add-carryover-lots.ts` | Migration TypeORM additive `carryover_lots` (préparée, **NON enregistrée** dans `app.module.ts`) | créé |
| `backend/src/leave-balances/carryover-lot.entity.ts` | Entité `CarryoverLot` + enums (préparée, **NON enregistrée** dans un module `forFeature`) | créé |
| `tests/recette/scripts/l1-migrate.mjs` | Applique la migration manuellement sur la base test (garde-fou dur `gestion_conges_gmes_test`, idempotent) | créé |
| `tests/recette/scripts/retest-l1-structure.mjs` | Test de structure / idempotence / non-régression des soldes | créé |
| `tests/recette/scripts/retest-l1-inventory.mjs` | Inventaire historique **lecture seule** des reports exceptionnels | créé |
| `tests/recette/backups/dump-l1-20261026-194034/` | Sauvegarde complète `mysqlsh util.dumpSchemas` (17 tables) | créé |

**Aucune modification** de `app.module.ts` (migration non exécutée au démarrage), d'aucune table existante, d'aucun service métier.

## 2. Structure exacte de `carryover_lots`

| Colonne | Type | Notes |
|---|---|---|
| `id` | bigint PK AI | |
| `employee_id` | bigint NOT NULL | FK users RESTRICT |
| `source_reference_period` | varchar(20) NOT NULL | période d'origine |
| `target_reference_period` | varchar(20) NOT NULL | période de rattachement |
| `target_counter_type` | varchar(20) NOT NULL default `N-1` | compteur associé |
| `days` | decimal(7,2) NOT NULL default 0 | quantité initiale |
| `remaining_days` | decimal(7,2) **NULL** | **NULL = quantité inconnue** |
| `origin` | varchar(20) NOT NULL default `AUTRE` | MALADIE/AT_MP/AUTRE |
| `regime` | varchar(20) NOT NULL default `GENERAL` | GENERAL/ARRET_LONG |
| `status` | varchar(20) NOT NULL default `A_VERIFIER` | ACTIF/SUSPENDU/EXPIRE/A_VERIFIER |
| `absence_start_date` / `absence_end_date` | date NULL | |
| `reprise_date` | date NULL | |
| `information_date` | date NULL | |
| `information_mode` | varchar(40) NULL | |
| `proof_id` | bigint NULL | FK documents SET NULL |
| `expires_at` | date NULL | |
| `expiry_basis` | text NULL | fondement du calcul |
| `reason` | text NULL | |
| `created_by` | bigint NULL | FK users SET NULL |
| `created_at` / `updated_at` | datetime | audit |

Index : `IDX_carryover_lots_employee_status`, `IDX_carryover_lots_target`, `IDX_carryover_lots_expires`.

## 3. Preuve que seule la base de recette a été utilisée

- Le runner `l1-migrate.mjs` vérifie `SELECT DATABASE() === 'gestion_conges_gmes_test'` avant toute écriture.
- La migration est **absente du tableau `migrations` d'`app.module.ts`** : le backend normal (3000, `migrationsRun:true`) ne l'exécute pas.
- Vérification après coup sur `gestion_conges_gmes` : `carryover_lots` **ABSENT**, 0 enregistrement `CarryoverLots` dans `typeorm_migrations`. Base réelle intacte.
- Serveurs 3000/5173 restés actifs (HTTP 200).

## 4. Résultat de l'inventaire historique

- Sur base vierge : **0 report** (correct).
- Après création d'un report réel (4 j, motif « Arrêt maladie — congés non pris (L3141-19-1) ») :
  - Collaborateur, période d'origine 2025-2026, destination 2026-2027 (N-1), date, quantité 4 j, motif, consommation associée 0 j, remise à zéro 0 j, solde actuel 4 j, **état « À VÉRIFIER »**.
  - Le motif contenant « maladie » est signalé comme **insuffisant à qualifier juridiquement** le report.
- Lecture seule confirmée (aucune écriture).

## 5. Tests et résultats réellement obtenus

| Test | Résultat |
|---|---|
| `retest-l1-structure` (structure, 22 colonnes, `remaining_days` NULL, idempotence, non-régression soldes/mouvements/settings) | **9/9 OK** |
| `retest-l1-inventory` (lecture seule, vide puis non vide) | **3/3 OK** (non vide) |
| `retest-arrondi-l3141-7` (GMES) | **11/11 OK** |
| `retest-arrondi-l3141-7-cas` | **18/18 OK** |
| `retest-jur027-correction` (débit source) | **24/24 OK** |
| `retest-jur027-correction-cloture` | **7/7 OK** |
| `retest-jur027-report-et-absences` | **12/12 OK** |
| `retest-jur027-circuit-reel` | **8/10** — les 2 KO correspondent aux **anciennes assertions du bug** (« source PAS débitée » / « double usage ») : elles échouent désormais parce que le bug est corrigé (source débitée, total = 10 sans double usage). Ce n'est **pas** une régression. |
| `retest-preview-cloture` | **17/17 OK** |
| `retest-preview-l3141` | **3/3 OK** |
| `retest-etape3-apres` (protections de clôture) | **7/7 OK** |

Total hors script de reproduction : **111/111 OK**. Quatre circuits de validation : aucun code validé/validateur modifié (seuls migration/entité/scripts ajoutés) ; le circuit réel est couvert par `retest-jur027-circuit-reel`.

## 6. Risques restants

- La migration et l'entité sont **préparées mais non enregistrées** : tant qu'elles ne sont pas ajoutées à `app.module.ts`, le backend normal ne crée pas la table. L'enregistrement sera fait dans un lot ultérieur, avec flag/rollback.
- Le `retest-jur027-circuit-reel` est un **script de reproduction** obsolète (il documente le bug corrigé) ; il devra être remplacé par un test de non-régression post-fix.

## 7. Statut de préparation du lot L2

- L1 est **terminé** (structure + inventaire + non-régression).
- L2 (`computeExpiry` pur, `addMonthsClamp`, suspension) est **préparé mais non entamé**, dans l'attente des décisions RH/Juridique (durée, régimes, L3141-21-1, preuve d'information).

**Aucun commit ni push. JUR-027 reste « Bloqué ».**
