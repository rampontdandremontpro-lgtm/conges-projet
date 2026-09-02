import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildSelectionPeriodBadge,
  buildReferencePeriodBadge,
} from './requestPeriodBadges.js'
import {
  PRESENCE_SITUATIONS,
  memberMatchesPresenceSituation,
} from './globalPresenceSituation.js'
import {
  requestValidationStageMeta,
} from './requestValidationStage.js'
import { getRhEventStatusOptions, normalizeRhLeaveAndAbsenceRows } from './rhLeavesAndAbsences.js'

const member = { id: 7 }
const days = [
  { members: [{ id: 7, morningStatus: 'PRESENT', afternoonStatus: 'EN_VACANCES', morningPendingRequestIds: [], afternoonPendingRequestIds: [42] }] },
]

test('badge de période affiche toujours les bornes de demi-journée pour plusieurs jours', () => {
  assert.equal(buildSelectionPeriodBadge({ startDate: '2027-03-08', endDate: '2027-03-10', startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' }), 'matin → après-midi')
  assert.equal(buildSelectionPeriodBadge({ startDate: '2027-03-08', endDate: '2027-03-10', startPeriod: 'APRES_MIDI', endPeriod: 'MATIN' }), 'après-midi → matin')
  assert.equal(buildSelectionPeriodBadge({ startDate: '2027-03-08', endDate: '2027-03-10', startPeriod: 'MATIN', endPeriod: 'MATIN' }), 'matin → matin')
  assert.equal(buildSelectionPeriodBadge({ startDate: '2027-03-08', endDate: '2027-03-10', startPeriod: 'APRES_MIDI', endPeriod: 'APRES_MIDI' }), 'après-midi → après-midi')
})

test('badge de période garde les libellés journée/matin/après-midi sur une seule journée', () => {
  assert.equal(buildSelectionPeriodBadge({ startDate: '2027-07-05', endDate: '2027-07-05', startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' }), 'journée entière')
  assert.equal(buildSelectionPeriodBadge({ startDate: '2027-07-05', endDate: '2027-07-05', startPeriod: 'MATIN', endPeriod: 'MATIN' }), 'matin')
  assert.equal(buildSelectionPeriodBadge({ startDate: '2027-07-05', endDate: '2027-07-05', startPeriod: 'APRES_MIDI', endPeriod: 'APRES_MIDI' }), 'après-midi')
  assert.equal(buildReferencePeriodBadge(false), 'Période N')
  assert.equal(buildReferencePeriodBadge(true), 'Période N+1')
})

test('filtre Situation reconnaît présence, congé et attente de validation', () => {
  assert.equal(memberMatchesPresenceSituation(member, days, PRESENCE_SITUATIONS.PRESENT), true)
  assert.equal(memberMatchesPresenceSituation(member, days, PRESENCE_SITUATIONS.LEAVE), true)
  assert.equal(memberMatchesPresenceSituation(member, days, PRESENCE_SITUATIONS.PENDING), true)
  assert.equal(memberMatchesPresenceSituation(member, days, PRESENCE_SITUATIONS.ABSENCE), false)
})

test('étape de validation dépend du droit réel de traitement de l’utilisateur connecté', () => {
  assert.deepEqual(requestValidationStageMeta({ status: 'EN_ATTENTE_VALIDATION', canDecideNow: false, treatment: { kind: 'RESPONSABLE_SERVICE' } }), { key: 'WAITING_MANAGER', label: 'Attente responsable', tone: 'pending' })
  assert.deepEqual(requestValidationStageMeta({ status: 'EN_ATTENTE_VALIDATION', canDecideNow: false, treatment: { kind: 'VALIDATEUR_TEMPORAIRE' } }), { key: 'WAITING_MANAGER', label: 'Attente responsable', tone: 'pending' })
  assert.deepEqual(requestValidationStageMeta({ status: 'EN_ATTENTE_VALIDATION', canDecideNow: false, treatment: { kind: 'VALIDATEUR_SECOURS_DIRECTEUR' } }), { key: 'WAITING_MANAGER', label: 'Attente responsable', tone: 'pending' })
  assert.deepEqual(requestValidationStageMeta({ status: 'EN_ATTENTE_VALIDATION', canDecideNow: true, treatment: { kind: 'RESPONSABLE_SERVICE' } }), { key: 'READY', label: 'À valider', tone: 'ready' })
  assert.deepEqual(requestValidationStageMeta({ status: 'EN_ATTENTE_VALIDATION', canDecideNow: true, treatment: { kind: 'RH_FINALISATION' } }), { key: 'READY', label: 'À valider', tone: 'ready' })
  assert.deepEqual(requestValidationStageMeta({ status: 'EN_ATTENTE_VALIDATION', canDecideNow: false, treatment: { kind: 'DIRECTEUR_SEUL' } }), { key: 'PENDING', label: 'En attente', tone: 'pending' })
})

test('table RH applique les libellés selon le droit réel de décision', () => {
  const rows = normalizeRhLeaveAndAbsenceRows({
    leaves: [
      { id: 1, status: 'EN_ATTENTE_VALIDATION', canDecideNow: false, treatment: { kind: 'RESPONSABLE_SERVICE' }, employee: {}, service: {}, leaveType: {} },
      { id: 2, status: 'EN_ATTENTE_VALIDATION', canDecideNow: true, treatment: { kind: 'RH_FINALISATION' }, employee: {}, service: {}, leaveType: {} },
      { id: 3, status: 'EN_ATTENTE_VALIDATION', canDecideNow: false, treatment: { kind: 'DIRECTEUR_SEUL' }, employee: {}, service: {}, leaveType: {} },
    ],
  })
  assert.equal(rows[0].status, 'WAITING_MANAGER')
  assert.equal(rows[0].statusLabel, 'Attente responsable')
  assert.equal(rows[1].status, 'READY')
  assert.equal(rows[1].statusLabel, 'À valider')
  assert.equal(rows[2].status, 'PENDING')
  assert.equal(rows[2].statusLabel, 'En attente')
})

test('filtre Statut RH reste complet même si les statuts ne sont pas présents dans les lignes chargées', () => {
  const leaveOptions = new Map(getRhEventStatusOptions('CONGE'))
  assert.equal(leaveOptions.get('WAITING_MANAGER'), 'Attente responsable')
  assert.equal(leaveOptions.get('READY'), 'À valider')
  assert.equal(leaveOptions.get('PENDING'), 'En attente')
  assert.equal(leaveOptions.get('VALIDEE'), 'Validée · traitement terminé')
  assert.equal(leaveOptions.get('REFUSEE'), 'Refusée')
  assert.equal(leaveOptions.get('ANNULATION_EN_ATTENTE_ACCORD'), 'Annulation en attente')
  assert.equal(leaveOptions.get('ANNULEE'), 'Annulée')
  assert.equal(leaveOptions.get('EXPIREE_NON_VALIDEE'), 'Expirée')
})
