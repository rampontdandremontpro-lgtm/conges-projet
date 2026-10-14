// Retest : page "Nouvelle demande" laissée ouverte pendant le changement de
// période (31/05/2027 23:59 → 01/06/2027 00:00, heure Martinique).
// L'horloge du navigateur est simulée via page.clock (Playwright), sans
// toucher à l'horloge du système.
import { apiRequest, login, launch, capture } from '../helpers/runner-utils.mjs'
import { signAccessToken } from '../helpers/tokens.mjs'
import { config } from '../helpers/config.mjs'

const TAG = 'LIMPO' + Date.now().toString(36)

// 1. Fixtures via l'API réelle.
const admin = await login('admin.recette@gmes.fr')
const leaveType = (await apiRequest('/leave-types', {
  method: 'POST',
  token: admin,
  body: {
    name: 'CP ' + TAG,
    category: 'DEMANDE_CONGE',
    deductsPaidLeaveBalance: false,
    documentRequired: false,
    documentCanBeAddedLater: false,
    employeeCanCreate: true,
    rhOnly: false,
    allowsDays: true,
    allowsHalfDays: false,
    allowsHours: false,
    requiresValidation: true,
  },
})).data
const service = (await apiRequest('/services', {
  method: 'POST',
  token: admin,
  body: {
    name: 'SVC-' + TAG,
    serviceType: 'INTERNE',
    minimumPresence: 1,
    hasMinimumPresenceRule: false,
  },
})).data
const collaborator = (await apiRequest('/users', {
  method: 'POST',
  token: admin,
  body: {
    nom: 'LIMPO',
    prenom: 'Col',
    email: `limpo.col.${TAG}@recette.fr`,
    password: 'RecetteGMES@2026!',
    role: 'COLLABORATEUR',
    employmentType: 'INTERNE',
    serviceId: service.id,
    hireDate: '2026-01-06',
  },
})).data
void signAccessToken

const browser = await launch()
const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })

// 2. Horloge simulée : 31/05/2027 23:59 en Martinique (UTC−4) = 01/06/2027 03:59 UTC.
await page.clock.install({ time: new Date('2027-06-01T03:59:00.000Z') })

await page.goto(`${config.FRONTEND_URL}/login`, { waitUntil: 'networkidle' })
await page.fill('#login-email', collaborator.email)
await page.fill('#login-password', 'RecetteGMES@2026!')
await page.click('.login-submit')
await page.waitForURL('**/app/**', { timeout: 15000 })

const link = page.locator('a[href="/app/new-request"]').first()
await link.waitFor({ state: 'visible', timeout: 10000 })
await link.click()
await page.waitForURL('**/app/new-request', { timeout: 10000 })

await page.waitForSelector('.nr-cal__limit-note', { timeout: 15000 })
const noteBefore = (await page.locator('.nr-cal__limit-note').innerText()).trim()
await capture(page, 'CAP-LIMITE-avant-bascule.png')

// 3. Avance de 2 minutes réelles simulées : on franchit minuit Martinique
//    (01/06/2027) et on dépasse le tick de rafraîchissement (60 s).
await page.clock.fastForward(2 * 60 * 1000)
await page.waitForTimeout(500)

const noteAfter = (await page.locator('.nr-cal__limit-note').innerText()).trim()
await capture(page, 'CAP-LIMITE-apres-bascule.png')

const okBefore = noteBefore.includes('31/05/2028')
const okAfter = noteAfter.includes('31/05/2029')

console.log('Note avant bascule :', noteBefore)
console.log('Note après bascule :', noteAfter)
console.log('')
console.log('=== RÉSUMÉ page laissée ouverte ===')
console.log(`Avant : ${okBefore ? 'CONFORME (31/05/2028)' : 'ÉCHEC'}`)
console.log(`Après : ${okAfter ? 'CONFORME (31/05/2029)' : 'ÉCHEC'}`)
console.log(`Total: 2, Conforme: ${(okBefore ? 1 : 0) + (okAfter ? 1 : 0)}, Non conforme: ${(okBefore ? 0 : 1) + (okAfter ? 0 : 1)}`)

await browser.close()
process.exit(okBefore && okAfter ? 0 : 1)
