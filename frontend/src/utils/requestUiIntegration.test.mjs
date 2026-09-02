import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const read = (path) => fs.readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8')

test('nouvelle demande déplace le résumé de sélection dans le récapitulatif', () => {
  const recap = read('frontend/src/components/collab/new-request/RecapCard.jsx')
  const calendar = read('frontend/src/components/collab/new-request/LeaveCalendar.jsx')
  assert.match(recap, /buildSelectionPeriodBadge/)
  assert.match(recap, /referencePeriodBadge/)
  assert.doesNotMatch(calendar, /<strong>Sélection :<\/strong>/)
  assert.doesNotMatch(calendar, /<strong>Départ :<\/strong>/)
  assert.doesNotMatch(calendar, /nr-cal__selection-confirmation/)
})

test('présence globale expose le filtre Situation et les redirections dashboard', () => {
  const presence = read('frontend/src/pages/director/PresencePage.jsx')
  const rhCard = read('frontend/src/components/rh/dashboard/RhPresenceCard.jsx')
  const directorDashboard = read('frontend/src/pages/director/DashboardPage.jsx')
  assert.match(presence, /<span>Situation<\/span>/)
  assert.match(presence, /filter=\{situationFilter\}/)
  assert.match(rhCard, /rh-presence\?situation=PRESENT/)
  assert.match(rhCard, /rh-presence\?situation=EN_VACANCES/)
  assert.match(rhCard, /rh-presence\?situation=ABSENT/)
  assert.match(directorDashboard, /director-presence\?situation=PRESENT/)
  assert.match(directorDashboard, /director-presence\?situation=EN_VACANCES/)
  assert.match(directorDashboard, /director-presence\?situation=ABSENT/)
})

test('listes de demandes utilisent l’étape métier et le dashboard limite aux demandes traitables', () => {
  const backend = read('backend/src/leave-requests/leave-requests.service.ts')
  const rhWorkload = read('frontend/src/components/rh/dashboard/RhWorkloadCard.jsx')
  const rhPage = read('frontend/src/pages/rh/LeavesAndAbsencesPage.jsx')
  const directorPage = read('frontend/src/pages/director/AllRequestsPage.jsx')
  assert.match(backend, /validatorResolutionService\.describeTreatment/)
  assert.match(backend, /treatment,/)
  assert.match(backend, /validatorResolutionService\.resolveAccess/)
  assert.match(backend, /canDecideNow/)
  assert.match(rhWorkload, /rh-leaves-absences\?actionable=1/)
  assert.match(rhPage, /actionableLeaveIds/)
  assert.match(rhPage, /getRhEventStatusOptions/)
  assert.match(directorPage, /getDirectorPendingRequests/)
  assert.match(directorPage, /actionableOnly/)
})
