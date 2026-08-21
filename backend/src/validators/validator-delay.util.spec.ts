import {
  getValidatorTakeoverAt,
  isValidatorTakeoverDelayExpired,
} from './validator-delay.util';

describe('validator delay', () => {
  const submittedAt = new Date('2026-08-01T10:00:00.000-04:00');

  it('keeps the primary validator before the delay expires', () => {
    expect(
      isValidatorTakeoverDelayExpired(
        submittedAt,
        7,
        new Date('2026-08-08T09:59:59.999-04:00'),
      ),
    ).toBe(false);
  });

  it('opens the relay exactly when the delay expires', () => {
    expect(
      isValidatorTakeoverDelayExpired(
        submittedAt,
        7,
        new Date('2026-08-08T10:00:00.000-04:00'),
      ),
    ).toBe(true);
  });

  it('keeps the relay open after an overdue validation', () => {
    expect(
      isValidatorTakeoverDelayExpired(
        submittedAt,
        7,
        new Date('2026-08-10T14:30:00.000-04:00'),
      ),
    ).toBe(true);
  });

  it('computes the expected takeover date', () => {
    expect(getValidatorTakeoverAt(submittedAt, 7).toISOString()).toBe(
      '2026-08-08T14:00:00.000Z',
    );
  });
});
