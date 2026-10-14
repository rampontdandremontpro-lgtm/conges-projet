// Tests de sécurité de l'ancien endpoint PATCH /derogations/:id/decision.
// Vérifie qu'il ne permet pas de contourner les quatre circuits GMES validés.

import { apiRequest, login } from '../helpers/runner-utils.mjs'
import { signAccessToken } from '../helpers/tokens.mjs'

const TAG = 'DERDEC' + Date.now().toString(36)
const out = {}

function isoAddDays(iso, days) {
  const d = new Date(`${iso}T00:00:00.000Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
function todayIso() { return new Date().toISOString().slice(0, 10) }
function weekday(iso) { return new Date(`${iso}T00:00:00.000Z`).getUTCDay() }
function nextWeekday(off) {
  let s = isoAddDays(todayIso(), off)
  for (let i = 0; i < 40; i++) {
    if (weekday(s) >= 1 && weekday(s) <= 5) return s
    s = isoAddDays(s, 1)
  }
  return s
}
let dateCursor = isoAddDays(todayIso(), 5)
function nextDate() {
  for (let i = 0; i < 40; i++) {
    const wd = weekday(dateCursor)
    if (wd >= 1 && wd <= 5) break
    dateCursor = isoAddDays(dateCursor, 1)
  }
  const d = dateCursor
  dateCursor = isoAddDays(dateCursor, 1)
  return d
}

async function decide(token, id, decision) {
  return apiRequest(`/derogations/${id}/decision`, {
    method: 'PATCH',
    token,
    body: { decision, decisionComment: 'test secu' },
  })
}

async function main() {
  const admin = await login('admin.recette@gmes.fr')
  const rh = await login('rh.recette@gmes.fr')
  const dir = await login('directeur.recette@gmes.fr')
  const resp = await login('responsable.recette@gmes.fr')

  const svc = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: `DERDEC-SANS-${TAG}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
  const col = (await apiRequest('/users', { method: 'POST', token: admin, body: { nom: 'DERDECCOL', prenom: 'Test', email: `derdec.col.${TAG}@recette.fr`, role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId: svc.id, hireDate: '2026-01-06' } })).data
  const colToken = signAccessToken({ id: col.id, email: col.email, role: 'COLLABORATEUR' })
  const type = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: `CP DERDEC ${TAG}`, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: false, allowsHours: false, requiresValidation: true } })).data

  async function newRequestWithDerogation() {
    const d = nextDate()
    const req = (await apiRequest('/leave-requests', { method: 'POST', token: colToken, body: { leaveTypeId: type.id, startDate: d, endDate: d, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })).data
    const der = (await apiRequest('/derogations', { method: 'POST', token: colToken, body: { leaveRequestId: req.id, reason: 'secu test' } })).data
    return { req, der }
  }

  // ===== 1. Demande SOUMISE (EN_ATTENTE_VALIDATION) : endpoint bloqué =====
  {
    const { req, der } = await newRequestWithDerogation()
    const sub = await apiRequest(`/leave-requests/${req.id}/submit`, { method: 'POST', token: colToken, body: { signatureType: 'INITIALS', signatureData: 'CO' } })
    if (sub.status !== 200) throw new Error('submit soumise -> ' + sub.status + ' ' + JSON.stringify(sub.data))

    const rhTry = await decide(rh, der.id, 'ACCORDER')
    const dirTry = await decide(dir, der.id, 'ACCORDER')
    const respTry = await decide(resp, der.id, 'ACCORDER')
    const colTry = await decide(colToken, der.id, 'ACCORDER')
    const lr = (await apiRequest(`/leave-requests/${req.id}`, { token: colToken })).data

    out['soumise'] = {
      rhHttp: rhTry.status,
      dirHttp: dirTry.status,
      respHttp: respTry.status,
      colHttp: colTry.status,
      leaveRequestStatus: lr.status,
    }
  }

  // ===== 2. Demande VALIDEE par le circuit normal : endpoint bloqué =====
  {
    const { req, der } = await newRequestWithDerogation()
    const sub = await apiRequest(`/leave-requests/${req.id}/submit`, { method: 'POST', token: colToken, body: { signatureType: 'INITIALS', signatureData: 'CO' } })
    if (sub.status !== 200) throw new Error('submit validee -> ' + sub.status + ' ' + JSON.stringify(sub.data))
    await apiRequest(`/leave-requests/${req.id}/validate`, { method: 'POST', token: rh, body: { signatureType: 'INITIALS', signatureData: 'RH' } })
    await apiRequest(`/leave-requests/${req.id}/validate`, { method: 'POST', token: dir, body: { signatureType: 'INITIALS', signatureData: 'DR' } })

    const rhTry = await decide(rh, der.id, 'ACCORDER')
    const dirTry = await decide(dir, der.id, 'ACCORDER')
    const lr = (await apiRequest(`/leave-requests/${req.id}`, { token: colToken })).data

    out['validee'] = { rhHttp: rhTry.status, dirHttp: dirTry.status, leaveRequestStatus: lr.status }
  }

  // ===== 3. Demande REFUSEE par le circuit normal : endpoint bloqué =====
  {
    const { req, der } = await newRequestWithDerogation()
    const sub = await apiRequest(`/leave-requests/${req.id}/submit`, { method: 'POST', token: colToken, body: { signatureType: 'INITIALS', signatureData: 'CO' } })
    if (sub.status !== 200) throw new Error('submit refusee -> ' + sub.status + ' ' + JSON.stringify(sub.data))
    await apiRequest(`/leave-requests/${req.id}/refuse`, { method: 'POST', token: rh, body: { comment: 'refus RH' } })

    const rhTry = await decide(rh, der.id, 'ACCORDER')
    const dirTry = await decide(dir, der.id, 'REFUSER')
    const lr = (await apiRequest(`/leave-requests/${req.id}`, { token: colToken })).data

    out['refusee'] = { rhHttp: rhTry.status, dirHttp: dirTry.status, leaveRequestStatus: lr.status }
  }

  // ===== 4. Brouillon : l'ancien endpoint est neutralisé, la soumission reste possible =====
  {
    const { req, der } = await newRequestWithDerogation()
    const rhTryDraft = await decide(rh, der.id, 'ACCORDER')
    const dirTryDraft = await decide(dir, der.id, 'ACCORDER')
    const derAfter = (await apiRequest(`/derogations/${der.id}`, { token: colToken })).data
    // Après ces tentatives, la soumission normale du collaborateur doit réussir.
    const sub = await apiRequest(`/leave-requests/${req.id}/submit`, { method: 'POST', token: colToken, body: { signatureType: 'INITIALS', signatureData: 'CO' } })
    const lr = (await apiRequest(`/leave-requests/${req.id}`, { token: colToken })).data
    out['brouillon'] = {
      rhHttp: rhTryDraft.status,
      dirHttp: dirTryDraft.status,
      derogationStatusAfterAttempts: derAfter.status,
      submitHttp: sub.status,
      leaveRequestStatus: lr.status,
    }
  }

  console.log(JSON.stringify(out, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
