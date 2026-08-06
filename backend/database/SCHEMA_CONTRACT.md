# Contrat de schéma GMES V1

Source de vérité : `reference/diagramme_bdd_gestion_conges_gmes_v1_simplifie.dbml`.

| Table | Nombre de colonnes |
|---|---:|
| `services` | 12 |
| `users` | 17 |
| `leave_types` | 15 |
| `leave_requests` | 41 |
| `absence_declarations` | 18 |
| `documents` | 16 |
| `derogations` | 14 |
| `leave_balances` | 9 |
| `balance_movements` | 11 |
| `holidays` | 9 |
| `settings` | 6 |
| `notifications` | 12 |
| `audit_logs` | 9 |

Le backend contient exactement 13 classes décorées avec `@Entity()`, une pour chacune de ces tables.

Les éléments suivants ne sont pas des tables dans cette version :

- les PDF officiels sont enregistrés dans `documents` avec `document_kind = PDF_VALIDATION` ou `PDF_ANNULATION` ;
- l’historique métier est enregistré dans `audit_logs` ;
- l’annulation après validation est enregistrée directement dans `leave_requests` ;
- les fermetures GMES sont enregistrées dans `holidays` avec `holiday_type = FERMETURE_GMES`.
