import { DayPeriod } from './leave-request.entity';
import {
  getCurrentDayPeriod,
  getMartiniqueDateString,
  getMartiniqueTimeString,
  getNextPeriodSwitch,
  occupiesSlot,
} from './leave-request-period.util';

function martiniqueTime(time: string): Date {
  const [hour, minute] = time.split(':').map((part) => Number(part));
  const utc = new Date('2025-06-15T00:00:00.000Z');
  utc.setUTCHours(hour + 4, minute, 0, 0);
  return utc;
}

const fullDay = {
  startDate: '2025-06-10',
  endDate: '2025-06-12',
  startPeriod: DayPeriod.MATIN,
  endPeriod: DayPeriod.APRES_MIDI,
};

describe('occupiesSlot — couverture des slots par un congé / une absence', () => {
  it('hors de la fenêtre [startDate, endDate] : aucun slot couvert', () => {
    expect(occupiesSlot(fullDay, '2025-06-09', DayPeriod.MATIN)).toBe(false);
    expect(occupiesSlot(fullDay, '2025-06-13', DayPeriod.APRES_MIDI)).toBe(false);
  });

  it('jour intermédiaire : les deux slots', () => {
    expect(occupiesSlot(fullDay, '2025-06-11', DayPeriod.MATIN)).toBe(true);
    expect(occupiesSlot(fullDay, '2025-06-11', DayPeriod.APRES_MIDI)).toBe(true);
  });

  it('premier jour commençant le matin : les deux slots', () => {
    expect(occupiesSlot(fullDay, '2025-06-10', DayPeriod.MATIN)).toBe(true);
    expect(occupiesSlot(fullDay, '2025-06-10', DayPeriod.APRES_MIDI)).toBe(true);
  });

  it('dernier jour finissant l’après-midi : les deux slots', () => {
    expect(occupiesSlot(fullDay, '2025-06-12', DayPeriod.MATIN)).toBe(true);
    expect(occupiesSlot(fullDay, '2025-06-12', DayPeriod.APRES_MIDI)).toBe(true);
  });

  it('premier jour commençant l’après-midi : APRES_MIDI seulement', () => {
    const item = { ...fullDay, startPeriod: DayPeriod.APRES_MIDI };
    expect(occupiesSlot(item, '2025-06-10', DayPeriod.MATIN)).toBe(false);
    expect(occupiesSlot(item, '2025-06-10', DayPeriod.APRES_MIDI)).toBe(true);
    expect(occupiesSlot(item, '2025-06-11', DayPeriod.MATIN)).toBe(true);
  });

  it('dernier jour finissant le matin : MATIN seulement', () => {
    const item = { ...fullDay, endPeriod: DayPeriod.MATIN };
    expect(occupiesSlot(item, '2025-06-12', DayPeriod.MATIN)).toBe(true);
    expect(occupiesSlot(item, '2025-06-12', DayPeriod.APRES_MIDI)).toBe(false);
    expect(occupiesSlot(item, '2025-06-11', DayPeriod.APRES_MIDI)).toBe(true);
  });

  it('même jour MATIN→MATIN : MATIN seulement', () => {
    const item = {
      startDate: '2025-06-15',
      endDate: '2025-06-15',
      startPeriod: DayPeriod.MATIN,
      endPeriod: DayPeriod.MATIN,
    };
    expect(occupiesSlot(item, '2025-06-15', DayPeriod.MATIN)).toBe(true);
    expect(occupiesSlot(item, '2025-06-15', DayPeriod.APRES_MIDI)).toBe(false);
  });

  it('même jour APRES_MIDI→APRES_MIDI : APRES_MIDI seulement', () => {
    const item = {
      startDate: '2025-06-15',
      endDate: '2025-06-15',
      startPeriod: DayPeriod.APRES_MIDI,
      endPeriod: DayPeriod.APRES_MIDI,
    };
    expect(occupiesSlot(item, '2025-06-15', DayPeriod.MATIN)).toBe(false);
    expect(occupiesSlot(item, '2025-06-15', DayPeriod.APRES_MIDI)).toBe(true);
  });

  it('même jour MATIN→APRES_MIDI : journée complète (les deux slots)', () => {
    const item = {
      startDate: '2025-06-15',
      endDate: '2025-06-15',
      startPeriod: DayPeriod.MATIN,
      endPeriod: DayPeriod.APRES_MIDI,
    };
    expect(occupiesSlot(item, '2025-06-15', DayPeriod.MATIN)).toBe(true);
    expect(occupiesSlot(item, '2025-06-15', DayPeriod.APRES_MIDI)).toBe(true);
  });

  it('même jour APRES_MIDI→MATIN (combinaison invalide) : AUCUN slot couvert', () => {
    const item = {
      startDate: '2025-06-15',
      endDate: '2025-06-15',
      startPeriod: DayPeriod.APRES_MIDI,
      endPeriod: DayPeriod.MATIN,
    };
    expect(occupiesSlot(item, '2025-06-15', DayPeriod.MATIN)).toBe(false);
    expect(occupiesSlot(item, '2025-06-15', DayPeriod.APRES_MIDI)).toBe(false);
  });

  it('startPeriod / endPeriod nuls (défauts historiques) : MATIN / APRES_MIDI', () => {
    const item = {
      startDate: '2025-06-15',
      endDate: '2025-06-15',
      startPeriod: null,
      endPeriod: null,
    };
    expect(occupiesSlot(item, '2025-06-15', DayPeriod.MATIN)).toBe(true);
    expect(occupiesSlot(item, '2025-06-15', DayPeriod.APRES_MIDI)).toBe(true);
  });
});

describe('getCurrentDayPeriod — bascule MATIN / APRES_MIDI', () => {
  it('avant l’heure de bascule → MATIN', () => {
    expect(getCurrentDayPeriod(martiniqueTime('11:59'), '12:00')).toBe(
      DayPeriod.MATIN,
    );
  });

  it('à l’heure de bascule inclusive → APRES_MIDI', () => {
    expect(getCurrentDayPeriod(martiniqueTime('12:00'), '12:00')).toBe(
      DayPeriod.APRES_MIDI,
    );
  });

  it('après l’heure de bascule → APRES_MIDI', () => {
    expect(getCurrentDayPeriod(martiniqueTime('12:01'), '12:00')).toBe(
      DayPeriod.APRES_MIDI,
    );
  });

  it('respecte une heure de bascule configurée différente (08:30)', () => {
    expect(getCurrentDayPeriod(martiniqueTime('08:29'), '08:30')).toBe(
      DayPeriod.MATIN,
    );
    expect(getCurrentDayPeriod(martiniqueTime('08:30'), '08:30')).toBe(
      DayPeriod.APRES_MIDI,
    );
  });

  it('ne dépend pas du fuseau local du serveur (indépendance Intl)', () => {
    expect(getCurrentDayPeriod(martiniqueTime('23:59'), '12:00')).toBe(
      DayPeriod.APRES_MIDI,
    );
    expect(getCurrentDayPeriod(martiniqueTime('00:00'), '12:00')).toBe(
      DayPeriod.MATIN,
    );
  });
});

describe('helpers de date/heure America/Martinique', () => {
  it('getMartiniqueTimeString produit une chaîne HH:MM zéro-paddée', () => {
    expect(getMartiniqueTimeString(martiniqueTime('08:05'))).toBe('08:05');
    expect(getMartiniqueTimeString(martiniqueTime('23:59'))).toBe('23:59');
    expect(getMartiniqueTimeString(martiniqueTime('00:00'))).toBe('00:00');
  });

  it('getMartiniqueDateString produit une date YYYY-MM-DD', () => {
    expect(getMartiniqueDateString(martiniqueTime('12:00'))).toBe(
      '2025-06-15',
    );
  });
});

describe('getNextPeriodSwitch — prochaine bascule de période en America/Martinique', () => {
  it('11:59 → bascule le même jour à 12:00 (heure Martinique = UTC−4)', () => {
    const next = getNextPeriodSwitch(martiniqueTime('11:59'), '12:00');
    expect(next.toISOString()).toBe('2025-06-15T16:00:00.000Z');
  });

  it('12:00 (inclus) → déjà APRES_MIDI : prochaine bascule demain à 00:00', () => {
    const next = getNextPeriodSwitch(martiniqueTime('12:00'), '12:00');
    expect(next.toISOString()).toBe('2025-06-16T04:00:00.000Z');
  });

  it('12:01 → prochaine bascule demain à 00:00', () => {
    const next = getNextPeriodSwitch(martiniqueTime('12:01'), '12:00');
    expect(next.toISOString()).toBe('2025-06-16T04:00:00.000Z');
  });

  it('23:59 → prochaine bascule demain à 00:00', () => {
    const next = getNextPeriodSwitch(martiniqueTime('23:59'), '12:00');
    expect(next.toISOString()).toBe('2025-06-16T04:00:00.000Z');
  });

  it('00:00 → bascule le même jour à 12:00', () => {
    const next = getNextPeriodSwitch(martiniqueTime('00:00'), '12:00');
    expect(next.toISOString()).toBe('2025-06-15T16:00:00.000Z');
  });

  it('respecte une heure de bascule configurée différente (08:30)', () => {
    expect(
      getNextPeriodSwitch(martiniqueTime('07:00'), '08:30').toISOString(),
    ).toBe('2025-06-15T12:30:00.000Z');
    expect(
      getNextPeriodSwitch(martiniqueTime('09:00'), '08:30').toISOString(),
    ).toBe('2025-06-16T04:00:00.000Z');
  });

  it('rejette tout fuseau autre qu\'America/Martinique (fuseau imposé)', () => {
    expect(() =>
      getNextPeriodSwitch(martiniqueTime('11:59'), '12:00', 'Europe/Paris'),
    ).toThrow(/America\/Martinique/);
  });

  it('retourne un instant exprimé avec le décalage UTC−4 (pas d\'heure d\'été)', () => {
    const next = getNextPeriodSwitch(martiniqueTime('11:59'), '12:00');
    expect(getMartiniqueTimeString(next)).toBe('12:00');
    expect(next.getUTCHours()).toBe(16);
  });
});
