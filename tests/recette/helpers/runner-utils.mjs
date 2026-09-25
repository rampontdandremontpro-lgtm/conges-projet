import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright'
import mysql from 'mysql2/promise'

import { apiRequest } from './api.mjs'
import { config } from './config.mjs'
import { STATUS } from './report.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const PREUVES_DIR = path.resolve(__dirname, '../preuves')

export { apiRequest, config, STATUS }

export function ensurePreuves() {
  mkdirSync(PREUVES_DIR, { recursive: true })
}

export function makeResult(module) {
  return function result({ id, priority, scenario, type, status, resultText, proof = '', error = '', comment = '', duration }) {
    return {
      id,
      priority,
      module,
      scenario,
      type,
      status,
      result: resultText,
      date: new Date().toISOString(),
      duration: `${duration ?? 0} ms`,
      proof,
      error,
      comment,
    }
  }
}

export async function login(email, password = 'RecetteGMES@2026!') {
  const r = await apiRequest('/auth/login', { method: 'POST', body: { email, password } })
  return r.data?.accessToken
}

export async function loginPage(browser, email, password = 'RecetteGMES@2026!') {
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
  await page.goto(`${config.FRONTEND_URL}/login`, { waitUntil: 'networkidle' })
  await page.fill('#login-email', email)
  await page.fill('#login-password', password)
  await page.click('.login-submit')
  await page.waitForURL('**/app/**', { timeout: 10000 })
  return page
}

export async function capture(page, fileName) {
  const filePath = path.join(PREUVES_DIR, fileName)
  await page.screenshot({ path: filePath, fullPage: true })
  return fileName
}

export function dbConn() {
  return mysql.createConnection({
    host: 'localhost',
    port: 3306,
    user: 'root',
    password: 'root',
    database: 'gestion_conges_gmes_test',
  })
}

export async function launch() {
  return chromium.launch({ headless: true })
}

export function isoAddDays(iso, days) {
  const d = new Date(`${iso}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function utcWeekday(iso) {
  return new Date(`${iso}T00:00:00.000Z`).getUTCDay()
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

export function frenchRange(startIso, endIso) {
  const [sy, sm, sd] = startIso.split('-')
  const [ey, em, ed] = endIso.split('-')
  return `${sd}/${sm}/${sy} → ${ed}/${em}/${ey}`
}

export async function navigateViaSidebar(page, href) {
  const link = page.locator(`a[href="${href}"]`).first()
  await link.waitFor({ state: 'visible', timeout: 10000 })
  await link.click()
  await page.waitForURL(`**${href}`, { timeout: 10000 })
}

export async function openDraftCard(page, hasText) {
  await page.waitForSelector('.my-request-card', { timeout: 10000 })
  const card = page.locator('.my-request-card', { hasText }).first()
  await card.click()
  await page.waitForURL('**/new-request/**', { timeout: 10000 })
}
