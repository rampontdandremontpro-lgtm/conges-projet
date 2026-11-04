/**
 * JUR-027 — Lot L2 : exemples chiffrés avec dates.
 * Démonstration du moteur pur (aucune base de données).
 * Exécution : npx ts-node --transpile-only src/leave-balances/carryover-expiry/carryover-expiry.examples.ts
 */
import { computeCarryoverExpiry } from './carryover-expiry.service';
import type { CarryoverExpiryInput, CarryoverExpiryResult } from './carryover-expiry.types';

function show(title: string, input: CarryoverExpiryInput): void {
  const r: CarryoverExpiryResult = computeCarryoverExpiry(input);
  console.log(`\n=== ${title} ===`);
  console.log(`  régime            : ${r.regime}`);
  console.log(`  état du délai     : ${r.status}`);
  console.log(`  situation d'absence: ${r.absenceStatus ?? '—'}`);
  console.log(`  point de départ   : ${r.startDate ?? '—'}`);
  console.log(`  échéance de base  : ${r.deadline ?? '—'}`);
  console.log(`  échéance OPPOSABLE: ${r.effectiveExpiresAt ?? '—'}`);
  console.log(`  échéance INDICATIVE: ${r.indicativeExpiresAt ?? '—'}`);
  if (r.suspension) {
    console.log(
      `  suspension        : ${r.suspension.from} → ${r.suspension.to ?? '—'} ` +
        `(${r.suspension.calendarDays ?? '?'} j suspendus, reliquat ${r.suspension.remainingDaysAtReprise} j)`,
    );
  }
  console.log(`  fondement         : ${r.legalBasis} (${r.monthsApplied} mois)`);
  for (const e of r.events) console.log(`    • ${e.date ?? '   '} ${e.label}`);
  if (r.missingInformation.length) {
    console.log(`  manquant/incohérent:`);
    for (const m of r.missingInformation) console.log(`    ✗ ${m}`);
  }
  for (const w of r.warnings) console.log(`  ⚠ ${w}`);
}

show('Régime général — information certaine (L3141-19-1)', {
  regime: 'GENERAL',
  repriseDate: '2025-06-20',
  informationDate: '2025-06-25',
  informationDateCertain: true,
  today: '2025-06-25',
});

show('Régime général — information non confirmée à date certaine → indicatif', {
  regime: 'GENERAL',
  informationDate: '2025-06-25',
  informationDateCertain: false,
  today: '2025-06-25',
});

show('Régime général — information absente → À VÉRIFIER', {
  regime: 'GENERAL',
  repriseDate: '2025-06-20',
  today: '2025-06-25',
});

show('Arrêt long — salarié toujours absent (L3141-19-2)', {
  regime: 'ARRET_LONG',
  referencePeriodEnd: '2025-05-31',
  absenceStatus: 'ABSENT',
  acquiredDuringL3141_5_5or7: true,
  suspensionAtLeastOneYearAtPeriodEnd: true,
  today: '2026-09-01',
});

show('Arrêt long — reprise avant échéance, suspension du reliquat', {
  regime: 'ARRET_LONG',
  referencePeriodEnd: '2025-05-31',
  absenceStatus: 'REPRIS',
  repriseDate: '2026-03-01',
  informationDate: '2026-04-01',
  informationDateCertain: true,
  acquiredDuringL3141_5_5or7: true,
  suspensionAtLeastOneYearAtPeriodEnd: true,
  today: '2026-04-01',
});

show('Arrêt long — reprise après échéance (aucune prolongation)', {
  regime: 'ARRET_LONG',
  referencePeriodEnd: '2025-05-31',
  absenceStatus: 'REPRIS',
  repriseDate: '2026-10-01',
  informationDate: '2026-11-01',
  informationDateCertain: true,
  acquiredDuringL3141_5_5or7: true,
  suspensionAtLeastOneYearAtPeriodEnd: true,
  today: '2026-10-01',
});

show('Arrêt long — information reçue tardivement (+92 j)', {
  regime: 'ARRET_LONG',
  referencePeriodEnd: '2025-05-31',
  absenceStatus: 'REPRIS',
  repriseDate: '2026-03-01',
  informationDate: '2026-06-01',
  informationDateCertain: true,
  acquiredDuringL3141_5_5or7: true,
  suspensionAtLeastOneYearAtPeriodEnd: true,
  today: '2026-06-01',
});

show('Arrêt long — information non datée → SUSPENDU (reliquat 183 j)', {
  regime: 'ARRET_LONG',
  referencePeriodEnd: '2025-05-31',
  absenceStatus: 'REPRIS',
  repriseDate: '2026-03-01',
  informationDate: null,
  acquiredDuringL3141_5_5or7: true,
  suspensionAtLeastOneYearAtPeriodEnd: true,
  today: '2026-05-01',
});

show('Arrêt long — situation de reprise non renseignée → À VÉRIFIER', {
  regime: 'ARRET_LONG',
  referencePeriodEnd: '2025-05-31',
  repriseDate: null,
  acquiredDuringL3141_5_5or7: true,
  suspensionAtLeastOneYearAtPeriodEnd: true,
  today: '2026-01-01',
});

show('Arrêt long — condition L3141-19-2 non renseignée → À VÉRIFIER', {
  regime: 'ARRET_LONG',
  referencePeriodEnd: '2025-05-31',
  absenceStatus: 'ABSENT',
  suspensionAtLeastOneYearAtPeriodEnd: true,
  today: '2026-01-01',
});

show('Durée conventionnelle plus favorable 18 mois (L3141-21-1)', {
  regime: 'GENERAL',
  informationDate: '2025-06-25',
  informationDateCertain: true,
  carryoverMonths: 18,
  today: '2025-06-25',
});

show('Année bissextile — information le 29/02/2024', {
  regime: 'GENERAL',
  informationDate: '2024-02-29',
  informationDateCertain: true,
  today: '2024-02-29',
});
