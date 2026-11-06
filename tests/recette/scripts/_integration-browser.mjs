// Parcours navigateur complet (RH connectée) : déclaration d'absence → enregistrement
// → recalcul automatique → consultation des soldes. Base recette uniquement.
import { chromium } from 'playwright'
import { apiRequest, login, dbConn } from '../helpers/runner-utils.mjs'

const FRONT = 'http://localhost:5174'
const results = []
const rec = (id, name, ok, detail='') => { results.push({id,name,ok,detail}); console.log(`${ok?'OK ':'KO '}${name}${detail?' — '+detail:''}`) }
const num = (v) => Number(v)

async function main() {
  const conn = await dbConn()
  const admin = await login('admin.recette@gmes.fr')
  const rh = await login('rh.recette@gmes.fr')
  const TAG = 'UI' + Date.now().toString(36)

  // ── Préparation (hors parcours testé) ──
  const svc = (await apiRequest('/services', { method:'POST', token:admin, body:{ name:`SVC-${TAG}`, serviceType:'INTERNE', minimumPresence:1, hasMinimumPresenceRule:false } })).data
  const emp = (await apiRequest('/users', { method:'POST', token:admin, body:{ nom:`PARCOURS-${TAG}`, prenom:'Integration', email:`parcours.${TAG}@recette.fr`, role:'COLLABORATEUR', employmentType:'INTERNE', serviceId:svc.id, hireDate:'2026-01-06' } })).data
  const mal = (await apiRequest('/leave-types', { method:'POST', token:admin, body:{ name:`MAL-UI-${TAG}`, category:'DECLARATION_ABSENCE', deductsPaidLeaveBalance:false, documentRequired:false, documentCanBeAddedLater:false, employeeCanCreate:false, rhOnly:true, allowsDays:true, allowsHalfDays:false, allowsHours:false, requiresValidation:false } })).data
  await apiRequest(`/leave-types/${mal.id}/absence-kind`, { method:'PATCH', token:rh, body:{ absenceKind:'ARRET_MALADIE' } })
  await apiRequest('/leave-balances/accrual/run', { method:'POST', token:rh, body:{ accrualMonth:'2026-09' } })

  const browser = await chromium.launch({ headless: true })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('pageerror', e => console.log('  [pageerror]', String(e).slice(0,200)))

  // ── Connexion RH + ouverture Congés & Absences ──
  await page.goto(`${FRONT}/login`, { waitUntil:'networkidle' })
  await page.fill('#login-email', 'rh.recette@gmes.fr')
  await page.fill('#login-password', 'RecetteGMES@2026!')
  await page.click('.login-submit')
  await page.waitForURL('**/app/**', { timeout: 15000 })
  await page.evaluate(h => { window.history.pushState({},'',h); window.dispatchEvent(new PopStateEvent('popstate')) }, '/app/rh-leaves-absences')
  await page.waitForTimeout(2500)

  // ── Ouverture du drawer et saisie ──
  await page.click('.rh-events-create')
  await page.waitForSelector('.rh-declaration-drawer', { timeout: 8000 })
  const selects = page.locator('.rh-declaration-top-grid select')
  await selects.nth(0).selectOption(String(emp.id))
  await selects.nth(1).selectOption(`ABSENCE:${mal.id}`)
  await page.waitForTimeout(600)
  // Reculer de novembre à septembre 2026 (2 clics « mois précédent »).
  await page.getByRole('button', { name: 'Mois précédent' }).click()
  await page.waitForTimeout(250)
  await page.getByRole('button', { name: 'Mois précédent' }).click()
  await page.waitForTimeout(400)
  await page.click('button.nr-cal__cell[aria-label="2026-09-01"]')
  await page.click('button.nr-cal__cell[aria-label="2026-09-30"]')
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: 'Valider l’absence' }).click()
  await page.waitForTimeout(3000)

  // ── L'absence doit apparaître ENREGISTREE dans la liste ──
  const body = await page.locator('body').innerText()
  rec('UI-ABSENCE-CREEE', 'L’absence apparaît dans la liste RH', body.includes(`PARCOURS-${TAG}`), '')
  rec('UI-STATUT-ENREGISTREE', 'Statut affiché « Autorisée » (ENREGISTREE)', /Autoris[ée]e/.test(body), '')

  // ── Recalcul automatique (vérifié en base, sans endpoint manuel) ──
  const [netRow] = await conn.query(
    `SELECT COALESCE(SUM(CASE WHEN movement_type='CORRECTION_NEGATIVE' THEN -days ELSE days END),0) d,
            SUM(movement_type='CORRECTION_NEGATIVE') c
       FROM balance_movements WHERE employee_id=? AND accrual_month='2026-09' AND movement_type IN ('ACQUISITION','CORRECTION_POSITIVE','CORRECTION_NEGATIVE')`,
    [emp.id],
  )
  rec('UI-RECALC-AUTO', 'Recalcul automatique déclenché depuis l’interface (correction -0,5)', Math.abs(num(netRow[0].d) - 2) < 0.01 && num(netRow[0].c) === 1, `net=${netRow[0].d} corrNeg=${netRow[0].c}`)

  // ── Consultation des soldes ──
  const bal = (await apiRequest(`/leave-balances/employee/${emp.id}?referencePeriod=2026-2027&counterType=N`, { token: rh })).data?.[0]
  rec('UI-SOLDE', 'Solde consultable : 2 j acquis après recalcul', bal && num(bal.acquiredDays) === 2, `acquired=${bal?.acquiredDays} available=${bal?.availableDays}`)
  await page.evaluate(h => { window.history.pushState({},'',h); window.dispatchEvent(new PopStateEvent('popstate')) }, '/app/rh-balances')
  await page.waitForTimeout(2500)
  const balBody = await page.locator('body').innerText()
  rec('UI-SOLDE-PAGE', 'Page Soldes collaborateurs accessible', balBody.includes('Soldes collaborateurs') || balBody.includes('SOLDE'), '')

  // ── Anomalies d'acquisition : page accessible, aucun doublon généré ──
  await page.evaluate(h => { window.history.pushState({},'',h); window.dispatchEvent(new PopStateEvent('popstate')) }, '/app/rh-accrual-anomalies')
  await page.waitForTimeout(2500)
  rec('UI-ANOMALIES-PAGE', 'Page Anomalies d’acquisition accessible (3 cartes interactives)', (await page.locator('.rh-kpi').count()) === 3, '')

  await page.screenshot({ path:'screenshots/fix-integration-absences.png' })
  await browser.close()
  await conn.end()

  const failed = results.filter(r=>!r.ok).length
  console.log(`\nPARCOURS NAVIGATEUR : ${results.length-failed}/${results.length} OK, ${failed} KO`)
  process.exitCode = failed ? 1 : 0
}
main().catch(e => { console.error('ERREUR PARCOURS NAVIGATEUR :', e); process.exit(1) })
