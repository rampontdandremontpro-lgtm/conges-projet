// Retest ciblé : limite de sélection N/N+1 et dates de déblocage.
// Teste les fonctions pures du frontend (aucun serveur nécessaire).
import {
  currentReferencePeriod,
  endOfNPlusOneReferencePeriod,
  referencePeriodEndDate,
  referencePeriodForIsoDate,
  unlockDateForIsoDate,
} from '../../../frontend/src/utils/referencePeriods.js'

let passed = 0
let failed = 0
const failures = []

function check(label, actual, expected) {
  const ok = actual === expected
  if (ok) passed += 1
  else {
    failed += 1
    failures.push(`${label} → attendu « ${expected} », obtenu « ${actual} »`)
  }
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}`)
}

// --- 1. Bascule de période (début 06-01) -------------------------------
check('31/05/2027 → période active 2026-2027', referencePeriodForIsoDate('2027-05-31'), '2026-2027')
check('01/06/2027 → période active 2027-2028', referencePeriodForIsoDate('2027-06-01'), '2027-2028')
check('01/06/2028 → période active 2028-2029', referencePeriodForIsoDate('2028-06-01'), '2028-2029')

// --- 2. Limite (fin de N+1) aux dates d'exemple ------------------------
check('au 14/10/2026 (période 2026-2027) → fin N+1 31/05/2028', endOfNPlusOneReferencePeriod('2026-2027'), '2028-05-31')
check('au 01/06/2027 (période 2027-2028) → fin N+1 31/05/2029', endOfNPlusOneReferencePeriod('2027-2028'), '2029-05-31')
check('au 01/06/2028 (période 2028-2029) → fin N+1 31/05/2030', endOfNPlusOneReferencePeriod('2028-2029'), '2030-05-31')

// --- 3. Date de déblocage par date grisée (au 14/10/2026) --------------
check('01/06/2028 bloqué → accessible 01/06/2027', unlockDateForIsoDate('2028-06-01'), '2027-06-01')
check('01/06/2029 bloqué → accessible 01/06/2028', unlockDateForIsoDate('2029-06-01'), '2028-06-01')
check('01/06/2030 bloqué → accessible 01/06/2029', unlockDateForIsoDate('2030-06-01'), '2029-06-01')
check('15/12/2028 (même période N+2) → accessible 01/06/2027', unlockDateForIsoDate('2028-12-15'), '2027-06-01')

// --- 4. Fuseau America/Martinique (UTC−4 fixe) -------------------------
// 01/06/2027 00h30 UTC = 31/05/2027 20h30 en Martinique → encore N.
check('00:30 UTC le 01/06/2027 → encore 2026-2027', currentReferencePeriod(new Date('2027-06-01T00:30:00.000Z')), '2026-2027')
// 01/06/2027 05h00 UTC = 01/06/2027 01h00 en Martinique → N+1.
check('05:00 UTC le 01/06/2027 → 2027-2028', currentReferencePeriod(new Date('2027-06-01T05:00:00.000Z')), '2027-2028')

// --- 5. Configuration de début de période différente (04-15) -----------
check('04-15 : fin de N+1 au 14/04/2029', endOfNPlusOneReferencePeriod('2027-2028', '04-15'), '2029-04-14')
check('04-15 : fin de période 2027-2028 → 14/04/2028', referencePeriodEndDate('2027-2028', '04-15'), '2028-04-14')
check('04-15 : 15/04/2029 bloqué → accessible 15/04/2028', unlockDateForIsoDate('2029-04-15', '04-15'), '2028-04-15')

console.log('\n=== RÉSUMÉ limite N/N+1 ===')
console.log(`Total: ${passed + failed}, Conforme: ${passed}, Non conforme: ${failed}`)
if (failures.length) {
  console.log('\nÉchecs :')
  for (const line of failures) console.log(` - ${line}`)
  process.exit(1)
}
