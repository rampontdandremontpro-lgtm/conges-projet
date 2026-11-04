# JUR-027 — Rapport du lot L6 (information individuelle et preuves de réception) — v3 (vérifications finales)

**Date** : 28/10/2026
**Statut** : **JUR-027 reste « Bloqué ».** L6 développé et corrigé **uniquement en recette isolée** (`gestion_conges_gmes_test`, API 3001). Aucun envoi réel.

---

## 0. Contrôles préalables L5 (réalisés avant L6)

- **A. Flag désactivé** : clôture normale complète 201 (N transféré 21 après arrondi, N−1/N+1 remis à zéro, mouvements/notification/audit/marqueur). ✅
- **B. Report exceptionnel vs lot protégé** : défaut reproduit (3 j prélevait 1 j sur le lot) puis **corrigé** — 3 j → 400, 2 j ordinaires → 201. ✅

## 1. Problèmes reproduits puis corrigés

1. **Preuve assimilée à une simple existence de fichier** : un fichier synthétique + un `/verify` suffisait à rendre `informationDateCertain=true` et recalculer l'échéance.
2. **Dates comparées au jour civil** : réception 09h pour transmission 16h acceptée ; heure future du même jour non rejetée ; dérive UTC via `toISOString()`.
3. **Contenu non figé** : `contentJson` était enrichi après réception sans version transmise archivée ni détection de discordance.
4. **Justificatifs insuffisamment contrôlés** : MIME déclaré non vérifié (contenu réel), base64 non validé strictement, chemin `PRIVATE_STORAGE_ROOT` incohérent Windows/Git Bash, chemin privé exposé dans les réponses salarié.
5. **Concurrence** : `prepare` sans contrainte d'unicité DB (deux créations pouvaient passer), annulation possible après vérification.
6. **Report exceptionnel** : `SUM(remaining_days)` ignorant `NULL`, les lots expirés et les jours gelés (double soustraction possible).

## 2. Corrections effectuées

### 2.1 Preuve juridiquement contrôlée (plus de simple existence)
`verifyProof` exige une **décision RH structurée et motivée** : `result` (`CONFORME`/`NON_CONFORME`), `note`, `recipientIdentityConfirmed`, `requiredInfoPresent`. Contrôles exécutés :
- identité du destinataire, nature du justificatif, mode de remise, correspondance preuve/mode, date de réception établie, lien avec le document transmis, présence des informations obligatoires, identité du RH vérificateur, résultat motivé.
- `NON_CONFORME` → preuve `REJETE` + notification `A_CORRIGER`, **aucune** échéance confirmée.
- `CONFORME` sans identité/vérifications → **400**.
- **`SIMULATION`** : mode de preuve explicite réservé aux fixtures (jamais un raccourci métier ; l'ensemble reste gated flag + base test).

### 2.2 Dates et fuseaux exacts
- Comparaison des **instants exacts** (`transmittedAt.getTime()` vs `receivedAt.getTime()`) : réception 09h pour transmission 16h → **400** ; heure future → **400** ; succession réelle → acceptée.
- **Date civile Martinique** (`Intl.DateTimeFormat` America/Martinique) pour `information_date` SQL (`DATE`), sans `toISOString()` ; testé : date SQL relue sans changement de jour, échéance exacte à 15 mois (31→mois court et bissextile couverts par le moteur L2, 51/51).
- Transmission enregistrée ≠ preuve d'envoi effectif (pas d'antidatage possible).

### 2.3 Version transmise figée
À la transmission : `document_reference` (unique), `document_checksum` (sha256 du contenu), `transmitted_content_json` (copie figée). Après réception, si l'échéance définitive diffère de l'échéance prévisionnelle du document reçu → `coherence_anomaly=true` + `coherence_note` + statut **`A_CORRIGER`** (pas `RECEPTION_VERIFIEE`). Une correction produit une **nouvelle notification liée** (`corrected_from_id`) avec sa propre transmission/réception.

### 2.4 Sécurité des justificatifs
- Formats autorisés (`application/pdf`, `image/png`, `image/jpeg`, `text/plain`, `application/octet-stream`), **magic bytes** vérifiés (PDF `%PDF-1.x`, PNG, JPEG), taille max serveur (HTTP 413 + service 5 Mo), base64 strict, chemin canonique `resolve()` borné à la racine privée.
- SHA-256 vérifiée **avant** confirmation (testé par modification réelle des octets → 400).
- Téléchargement **RH uniquement** avec contrôle du rattachement ; réponses salarié **sans** `storage_key`/`checksum`.
- Nettoyage du fichier orphelin en cas d'échec d'enregistrement ; preuves conservées dans l'historique.
- `PRIVATE_STORAGE_ROOT` aligné sur un chemin absolu Windows (`C:/recette-storage`) partagé par l'API et les tests.

### 2.5 Concurrence
- `carryover_notifications.active_key` (`A:<employeeId>`, UNIQUE) → **une seule notification active par salarié** (deux `prepare` simultanés = 201/409, garanti par contrainte DB).
- Verrou pessimiste sur la notification pour validate/transmit/verify/correct/cancel ; `cancel` refuse une notification déjà `RECEPTION_VERIFIEE`.
- Version des lots vérifiée avant confirmation (un lot modifié depuis la préparation → 409).

### 2.6 Report exceptionnel (états particuliers)
Calcul : `reportable = disponible − réservé − Σ(reliquats protégés) − Σ(reliquats expirés) − Σ(gelés)`. `remaining_days IS NULL` → **blocage** (origine incertaine) ; somme des lots > solde → **blocage** (rapprochement impossible). Aucune double soustraction (SUM SQL sans double comptage, valeurs NULL détectées explicitement).

## 3. Nouveaux tests ciblés (`retest-l6-corrections.mjs`) — **19/19**

C1-C3 décision RH structurée (NON_CONFORME/CONFORME incomplet/CONFORME complet) · C4-C8 dates et fuseaux · C9-C10 document figé + anomalie de cohérence · C11-C14 sécurité des justificatifs (magic bytes, taille, octets réels, téléchargement, confidentialité) · C15-C18 concurrence (prepare/validate/transmit/cancel-vs-verify) · C19 report exceptionnel reliquat NULL.

## 4. Résultats complets (rejoués dans cette intervention)

| Vérification | Résultat |
|---|---|
| `retest-l6-corrections.mjs` (nouveau) | **19/19 OK** |
| `retest-l6-final.mjs` (vérifications finales, nouveau) | **18/18 OK** |
| `retest-l6.mjs` (30 scénarios) | **30/30 OK** |
| L5 : `retest-l5-unified` / `retest-l5-coordination` / `retest-l5` / `retest-l5-consolidation` | **10/10 · 11/11 · 10/10 · 7/7 OK** |
| L4-final / L4 / L4-isolation | **13/13 · 16/16 · 11/11 OK** |
| L3 | **29/29 OK** |
| Suite backend Jest (dont L2 51/51) | **29 suites / 424 passés, 38 skip, 0 échec** |
| TypeScript + build | **exit 0** |
| Non-régression : correction JUR-027 (24), report+absences (12), cycle-clôture (12), circuit réel (10), **4 circuits (50/50)** | **tous OK** |
| Rollback après 1ʳᵉ écriture SQL (trigger `SIGNAL`) | ✅ preuve/lot/notification intacts |

## 4bis. Vérifications finales avant L7 (tableau de contrôle)

Légende : ✅ démontré · ⚠️ partiel · 🔶 homologation RH/juridique requise.

| # | Scénario | Attendu | Obtenu | Test | Preuve | Limite |
|---|---|---|---|---|---|---|
| 1 | `verifyProof` sans document transmis lié | 400 | 400 ✅ | `retest-l6-final` F1 | SQL `transmitted_content_json` | — |
| 2 | Décision `NON_CONFORME` | A_CORRIGER, échéance non confirmée | A_CORRIGER ✅ | F2 | lot `information_date` inchangé | — |
| 3 | `SIMULATION` en production | 404 (gate flag+base) | 404 ✅ | préalable « sans flag » | `assertEnvironment` | aucun envoi réel |
| 4 | Collaborateur télécharge une preuve | 403 | 403 ✅ | F3 | `RolesGuard` RH | — |
| 5 | Réponses salarié sans `storageKey`/`checksum` | absent | absent ✅ | F4 | `getMine` épuré | — |
| 6 | Accès notification d'un autre salarié | 403 | 403 ✅ | F5 | `getOne` propriétaire | — |
| 7 | Réception antérieure à transmission (API réel) | 400 | 400 ✅ | F6 | instants comparés | — |
| 8 | Réception future (API réel) | 400 | 400 ✅ | F7 | `> now` | — |
| 9 | Succession réelle | 201 | 201 ✅ | F8 | — | — |
| 10 | Date SQL relue sans dérive de jour | Martinique | conforme ✅ | F9 | `DATE_FORMAT` | — |
| 11 | Échéance 15 mois (clampée) | +15 mois | conforme ✅ | F10 | `addMonthsClamped` | — |
| 12 | Dernier jour du mois / bissextile | L2 | couvert ✅ | L2 51/51 | unitaires | — |
| 13 | Échéance incohérente → A_CORRIGER | A_CORRIGER + anomalie | conforme ✅ | F11 | `coherence_anomaly` | — |
| 14 | Notification corrigée créée liée | BROUILLON liée | conforme ✅ | F12 | `correctedFromId` | — |
| 15 | Ancienne notification obsolète | 409 | 409 ✅ | F13 | statut A_CORRIGER | — |
| 16 | Nouvelle notification : confirmation finale | 201 | 201 ✅ | F14 | — | — |
| 17 | Plusieurs lots + reliquat inconnu (report) | 400 | 400 ✅ | F15 | blocage origine incertaine | — |
| 18 | Somme lots > solde (report) | 400 | 400 ✅ | F16 | rapprochement impossible | — |
| 19 | Lot modifié entre préparation et vérification | 409 | 409 ✅ | F17 | contrôle de version | — |
| 20 | Annulation + vérification simultanées | un seul gagnant | 201/409 ✅ | F18 | verrou pessimiste | — |
| 21 | Correction + vérification simultanées | atomique | atomique ✅ | `retest-l6-corrections` C15-C18 | transactions | — |
| 22 | Notification réelle (courrier/e-mail/SMS) | aucun envoi | aucun ✅ | — | — | 🔶 L7 |
| 23 | Homologation des modes de preuve | RH/juridique | à décider | — | — | 🔶 L7 |
| 24 | Raccordement aux 4 circuits | bout-en-bout | non réalisé | circuits 50/50 (non-régression) | — | 🔶 L7 |

## 5. Base réelle et confidentialité

`gestion_conges_gmes` : **aucune** table L5/L6, **0 marqueur**. Serveurs 3000/5173 non démarrés. Aucun envoi réel (courrier/e-mail/SMS). Aucun commit/push. Aucune modification des cahiers Word.

## 6. Décisions restant obligatoirement soumises à la RH / validation juridique (L7)

- Raccordement bout-en-bout aux **quatre circuits** et au parcours salarié réel.
- Homologation des **modes de preuve** (notamment bulletin de paie) et de la règle « information dans le mois suivant la reprise ».
- Notification réelle (envoi) : reste désactivée.
- Couverture ⚠️ restante de la matrice des 25 scénarios (arrêt long suspendu/expiré à la clôture, lots multi-périodes).

**Aucun commit ni push. JUR-027 reste « Bloqué ». STOP — L7 non entamé.**
