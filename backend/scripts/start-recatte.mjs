// Lancement du backend recette compilé (npm run start:recette).
//
// Réutilise le chargeur commun `load-recatte-env.mjs` (validation + export des
// valeurs dans process.env) puis importe `dist/main.js`. Aucun repli vers la
// base réelle n'est possible. Si le port est déjà occupé par une ancienne
// instance de CE projet, elle est récupérée proprement avant le lancement.
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { loadRecatteEnv, recetteFail } from './load-recatte-env.mjs'
import {
  findPortListener,
  isProjectBackend,
} from './process-utils.mjs'

loadRecatteEnv()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const backendDir = path.join(__dirname, '..')
// Isolation de la recette : le backend recette s'exécute depuis `dist-recette`
// (compilé par `npm run build:recette`), jamais depuis `dist` qui sert au
// backend habituel sur la base réelle.
const distMain = path.join(backendDir, 'dist-recette', 'main.js')
const port = Number(process.env.PORT ?? 3001)

if (!existsSync(distMain)) {
  recetteFail(
    `backend recette non compilé : « ${distMain} » introuvable. Lancez d'abord la compilation isolée (npm run build:recette).`,
  )
}

// Pré-contrôle du port : signaler clairement toute occupation, sans jamais
// tuer une instance active.
const listener = findPortListener(port)
if (listener) {
  const kind = isProjectBackend(listener.commandLine, backendDir)
    ? 'une instance du backend de ce projet'
    : 'un autre processus'
  recetteFail(
    `le port ${port} est déjà occupé par ${kind} (PID ${listener.pid}). Arrêtez cette instance avant de relancer la recette.`,
  )
}

// Sur Windows, import() exige une URL file:// et non un chemin brut (C:\\…).
await import(pathToFileURL(distMain).href)
