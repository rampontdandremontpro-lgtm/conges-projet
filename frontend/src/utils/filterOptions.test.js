import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildGroupedServiceOptions,
  isExternalService,
  isReservedDirectorLeaveType,
  matchesGroupedServiceFilter,
} from './filterOptions.js'

const services = [
  { id: 1, name: 'Technique', serviceType: 'INTERNE', externalCompanyName: null },
  { id: 2, name: 'Prestataire A', serviceType: 'EXTERNE', externalCompanyName: 'Société A' },
  { id: 3, name: 'Prestataire B', serviceType: 'EXTERNE', externalCompanyName: 'Société B' },
]

test('regroupe les services externes sous une seule option Mis à disposition', () => {
  assert.deepEqual(buildGroupedServiceOptions(services), [
    { value: '1', label: 'Technique' },
    { value: 'external', label: 'Mis à disposition' },
  ])
})

test('reconnaît un service externe par son type ou son entreprise externe', () => {
  assert.equal(isExternalService(services[1]), true)
  assert.equal(isExternalService({ id: 4, name: 'Externe', externalCompanyName: 'Prestataire' }), true)
  assert.equal(isExternalService(services[0]), false)
})

test('le filtre external accepte tous les services externes et aucun interne', () => {
  const externalIds = new Set(['2', '3'])
  assert.equal(matchesGroupedServiceFilter('2', 'external', externalIds), true)
  assert.equal(matchesGroupedServiceFilter('3', 'external', externalIds), true)
  assert.equal(matchesGroupedServiceFilter('1', 'external', externalIds), false)
  assert.equal(matchesGroupedServiceFilter('1', '1', externalIds), true)
  assert.equal(matchesGroupedServiceFilter('2', 'all', externalIds), true)
})

test('identifie uniquement le type Congé réservé à l’indisponibilité du Directeur', () => {
  assert.equal(isReservedDirectorLeaveType({ name: 'Congé', category: 'DEMANDE_CONGE' }), true)
  assert.equal(isReservedDirectorLeaveType({ name: 'Conge', category: 'DEMANDE_CONGE' }), true)
  assert.equal(isReservedDirectorLeaveType({ name: 'Congés payés', category: 'DEMANDE_CONGE' }), false)
  assert.equal(isReservedDirectorLeaveType({ name: 'Congé', category: 'DECLARATION_ABSENCE' }), false)
})
