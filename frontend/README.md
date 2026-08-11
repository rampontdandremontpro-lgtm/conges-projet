# GMES — Frontend

Interface de gestion des congés et des absences (GMES).

## Commandes

```bash
npm run dev      # serveur de développement (http://localhost:5173)
npm run build    # build de production
npm run lint     # eslint
npm run preview  # prévisualisation du build
```

## Structure

- `src/app` — racine applicative et routeur
- `src/components` — composants réutilisables (layout, ui)
- `src/config` — configuration (API, navigation par rôle)
- `src/layouts` — layouts applicatifs
- `src/pages` — pages
- `src/services` — couche d'accès API
- `src/styles` — design tokens et styles globaux

Le serveur de développement proxifie `/api` vers `http://localhost:3000`.
