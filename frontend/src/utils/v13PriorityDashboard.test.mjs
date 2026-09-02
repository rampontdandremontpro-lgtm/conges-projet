import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

import {
  compareRhEventPriority,
  getRhEventStatusOptions,
  normalizeRhLeaveAndAbsenceRows,
  rhEventStatusMatchesFilter,
} from './rhLeavesAndAbsences.js'

const read = (path) => fs.readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8')

test('filtre Statut absence masque Brouillon RH et fusionne les justificatifs attendus', () => {
  const options = getRhEventStatusOptions('ABSENCE')
  const labels = options.map(([, label]) => label)

  assert.equal(labels.includes('Brouillon RH'), false)
  assert.equal(labels.filter((label) => label === 'Justificatif attendu').length, 1)
  assert.deepEqual(options.slice(0, 3).map(([, label]) => label), [
    'À vérifier',
    'Justificatif attendu',
    'Déclarée',
  ])
})

test('filtre Justificatif attendu couvre les deux statuts techniques sans doublon', () => {
  assert.equal(rhEventStatusMatchesFilter('JUSTIFICATIF_EN_ATTENTE', 'JUSTIFICATIF_ATTENDU'), true)
  assert.equal(rhEventStatusMatchesFilter('JUSTIFICATIF_REJETE', 'JUSTIFICATIF_ATTENDU'), true)
  assert.equal(rhEventStatusMatchesFilter('A_VERIFIER_PAR_RH', 'JUSTIFICATIF_ATTENDU'), false)
})

test('congés et absences sont normalisés par priorité métier', () => {
  const rows = normalizeRhLeaveAndAbsenceRows({
    leaves: [
      { id: 1, status: 'VALIDEE', employee: {}, service: {}, leaveType: {}, startDate: '2026-09-10' },
      { id: 2, status: 'EN_ATTENTE_VALIDATION', canDecideNow: true, treatment: { kind: 'RH_FINALISATION' }, employee: {}, service: {}, leaveType: {}, startDate: '2026-09-20' },
      { id: 3, status: 'EN_ATTENTE_VALIDATION', canDecideNow: false, treatment: { kind: 'RESPONSABLE_SERVICE' }, employee: {}, service: {}, leaveType: {}, startDate: '2026-09-01' },
    ],
    absences: [
      { id: 4, status: 'ENREGISTREE', employee: {}, service: {}, leaveType: {}, startDate: '2026-09-01' },
      { id: 5, status: 'A_VERIFIER_PAR_RH', employee: {}, service: {}, leaveType: {}, startDate: '2026-09-02' },
      { id: 6, status: 'JUSTIFICATIF_REJETE', employee: {}, service: {}, leaveType: {}, startDate: '2026-09-03' },
    ],
  })

  assert.deepEqual(rows.sort(compareRhEventPriority).map((row) => row.status), [
    'READY',
    'WAITING_MANAGER',
    'A_VERIFIER_PAR_RH',
    'JUSTIFICATIF_REJETE',
    'VALIDEE',
    'ENREGISTREE',
  ])
})

test('dashboard Directeur utilise les trois cards comme navigation et supprime les deux gros boutons', () => {
  const dashboard = read('frontend/src/pages/director/DashboardPage.jsx')
  assert.doesNotMatch(dashboard, /Voir les demandes en attente/)
  assert.doesNotMatch(dashboard, /Voir la présence globale/)
  assert.match(dashboard, /actionable=1&role=RESPONSABLE_SERVICE/)
  assert.match(dashboard, /actionable=1&role=RH/)
  assert.match(dashboard, /actionable=1&role=COLLABORATEUR/)
})

test('page Directeur applique le rôle transmis par les cards en plus du périmètre actionable', () => {
  const page = read('frontend/src/pages/director/AllRequestsPage.jsx')
  assert.match(page, /searchParams\.get\('role'\)/)
  assert.match(page, /request\.employee\?\.role/)
  assert.match(page, /nextParams\.delete\('role'\)/)
})

test('page RH utilise le filtre synthétique Justificatif attendu et conserve le tri métier', () => {
  const page = read('frontend/src/pages/rh/LeavesAndAbsencesPage.jsx')
  assert.match(page, /rhEventStatusMatchesFilter/)
  assert.doesNotMatch(page, /row\.status !== filters\.status/)
})
