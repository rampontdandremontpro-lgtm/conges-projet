# GMES — Frontend

Interface React de gestion des congés et des absences GMES.

## Commandes

```bash
npm run dev      # serveur de développement (http://localhost:5173)
npm run build    # build de production
npm run lint     # eslint
npm run preview  # prévisualisation du build
```

Le serveur de développement proxifie `/api` vers `http://localhost:3000`.

## Structure actuelle

- `src/app` — routeur principal ;
- `src/auth` — protection des routes et contrôle des rôles ;
- `src/components/collab` — composants métier Collaborateur ;
- `src/components/layout` — sidebar, header, cloche et menus ;
- `src/components/ui` — composants UI partagés ;
- `src/config` — navigation, métadonnées et configuration ;
- `src/hooks` — hooks réutilisables ;
- `src/layouts` — layout applicatif ;
- `src/pages/auth` — connexion ;
- `src/pages/collab` — écrans Collaborateur ;
- `src/pages/shared` — écrans partagés et prévisualisations ;
- `src/services` — couche d'accès API ;
- `src/styles` — design tokens, styles globaux et styles par écran ;
- `src/utils` — règles de présentation et utilitaires frontend.

## Espace Collaborateur

Routes fonctionnelles :

```text
/app/dashboard
/app/new-request
/app/new-request/:id
/app/my-requests
/app/my-requests/:source/:id
/app/declare-absence
/app/declare-absence/:id
/app/my-documents
/app/history
/app/notifications
/app/profile
/app/settings
```

Évolutions déjà intégrées :

- `Mes justificatifs` et `Documents PDF` sont regroupés dans `Mes documents` ;
- `Mes soldes` est remplacé dans la sidebar par `Historique` ;
- l'ancienne `BalancesPage.jsx` et ses composants/styles dédiés ont été supprimés ;
- le Tableau de bord reste la vue du solde courant ;
- l'Historique affiche les vrais mouvements de solde ;
- les demandes, absences, documents et notifications utilisent les données du backend ;
- les demandes en attente peuvent produire un récapitulatif PDF provisoire non officiel ;
- `Mon profil` affiche les données réelles du compte et du service en lecture seule ;
- `Paramètres` permet d'enregistrer/supprimer une signature personnelle et de modifier le mot de passe local ;
- une signature enregistrée peut être réutilisée depuis la fenêtre de signature d'une nouvelle demande.

Compatibilité des anciennes URL :

```text
/app/my-balances      -> /app/history
/app/my-justificatifs -> /app/my-documents
/app/documents        -> /app/my-documents
```

<!-- Les espaces Responsable de service, RH, Directeur et Admin sont déclarés dans la navigation et seront implémentés progressivement. -->
