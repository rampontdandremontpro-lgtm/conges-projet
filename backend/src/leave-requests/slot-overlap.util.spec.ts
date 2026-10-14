import { DayPeriod } from './leave-request.entity';
import { findPeriodConflict } from './slot-overlap.util';

const fullDay = {
  startDate: '2026-10-20',
  endDate: '2026-10-20',
  startPeriod: DayPeriod.MATIN,
  endPeriod: DayPeriod.APRES_MIDI,
};

describe('findPeriodConflict — chevauchement demi-journée', () => {
  it('aucun conflit hors de la fenêtre de dates', () => {
    expect(
      findPeriodConflict(
        { startDate: '2026-10-21', endDate: '2026-10-21', startPeriod: DayPeriod.MATIN, endPeriod: DayPeriod.APRES_MIDI },
        { startDate: '2026-10-20', endDate: '2026-10-20', startPeriod: DayPeriod.MATIN, endPeriod: DayPeriod.APRES_MIDI },
      ),
    ).toBeNull();
  });

  it('matin occupé -> conflit sur le matin uniquement', () => {
    const conflict = findPeriodConflict(
      { startDate: '2026-10-20', endDate: '2026-10-20', startPeriod: DayPeriod.MATIN, endPeriod: DayPeriod.APRES_MIDI },
      { startDate: '2026-10-20', endDate: '2026-10-20', startPeriod: DayPeriod.MATIN, endPeriod: DayPeriod.MATIN },
    );
    expect(conflict).toEqual({ date: '2026-10-20', period: DayPeriod.MATIN });
  });

  it('matin occupé -> après-midi reste libre (aucun conflit)', () => {
    expect(
      findPeriodConflict(
        { startDate: '2026-10-20', endDate: '2026-10-20', startPeriod: DayPeriod.APRES_MIDI, endPeriod: DayPeriod.APRES_MIDI },
        { startDate: '2026-10-20', endDate: '2026-10-20', startPeriod: DayPeriod.MATIN, endPeriod: DayPeriod.MATIN },
      ),
    ).toBeNull();
  });

  it('après-midi occupé -> matin reste libre (aucun conflit)', () => {
    expect(
      findPeriodConflict(
        { startDate: '2026-10-20', endDate: '2026-10-20', startPeriod: DayPeriod.MATIN, endPeriod: DayPeriod.MATIN },
        { startDate: '2026-10-20', endDate: '2026-10-20', startPeriod: DayPeriod.APRES_MIDI, endPeriod: DayPeriod.APRES_MIDI },
      ),
    ).toBeNull();
  });

  it('deux demi-journées différentes occupées -> journée bloquée', () => {
    const conflict = findPeriodConflict(
      fullDay,
      { startDate: '2026-10-20', endDate: '2026-10-20', startPeriod: DayPeriod.MATIN, endPeriod: DayPeriod.MATIN },
    );
    expect(conflict?.date).toBe('2026-10-20');
    expect(conflict?.period).toBe(DayPeriod.MATIN);
  });

  it('période multi-jours traversant un jour occupé -> conflit', () => {
    const conflict = findPeriodConflict(
      { startDate: '2026-10-19', endDate: '2026-10-22', startPeriod: DayPeriod.MATIN, endPeriod: DayPeriod.APRES_MIDI },
      { startDate: '2026-10-21', endDate: '2026-10-21', startPeriod: DayPeriod.MATIN, endPeriod: DayPeriod.APRES_MIDI },
    );
    expect(conflict?.date).toBe('2026-10-21');
  });

  it('période multi-jours : premier jour finissant le matin ne bloque pas l’après-midi du jour suivant', () => {
    expect(
      findPeriodConflict(
        { startDate: '2026-10-20', endDate: '2026-10-21', startPeriod: DayPeriod.MATIN, endPeriod: DayPeriod.APRES_MIDI },
        { startDate: '2026-10-21', endDate: '2026-10-21', startPeriod: DayPeriod.APRES_MIDI, endPeriod: DayPeriod.APRES_MIDI },
      ),
    ).not.toBeNull();
  });

  it('périodes nulles (mode heures) -> journée complète', () => {
    const conflict = findPeriodConflict(
      fullDay,
      { startDate: '2026-10-20', endDate: '2026-10-20', startPeriod: null, endPeriod: null },
    );
    expect(conflict?.date).toBe('2026-10-20');
  });
});
