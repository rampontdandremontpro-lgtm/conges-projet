# Conformité avec le diagramme GMES V1

Le code TypeORM expose exactement 13 entités, correspondant aux 13 tables du diagramme :

1. `users`
2. `services`
3. `leave_types`
4. `leave_requests`
5. `absence_declarations`
6. `documents`
7. `derogations`
8. `leave_balances`
9. `balance_movements`
10. `holidays`
11. `settings`
12. `notifications`
13. `audit_logs`

## Structures retirées

- `generated_documents` : contenu migré dans `documents` avec `document_kind`.
- `leave_request_history` : contenu migré dans `audit_logs`.
- `leave_cancellations` : contenu migré directement dans `leave_requests`.
- `leave_balance_movements` : n'est pas utilisé ; les tables exactes sont `leave_balances` et `balance_movements`.

## Sécurité du schéma

`TypeOrmModule` utilise `synchronize: false`. Toute évolution future devra passer par une migration SQL versionnée.
