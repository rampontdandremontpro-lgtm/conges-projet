# Fichiers d'entités supprimés

Les fichiers suivants ne doivent plus exister après remplacement du projet :

- `src/generated-documents/generated-document.entity.ts`
- `src/leave-requests/leave-request-history.entity.ts`
- toute éventuelle entité `leave-cancellation.entity.ts`
- toute éventuelle entité `leave-balance-movement.entity.ts`

Le service de génération de PDF est conservé, mais il enregistre désormais les métadonnées dans l'entité `Document`.
