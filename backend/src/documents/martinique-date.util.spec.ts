import {
  formatMartiniqueDateTime,
  formatMartiniqueDateOnly,
} from './martinique-date.util';

describe('formatMartiniqueDateTime — fuseau officiel America/Martinique', () => {
  it('convertit une seule fois un timestamp UTC vers UTC-4', () => {
    const result = formatMartiniqueDateTime(
      new Date('2026-06-15T12:00:00.000Z'),
    );
    expect(result).toContain('15 juin 2026');
    expect(result).toContain('08:00');
  });

  it('gère le passage au jour précédent près de minuit UTC', () => {
    const result = formatMartiniqueDateTime(
      new Date('2026-06-15T02:00:00.000Z'),
    );
    expect(result).toContain('14 juin 2026');
    expect(result).toContain('22:00');
  });

  it('ne décale pas deux fois une valeur déjà exprimée en UTC', () => {
    const result = formatMartiniqueDateTime(
      new Date('2026-10-13T16:30:00.000Z'),
    );
    expect(result).toContain('12:30');
  });

  it('reste sur UTC-4 fixe même en période d’heure d’été française', () => {
    // En juillet, la France métropolitaine est à UTC+2, la Martinique reste à UTC-4.
    const result = formatMartiniqueDateTime(
      new Date('2026-07-10T14:00:00.000Z'),
    );
    expect(result).toContain('10:00');
  });

  it('retourne une valeur neutre pour une valeur absente', () => {
    expect(formatMartiniqueDateTime(null)).toBe('Non renseigné');
    expect(formatMartiniqueDateTime(undefined)).toBe('Non renseigné');
  });
});

describe('formatMartiniqueDateOnly — dates seules sans conversion', () => {
  it('conserve exactement les composants jour/mois/année', () => {
    const result = formatMartiniqueDateOnly('2026-11-11');
    expect(result).toContain('11 novembre 2026');
  });

  it('ne déplace jamais une date seule d’un jour', () => {
    const result = formatMartiniqueDateOnly('2026-10-26');
    expect(result).toContain('26 octobre 2026');
  });
});
