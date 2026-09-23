import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
execFileSync(
  process.execPath,
  [path.join(__dirname, 'modules/auth/run-auth.mjs'), '--mode', 'ui'],
  { stdio: 'inherit' },
)
