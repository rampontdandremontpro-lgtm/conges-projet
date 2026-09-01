import test from 'node:test'
import assert from 'node:assert/strict'
import { selectDirectorHoursDate } from './directorHoursSelection.js'

const empty = { startDate: null, endDate: null, startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' }

test('hours mode selects a single day', () => {
  assert.deepEqual(selectDirectorHoursDate(empty, '2026-09-10'), {
    startDate: '2026-09-10', endDate: '2026-09-10', startPeriod: 'MATIN', endPeriod: 'APRES_MIDI',
  })
})

test('hours mode clears when clicking the selected day again', () => {
  const selected = { startDate: '2026-09-10', endDate: '2026-09-10', startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' }
  assert.deepEqual(selectDirectorHoursDate(selected, '2026-09-10'), empty)
})

test('hours mode moves selection when clicking another day', () => {
  const selected = { startDate: '2026-09-10', endDate: '2026-09-10', startPeriod: 'MATIN', endPeriod: 'APRES_MIDI' }
  assert.equal(selectDirectorHoursDate(selected, '2026-09-11').startDate, '2026-09-11')
})
