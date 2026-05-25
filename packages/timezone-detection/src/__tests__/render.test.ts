import { describe, expect, it } from 'vitest';
import { humanReadable } from '../render/human-readable.js';
import { nextOccurrence } from '../render/next-occurrence.js';
import { relativeTime } from '../render/relative-time.js';
import { renderInTZ } from '../render/render-in-tz.js';

describe('renderInTZ', () => {
  it('renders Africa/Nairobi yyyy-MM-dd HH:mm correctly (UTC+3)', () => {
    const d = new Date('2026-05-25T06:30:00Z'); // 09:30 EAT
    expect(renderInTZ(d, 'Africa/Nairobi', 'yyyy-MM-dd HH:mm')).toBe(
      '2026-05-25 09:30',
    );
  });

  it('renders numeric offset ZZ correctly for Nairobi', () => {
    const d = new Date('2026-05-25T06:30:00Z');
    expect(renderInTZ(d, 'Africa/Nairobi', 'ZZ')).toBe('+03:00');
  });

  it('renders IANA literal ZZZZ correctly', () => {
    const d = new Date('2026-05-25T06:30:00Z');
    expect(renderInTZ(d, 'Africa/Kigali', 'ZZZZ HH')).toBe('Africa/Kigali 08');
  });

  it('renders 12-hour format with am/pm', () => {
    const d = new Date('2026-05-25T18:30:00Z'); // 21:30 EAT
    const r = renderInTZ(d, 'Africa/Nairobi', 'hh:mm a');
    expect(r).toBe('09:30 PM');
  });

  it('renders BST correctly for London in summer', () => {
    const d = new Date('2026-07-01T11:00:00Z'); // 12:00 BST
    expect(renderInTZ(d, 'Europe/London', 'HH:mm')).toBe('12:00');
  });

  it('throws on invalid timezone', () => {
    const d = new Date();
    expect(() => renderInTZ(d, 'Mars/Olympus', 'HH:mm')).toThrow(
      /invalid timezone/,
    );
  });
});

describe('relativeTime', () => {
  it('"2 hours ago" for a date 2h in the past', () => {
    const now = new Date('2026-05-25T12:00:00Z');
    const past = new Date('2026-05-25T10:00:00Z');
    const out = relativeTime(past, { tz: 'Africa/Nairobi', now: () => now });
    expect(out).toBe('2 hours ago');
  });

  it('"in 5 minutes" for a date 5m in the future', () => {
    const now = new Date('2026-05-25T12:00:00Z');
    const future = new Date('2026-05-25T12:05:00Z');
    const out = relativeTime(future, { tz: 'Africa/Nairobi', now: () => now });
    expect(out).toMatch(/in 5 minutes/);
  });

  it('"yesterday" depends on user TZ', () => {
    // now: 27 May 12:00 UTC -> 27 May 15:00 EAT (Nairobi calendar day 27).
    // past: 26 May 18:00 UTC -> 26 May 21:00 EAT (Nairobi calendar day 26).
    // Calendar day diff in Nairobi: 27 - 26 = 1 -> Intl renders "yesterday".
    const now = new Date('2026-05-27T12:00:00Z');
    const past = new Date('2026-05-26T18:00:00Z');
    const out = relativeTime(past, { tz: 'Africa/Nairobi', now: () => now });
    expect(out).toMatch(/yesterday/);
  });
});

describe('nextOccurrence — cron in tz', () => {
  it('"0 9 * * *" daily 09:00 Africa/Nairobi resolves to today/tomorrow 09:00 EAT', () => {
    // From 2026-05-25T05:00:00Z (08:00 EAT) → next at 09:00 EAT = 06:00 UTC.
    const from = new Date('2026-05-25T05:00:00Z');
    const out = nextOccurrence('0 9 * * *', 'Africa/Nairobi', from);
    expect(out.toISOString()).toBe('2026-05-25T06:00:00.000Z');
  });

  it('"30 * * * *" hourly @30 minutes past', () => {
    const from = new Date('2026-05-25T10:00:00Z'); // 13:00 EAT
    const out = nextOccurrence('30 * * * *', 'Africa/Nairobi', from);
    // 13:30 EAT = 10:30 UTC.
    expect(out.toISOString()).toBe('2026-05-25T10:30:00.000Z');
  });

  it('"*/15 * * * *" every 15 minutes', () => {
    const from = new Date('2026-05-25T10:02:00Z'); // 13:02 EAT
    const out = nextOccurrence('*/15 * * * *', 'Africa/Nairobi', from);
    // Next match: 13:15 EAT = 10:15 UTC.
    expect(out.toISOString()).toBe('2026-05-25T10:15:00.000Z');
  });

  it('throws on a malformed expression', () => {
    expect(() => nextOccurrence('not-a-cron', 'Africa/Nairobi')).toThrow();
  });
});

describe('humanReadable', () => {
  it('renders Africa/Nairobi en-US default style', () => {
    const d = new Date('2026-05-25T06:30:00Z');
    const out = humanReadable(d, { tz: 'Africa/Nairobi' });
    expect(out).toMatch(/May 25, 2026/);
    expect(out).toMatch(/9:30/);
  });

  it('respects supplied locale and styles', () => {
    const d = new Date('2026-05-25T06:30:00Z');
    const out = humanReadable(d, {
      tz: 'Europe/London',
      locale: 'en-GB',
      dateStyle: 'short',
      timeStyle: 'short',
    });
    // London at 07:30 BST. Locale en-GB uses dd/MM/yyyy.
    expect(out).toMatch(/25\/05\/2026/);
  });

  it('throws on invalid TZ', () => {
    expect(() =>
      humanReadable(new Date(), { tz: 'Mars/Olympus' }),
    ).toThrowError(/invalid timezone/);
  });
});
