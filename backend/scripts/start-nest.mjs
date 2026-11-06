// Lancement du backend recette en mode développement (compile + éventuel watch).
//
// Charge l'environnement de recette (commun avec `start:recette`) puis délègue
// à la CLI NestJS (`nest start`, éventuellement `--watch`). Assure un cycle de
// vie propre sous Windows : à l'arrêt, l'arbre de processus est terminé
// (taskkill /T) pour ne laisser aucun orphelin sur le port 3001. Si le port est
// déjà occupé, une instance résiduelle du projet est récupérée proprement ou un
// arrêt explicite est levé pour toute autre application.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { loadRecatteEnv, recetteFail } from './load-recatte-env.mjs'
import {
  findPortListener,
  isProjectBackend,
  killTree,
} from './process-utils.mjs'

loadRecatteEnv()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const backendDir = path.join(__dirname, '..')
const nestCli = path.join(backendDir, 'node_modules', '@nestjs', 'cli', 'bin', 'nest.js')
// Isolation de la recette : la compilation (même en mode watch) s'effectue
// exclusivement dans `dist-recette` via `tsconfig.recette.json`. Elle ne touche
// JAMAIS `dist` qui sert au backend habituel (`npm run start:dev`).
// Chemin RELATIF au répertoire du projet (cwd du process Nest).
const recetteTsconfig = 'tsconfig.recette.json'
const port = Number(process.env.PORT ?? 3001)

if (!existsSync(nestCli)) {
  recetteFail(`CLI NestJS introuvable : « ${nestCli} ».`)
}

if (!existsSync(recetteTsconfig)) {
  recetteFail(
    `tsconfig de recette introuvable : « ${recetteTsconfig} ». La recette exige une compilation isolée.`,
  )
}

// Pré-contrôle du port : signaler clairement toute occupation, sans jamais
// tuer une instance active (qu'elle appartienne au projet ou à un tiers).
const listener = findPortListener(port)
if (listener) {
  const kind = isProjectBackend(listener.commandLine, backendDir)
    ? 'une instance du backend de ce projet'
    : 'un autre processus'
  recetteFail(
    `le port ${port} est déjà occupé par ${kind} (PID ${listener.pid}). Arrêtez cette instance avant de relancer la recette.`,
  )
}

const args = ['start', '-p', recetteTsconfig, ...process.argv.slice(2)]
const child = spawn(process.execPath, [nestCli, ...args], {
  cwd: backendDir,
  env: process.env,
  stdio: 'inherit',
  windowsHide: true,
})

let shuttingDown = false
const shutdown = () => {
  if (shuttingDown) return
  shuttingDown = true
  if (child.pid) killTree(child.pid)
  // Laisse un court délai à taskkill puis termine ce lanceur.
  setTimeout(() => process.exit(0), 400)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

child.on('exit', (code, signal) => {
  if (shuttingDown) return
  // Si la CLI NestJS s'arrête d'elle-même (ex. erreur de compilation), nettoie
  // aussi les éventuels enfants avant de propager le code.
  if (child.pid) killTree(child.pid)
  process.exit(code ?? (signal ? 1 : 0))
})

child.on('error', (error) => {
  recetteFail(`impossible de lancer la CLI NestJS : ${error.message}`)
})
