import jwt from 'jsonwebtoken'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from './config.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ACCOUNTS_PATH = path.resolve(__dirname, '../fixtures/accounts.json')

export function loadAccounts() {
  const raw = readFileSync(ACCOUNTS_PATH, 'utf8')
  return JSON.parse(raw).accounts
}

export function signAccessToken(account) {
  return jwt.sign(
    {
      sub: account.id,
      email: account.email,
      role: account.role,
      purpose: 'access',
    },
    config.JWT_SECRET,
    { expiresIn: '1h' },
  )
}

export function tokensForAllRoles() {
  return loadAccounts().map((account) => ({
    ...account,
    token: signAccessToken(account),
  }))
}
