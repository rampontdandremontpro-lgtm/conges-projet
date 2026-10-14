// Retest des PDF de congés validés et récapitulatifs.
// - Génération réelle via API, extraction du texte et rendu visuel (Playwright).
// - Base : gestion_conges_gmes_test (backend 3001).

import zlib from 'node:zlib'
import { writeFileSync } from 'node:fs'
import path from 'node:path'

import { apiRequest, login, loginPage, ensurePreuves, launch, todayIso, isoAddDays, dbConn } from '../helpers/runner-utils.mjs'
import { signAccessToken } from '../helpers/tokens.mjs'

const TAG = 'PDF' + Date.now().toString(36)
const PREUVES = path.resolve('tests/recette/preuves')
const out = {}

function weekday(iso) { return new Date(`${iso}T00:00:00.000Z`).getUTCDay() }
function advanceToWeekday(iso) {
  let d = iso
  for (let i = 0; i < 7; i++) {
    const wd = weekday(d)
    if (wd >= 1 && wd <= 5) return d
    d = isoAddDays(d, 1)
  }
  return d
}

function decodePdfLiteral(s) {
  let out = ''
  for (let i = 0; i < s.length; i++) {
    const c = s[i]
    if (c === '\\') {
      const n = s[i + 1]
      if (n === 'n') { out += ' '; i++ }
      else if (n === 'r') { out += ' '; i++ }
      else if (n === '(' || n === ')' || n === '\\') { out += n; i++ }
      else if (/[0-7]/.test(n)) {
        let oct = ''
        let j = 0
        while (j < 3 && /[0-7]/.test(s[i + 1 + j])) { oct += s[i + 1 + j]; j++ }
        out += String.fromCharCode(parseInt(oct, 8))
        i += j
      } else { out += n; i++ }
    } else {
      out += c
    }
  }
  return out
}

function decodePdfHex(hex) {
  try {
    return Buffer.from(hex, 'hex').toString('latin1')
  } catch {
    return ''
  }
}

function extractPdfText(buffer) {
  const raw = buffer.toString('latin1')
  const chunks = []
  const streamRe = /stream\r?\n([\s\S]*?)endstream/g
  let m
  while ((m = streamRe.exec(raw))) {
    let content = m[1].replace(/\r?\n$/, '')
    try {
      content = zlib.inflateSync(Buffer.from(content, 'latin1')).toString('latin1')
    } catch {
      /* non compressé */
    }
    if (content.length > 100000) continue

    const strRe = /\((?:[^()\\]|\\.)*\)|<[0-9A-Fa-f]+>/g
    let sm
    while ((sm = strRe.exec(content))) {
      const tok = sm[0]
      chunks.push(
        tok.startsWith('(')
          ? decodePdfLiteral(tok.slice(1, -1))
          : decodePdfHex(tok.slice(1, -1)),
      )
    }
  }
  return chunks.join('')
}

async function downloadPdf(path, token) {
  const res = await fetch(`http://localhost:3001/api${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  const buffer = Buffer.from(await res.arrayBuffer())
  return { status: res.status, buffer }
}

async function main() {
  ensurePreuves()
  const admin = await login('admin.recette@gmes.fr')
  const rh = await login('rh.recette@gmes.fr')
  const dir = await login('directeur.recette@gmes.fr')
  const resp = await login('responsable.recette@gmes.fr')
  const respId = (await apiRequest('/users/me', { token: resp })).data.id

  const fullType = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: `CP ${TAG}`, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: false, allowsHours: false, requiresValidation: true } })).data
  const halfType = (await apiRequest('/leave-types', { method: 'POST', token: admin, body: { name: `CP HALF ${TAG}`, category: 'DEMANDE_CONGE', deductsPaidLeaveBalance: false, documentRequired: false, documentCanBeAddedLater: false, employeeCanCreate: true, rhOnly: false, allowsDays: true, allowsHalfDays: true, allowsHours: false, requiresValidation: true } })).data

  const svcSans = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: `SANS-${TAG}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
  const svcAvec = (await apiRequest('/services', { method: 'POST', token: admin, body: { name: `AVEC-${TAG}`, serviceType: 'INTERNE', minimumPresence: 1, hasMinimumPresenceRule: false } })).data
  await apiRequest(`/users/${respId}`, { method: 'PATCH', token: admin, body: { serviceId: svcAvec.id } })
  await apiRequest(`/services/${svcAvec.id}`, { method: 'PATCH', token: admin, body: { primaryManagerId: respId, validationMode: 'RESPONSABLE_PUIS_RELAIS', takeoverDelayDays: 7 } })

  const mkCol = async (suffix, svcId) => {
    const u = (await apiRequest('/users', { method: 'POST', token: admin, body: { nom: 'PDF', prenom: suffix, email: `pdf.${suffix.toLowerCase()}.${TAG}@recette.fr`, role: 'COLLABORATEUR', employmentType: 'INTERNE', serviceId: svcId, hireDate: '2026-01-06' } })).data
    return { ...u, token: signAccessToken({ id: u.id, email: u.email, role: 'COLLABORATEUR' }) }
  }
  const colSans = await mkCol('Sans', svcSans.id)
  const colAvec = await mkCol('Avec', svcAvec.id)

  function drawnPng() {
    // PNG 1x1 valide (transparent).
    return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
  }

  // ===== Circuit 1 (sans responsable) : RH -> Directeur, initiales =====
  const d1 = advanceToWeekday(isoAddDays(todayIso(), 45))
  const r1 = (await apiRequest('/leave-requests', { method: 'POST', token: colSans.token, body: { leaveTypeId: fullType.id, startDate: d1, endDate: d1, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })).data
  await apiRequest(`/leave-requests/${r1.id}/submit`, { method: 'POST', token: colSans.token, body: { signatureType: 'INITIALS', signatureData: 'CO' } })
  await apiRequest(`/leave-requests/${r1.id}/validate`, { method: 'POST', token: rh, body: { signatureType: 'INITIALS', signatureData: 'RH' } })
  await apiRequest(`/leave-requests/${r1.id}/validate`, { method: 'POST', token: dir, body: { signatureType: 'INITIALS', signatureData: 'DR' } })

  const pdf1 = await downloadPdf(`/leave-requests/${r1.id}/pdf`, colSans.token)
  writeFileSync(path.join(PREUVES, `PDF-${TAG}-circuit1.pdf`), pdf1.buffer)
  const text1 = extractPdfText(pdf1.buffer)
  out['circuit1'] = {
    http: pdf1.status,
    isPdf: pdf1.buffer.slice(0, 5).toString() === '%PDF-',
    noSolde: !text1.includes('SITUATION DU SOLDE'),
    noCadenas: !text1.includes('Document officiel généré'),
    mentionRouge: text1.includes('Le bulletin de paie fait foi'),
    deuxValidateurs: text1.includes('Première validation') && text1.includes('Validation finale'),
    hasRH: text1.includes('Ressources humaines'),
    hasDirecteur: text1.includes('Directeur'),
  }

  // ===== Circuit 4 (avec responsable, dérogation) : RH -> Responsable, dessinée =====
  const d2 = advanceToWeekday(isoAddDays(todayIso(), 3))
  const r2 = (await apiRequest('/leave-requests', { method: 'POST', token: colAvec.token, body: { leaveTypeId: halfType.id, startDate: d2, endDate: d2, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })).data
  await apiRequest(`/leave-requests/${r2.id}/submit`, { method: 'POST', token: colAvec.token, body: { signatureType: 'DRAWN', signatureData: drawnPng(), derogationReason: 'test pdf' } })
  await apiRequest(`/leave-requests/${r2.id}/validate`, { method: 'POST', token: rh, body: { signatureType: 'DRAWN', signatureData: drawnPng() } })
  await apiRequest(`/leave-requests/${r2.id}/validate`, { method: 'POST', token: resp, body: { signatureType: 'DRAWN', signatureData: drawnPng() } })

  const pdf2 = await downloadPdf(`/leave-requests/${r2.id}/pdf`, colAvec.token)
  writeFileSync(path.join(PREUVES, `PDF-${TAG}-circuit4.pdf`), pdf2.buffer)
  const text2 = extractPdfText(pdf2.buffer)
  out['circuit4'] = {
    http: pdf2.status,
    isPdf: pdf2.buffer.slice(0, 5).toString() === '%PDF-',
    aResponsable: text2.includes('Responsable de service'),
    aRH: text2.includes('Ressources humaines'),
    mentionRouge: text2.includes('Le bulletin de paie fait foi'),
  }

  // ===== Récapitulatif provisoire =====
  const d3 = advanceToWeekday(isoAddDays(todayIso(), 30))
  const r3 = (await apiRequest('/leave-requests', { method: 'POST', token: colSans.token, body: { leaveTypeId: fullType.id, startDate: d3, endDate: d3, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' } })).data
  await apiRequest(`/leave-requests/${r3.id}/submit`, { method: 'POST', token: colSans.token, body: { signatureType: 'INITIALS', signatureData: 'CO' } })

  const pdf3 = await downloadPdf(`/leave-requests/${r3.id}/pending-summary-pdf`, colSans.token)
  writeFileSync(path.join(PREUVES, `PDF-${TAG}-recap.pdf`), pdf3.buffer)
  const text3 = extractPdfText(pdf3.buffer)
  out['recap'] = {
    http: pdf3.status,
    isPdf: pdf3.buffer.slice(0, 5).toString() === '%PDF-',
    titre: text3.includes('DEMANDE EN ATTENTE DE VALIDATION'),
    nouveauTexte: text3.includes('récapitulatif provisoire fourni à titre indicatif'),
    mentionPied: text3.includes('DOCUMENT PROVISOIRE À TITRE INDICATIF'),
    bulletinFoi: text3.includes('Le bulletin de paie fait foi'),
  }

  // ===== Rendu visuel via Chromium =====
  const browser = await launch()
  const page = await browser.newPage({ viewport: { width: 1000, height: 1400 } })
  for (const [name, file] of [
    ['circuit1', `PDF-${TAG}-circuit1.pdf`],
    ['circuit4', `PDF-${TAG}-circuit4.pdf`],
    ['recap', `PDF-${TAG}-recap.pdf`],
  ]) {
    await page.goto(`file:///${path.join(PREUVES, file).replace(/\\/g, '/')}`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {})
    await page.waitForTimeout(1200)
    await page.screenshot({ path: path.join(PREUVES, `CAP-PDF-${TAG}-${name}.png`), fullPage: true })
  }
  await browser.close()

  console.log(JSON.stringify(out, null, 2))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
