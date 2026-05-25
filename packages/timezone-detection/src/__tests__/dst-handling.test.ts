import { describe, expect, it } from 'vitest';
import {
  isDSTTransition,
  isInAmbiguousHour,
} from '../dst-handling/dst-transitions.js';
import { resolveAmbiguousHour } from '../dst-handling/ambiguous.js';
import {
  safeAddDays,
  safeAddMonths,
  wallClockToInstant,
} from '../dst-handling/safe-arithmetic.js';
import { timezoneOffsetMinutes } from '../dst-handling/offset.js';

describe('timezoneOffsetMinutes', () => {
  it('Africa/Nairobi is +180 year-round (no DST)', () => {
    // Jan and Jul both at 12:00 UTC.
    const jan = new Date('2026-01-01T12:00:00Z');
    const jul = new Date('2026-07-01T12:00:00Z');
    expect(timezoneOffsetMinutes(jan, 'Africa/Nairobi')).toBe(180);
    expect(timezoneOffsetMinutes(jul, 'Africa/Nairobi')).toBe(180);
  });

  it('America/New_York: -300 in winter, -240 in summer', () => {
    const jan = new Date('2026-01-15T12:00:00Z');
    const jul = new Date('2026-07-15T12:00:00Z');
    expect(timezoneOffsetMinutes(jan, 'America/New_York')).toBe(-300);
    expect(timezoneOffsetMinutes(jul, 'America/New_York')).toBe(-240);
  });

  it('Europe/London: 0 in winter, +60 in summer', () => {
    const jan = new Date('2026-01-15T12:00:00Z');
    const jul = new Date('2026-07-15T12:00:00Z');
    expect(timezoneOffsetMinutes(jan, 'Europe/London')).toBe(0);
    expect(timezoneOffsetMinutes(jul, 'Europe/London')).toBe(60);
  });
});

describe('isDSTTransition — spring-forward', () => {
  it('US/Eastern detects spring-forward (8 Mar 2026 02:00 -> 03:00 local)', () => {
    // 8 Mar 2026 — at 12:00 UTC the offset is -240 (EDT). 24h earlier
    // (7 Mar 12:00 UTC) the offset is -300 (EST). diff = +60 → spring.
    const date = new Date('2026-03-08T12:00:00Z');
    const r = isDSTTransition(date, 'America/New_York');
    expect(r?.kind).toBe('spring-forward');
    if (r?.kind === 'spring-forward') {
      expect(r.gapMinutes).toBe(60);
    }
  });

  it('Europe/London detects spring-forward (29 Mar 2026)', () => {
    const date = new Date('2026-03-29T12:00:00Z');
    const r = isDSTTransition(date, 'Europe/London');
    expect(r?.kind).toBe('spring-forward');
  });
});

describe('isDSTTransition — fall-back', () => {
  it('US/Eastern detects fall-back (1 Nov 2026)', () => {
    const date = new Date('2026-11-01T12:00:00Z');
    const r = isDSTTransition(date, 'America/New_York');
    expect(r?.kind).toBe('fall-back');
    if (r?.kind === 'fall-back') {
      expect(r.overlapMinutes).toBe(60);
    }
  });

  it('Europe/London detects fall-back (25 Oct 2026)', () => {
    const date = new Date('2026-10-25T12:00:00Z');
    const r = isDSTTransition(date, 'Europe/London');
    expect(r?.kind).toBe('fall-back');
  });

  it('Africa/Nairobi never reports a transition', () => {
    for (const dateStr of [
      '2026-03-08T12:00:00Z',
      '2026-11-01T12:00:00Z',
      '2026-06-15T12:00:00Z',
    ]) {
      expect(isDSTTransition(new Date(dateStr), 'Africa/Nairobi')).toBeNull();
    }
  });
});

describe('isInAmbiguousHour', () => {
  it('returns true for an instant inside the EDT->EST fall-back hour', () => {
    // 1 Nov 2026 05:30 UTC is wall-clock 01:30 ambiguous in NY (EDT
    // ended at 06:00 UTC, EST starts 06:00 UTC).
    const inAmbiguousWindow = new Date('2026-11-01T05:30:00Z');
    expect(isInAmbiguousHour(inAmbiguousWindow, 'America/New_York')).toBe(true);
  });

  it('returns false for a regular hour in a DST-free zone', () => {
    expect(
      isInAmbiguousHour(new Date('2026-06-15T12:00:00Z'), 'Africa/Nairobi'),
    ).toBe(false);
  });
});

describe('resolveAmbiguousHour', () => {
  it('earlier vs later differ by 60min in the ambiguous window', () => {
    const ambig = new Date('2026-11-01T05:30:00Z');
    const earlier = resolveAmbiguousHour(ambig, 'America/New_York', 'earlier');
    const later = resolveAmbiguousHour(ambig, 'America/New_York', 'later');
    expect(later.getTime() - earlier.getTime()).toBe(60 * 60 * 1000);
  });

  it('returns the input unchanged outside the ambiguous window', () => {
    const normal = new Date('2026-06-15T12:00:00Z');
    expect(
      resolveAmbiguousHour(normal, 'Africa/Nairobi', 'earlier').getTime(),
    ).toBe(normal.getTime());
  });
});

describe('safeAddDays — DST-aware', () => {
  it('+1 day across spring-forward keeps the same wall-clock hour', () => {
    // 7 Mar 2026 14:00 NY (EST = UTC-5) → 19:00 UTC.
    const before = new Date('2026-03-07T19:00:00Z');
    const after = safeAddDays(before, 1, 'America/New_York');
    // After the spring-forward, 14:00 NY = 18:00 UTC (EDT = UTC-4).
    expect(after.toISOString()).toBe('2026-03-08T18:00:00.000Z');
  });

  it('+1 day in a DST-free zone is a 24h delta', () => {
    const before = new Date('2026-06-15T08:00:00Z');
    const after = safeAddDays(before, 1, 'Africa/Nairobi');
    expect(after.getTime() - before.getTime()).toBe(24 * 60 * 60 * 1000);
  });
});

describe('safeAddMonths — calendar clamping', () => {
  it('Jan 31 + 1 month clamps to Feb 28 (non-leap 2026)', () => {
    const jan31 = wallClockToInstant(2026, 1, 31, 12, 0, 0, 'Africa/Nairobi');
    const out = safeAddMonths(jan31, 1, 'Africa/Nairobi');
    // 28 Feb 2026 12:00 EAT (UTC+3) = 09:00 UTC.
    expect(out.toISOString()).toBe('2026-02-28T09:00:00.000Z');
  });

  it('Jan 31 + 1 month clamps to Feb 29 in a leap year (2028)', () => {
    const jan31 = wallClockToInstant(2028, 1, 31, 12, 0, 0, 'Africa/Nairobi');
    const out = safeAddMonths(jan31, 1, 'Africa/Nairobi');
    expect(out.toISOString()).toBe('2028-02-29T09:00:00.000Z');
  });
});

describe('wallClockToInstant', () => {
  it('round-trips through Africa/Nairobi', () => {
    const out = wallClockToInstant(2026, 6, 15, 12, 0, 0, 'Africa/Nairobi');
    // 12:00 EAT = 09:00 UTC.
    expect(out.toISOString()).toBe('2026-06-15T09:00:00.000Z');
  });

  it('round-trips through Europe/London during BST', () => {
    const out = wallClockToInstant(2026, 7, 1, 12, 0, 0, 'Europe/London');
    // 12:00 BST = 11:00 UTC.
    expect(out.toISOString()).toBe('2026-07-01T11:00:00.000Z');
  });

  it('round-trips through America/New_York during EST', () => {
    const out = wallClockToInstant(2026, 1, 15, 12, 0, 0, 'America/New_York');
    // 12:00 EST = 17:00 UTC.
    expect(out.toISOString()).toBe('2026-01-15T17:00:00.000Z');
  });
});
