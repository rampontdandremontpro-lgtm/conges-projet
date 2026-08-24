import {
  calculateDerogationExpiry,
  evaluateSubmissionNotice,
} from './leave-request-notice.util';

import { describe, expect, it } from '@jest/globals';

const rules = {
  normalDeadlineDays: 30,
  specialDeadlineDays: 60,
  specialDurationThresholdDays: 21,
  derogationLastAllowedDay: 3,
  summerPeriodStart: '05-01',
  summerPeriodEnd: '10-31',
};

describe('leave-request-notice.util', () => {
  const now = new Date('2026-01-01T12:00:00.000Z');

  it('applique le délai normal de 30 jours hors période estivale', () => {
    const result = evaluateSubmissionNotice(
      '2026-03-15',
      '2026-03-19',
      5,
      now,
      rules,
    );

    expect(result.requiredNoticeDays).toBe(30);
    expect(result.isLongLeave).toBe(false);
    expect(result.overlapsSummerPeriod).toBe(false);
    expect(result.isNoticeCompliant).toBe(true);
  });

  it('applique le délai spécial de 60 jours pour un congé long', () => {
    const result = evaluateSubmissionNotice(
      '2026-03-15',
      '2026-04-10',
      27,
      now,
      rules,
    );

    expect(result.requiredNoticeDays).toBe(60);
    expect(result.isLongLeave).toBe(true);
  });

  it('applique le délai spécial lorsque la période estivale est chevauchée', () => {
    const result = evaluateSubmissionNotice(
      '2026-04-28',
      '2026-05-04',
      7,
      now,
      rules,
    );

    expect(result.overlapsSummerPeriod).toBe(true);
    expect(result.requiredNoticeDays).toBe(60);
  });

  it('ouvre la fenêtre de dérogation entre J-29 et J-3', () => {
    const result = evaluateSubmissionNotice(
      '2026-01-11',
      '2026-01-11',
      1,
      now,
      rules,
    );

    expect(result.daysBeforeStart).toBe(10);
    expect(result.isNoticeCompliant).toBe(false);
    expect(result.isDerogationWindow).toBe(true);
  });

  it('calcule la fin du délai de traitement à J-3 à 16 h en Martinique', () => {
    expect(calculateDerogationExpiry('2026-02-10', 3).toISOString()).toBe(
      '2026-02-07T20:00:00.000Z',
    );
  });
});
