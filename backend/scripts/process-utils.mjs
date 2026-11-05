// Utilitaires de cycle de vie des processus (Windows principalement).
//
// Permet d'identifier le processus qui écoute sur un port, de vérifier s'il
// s'agit d'une instance du backend du projet et d'arrêter proprement un arbre
// de processus (évite les orphelins qui conservent le port 3001 après l'arrêt
// du parent).
import { execFileSync } from 'node:child_process'
import process from 'node:process'

const IS_WINDOWS = process.platform === 'win32'

function run(args, options = {}) {
  try {
    return execFileSync(args[0], args.slice(1), {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      ...options,
    })
  } catch {
    return ''
  }
}

/**
 * Retourne `{ pid, commandLine }` du premier processus écoutant `port`, ou
 * `null` si le port est libre. Couvre IPv4 (0.0.0.0, 127.0.0.1) et IPv6 ([::]).
 *
 * Sur Windows, `netstat` peut omettre l'écoute IPv6 `[::]` ; on utilise donc
 * `Get-NetTCPConnection` (fiable) pour identifier le PID.
 */
export function findPortListener(port) {
  if (!IS_WINDOWS) {
    const out = run(['sh', '-c', `netstat -tlnp 2>/dev/null | grep ':${port} ' | head -1`])
    const match = out.match(/LISTEN\s+(\d+)\//)
    return match ? { pid: Number(match[1]), commandLine: '' } : null
  }

  const pidOut = run([
    'powershell',
    '-NoProfile',
    '-Command',
    `Get-NetTCPConnection -LocalPort ${port} -ErrorAction SilentlyContinue | Where-Object { $_.RemotePort -eq 0 } | Select-Object -First 1 -ExpandProperty OwningProcess`,
  ])
  const pid = Number(pidOut.trim())
  if (!Number.isInteger(pid) || pid <= 0) return null

  const commandLine = run([
    'powershell',
    '-NoProfile',
    '-Command',
    `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
  ]).trim()

  return { pid, commandLine }
}

/**
 * Indique si la ligne de commande correspond à une instance du backend de ce
 * projet (application compilée `dist/main` sous le dossier backend).
 */
export function isProjectBackend(commandLine, backendDir) {
  const normalizedCmd = String(commandLine ?? '').toLowerCase().replace(/\\/g, '/')
  const normalizedDir = String(backendDir ?? '').toLowerCase().replace(/\\/g, '/')
  return (
    normalizedCmd.includes('dist/main') &&
    normalizedCmd.includes(normalizedDir)
  )
}

/**
 * Arrête l'arbre de processus racine `pid`. Sur Windows, utilise
 * `taskkill /T /F` pour tuer aussi les enfants (compilation watch + app).
 */
export function killTree(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return
  if (IS_WINDOWS) {
    run(['taskkill', '/PID', String(pid), '/T', '/F'])
    return
  }
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {
      /* déjà arrêté */
    }
  }
}

/**
 * Attend que `port` soit libre (polling), jusqu'à `timeoutMs`.
 */
export async function waitPortFree(port, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!findPortListener(port)) return true
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return !findPortListener(port)
}
