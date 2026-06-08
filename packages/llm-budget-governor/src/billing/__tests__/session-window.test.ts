import { describe, expect, it } from 'vitest';
import {
  SESSION_WINDOW_MS,
  computeSessionWindow,
  hasSessionRolledOver,
  sessionRemainingTokens,
  type SessionSpendRecord,
} from '../session-window.js';

const HOUR = 60 * 60 * 1000;

function rec(at: string, weightedTokens: number, cents = 0): SessionSpendRecord {
  return { at: new Date(at), weightedTokens, cents, tier: 'sonnet' };
}

describe('computeSessionWindow', () => {
  it('opens a FRESH window at now when there is no recent spend', () => {
    const now = new Date('2026-06-09T12:00:00.000Z');
    const w = computeSessionWindow([], now);
    expect(w.isFresh).toBe(true);
    expect(w.consumedTokens).toBe(0);
    expect(w.start).toEqual(now);
    expect(w.resetAt.getTime()).toBe(now.getTime() + SESSION_WINDOW_MS);
    expect(w.highestTierUsed).toBeNull();
  });

  it('anchors on the first message of the session (Claude semantics)', () => {
    const now = new Date('2026-06-09T12:00:00.000Z');
    const records = [
      rec('2026-06-09T09:00:00.000Z', 100), // first message → anchor
      rec('2026-06-09T10:30:00.000Z', 200),
      rec('2026-06-09T11:45:00.000Z', 300),
    ];
    const w = computeSessionWindow(records, now);
    expect(w.isFresh).toBe(false);
    expect(w.start.toISOString()).toBe('2026-06-09T09:00:00.000Z');
    expect(w.resetAt.getTime()).toBe(w.start.getTime() + 5 * HOUR);
    expect(w.consumedTokens).toBe(600);
  });

  it('excludes spend older than 5h from the anchor (rollover)', () => {
    const now = new Date('2026-06-09T12:00:00.000Z');
    const records = [
      rec('2026-06-09T06:00:00.000Z', 999), // 6h ago → outside the window
      rec('2026-06-09T08:30:00.000Z', 100), // within 5h of now → new anchor
      rec('2026-06-09T11:00:00.000Z', 200),
    ];
    const w = computeSessionWindow(records, now);
    // The 06:00 record is older than now-5h (07:00) → not live; anchor is 08:30.
    expect(w.start.toISOString()).toBe('2026-06-09T08:30:00.000Z');
    expect(w.consumedTokens).toBe(300); // 100 + 200, the 999 excluded
  });

  it('resetAt is always 5h after the anchor and always present', () => {
    const now = new Date('2026-06-09T12:00:00.000Z');
    const w = computeSessionWindow([rec('2026-06-09T10:00:00.000Z', 50)], now);
    expect(w.resetAt).toBeInstanceOf(Date);
    expect(w.resetAt.getTime() - w.start.getTime()).toBe(SESSION_WINDOW_MS);
  });

  it('tracks the highest model tier used in the window', () => {
    const now = new Date('2026-06-09T12:00:00.000Z');
    const records: SessionSpendRecord[] = [
      { at: new Date('2026-06-09T10:00:00.000Z'), weightedTokens: 10, cents: 1, tier: 'haiku' },
      { at: new Date('2026-06-09T10:30:00.000Z'), weightedTokens: 10, cents: 1, tier: 'opus' },
      { at: new Date('2026-06-09T11:00:00.000Z'), weightedTokens: 10, cents: 1, tier: 'sonnet' },
    ];
    const w = computeSessionWindow(records, now);
    expect(w.highestTierUsed).toBe('opus');
  });

  it('ignores future-dated records (clock skew)', () => {
    const now = new Date('2026-06-09T12:00:00.000Z');
    const records = [
      rec('2026-06-09T10:00:00.000Z', 100),
      rec('2026-06-09T13:00:00.000Z', 500), // future → ignored
    ];
    const w = computeSessionWindow(records, now);
    expect(w.consumedTokens).toBe(100);
  });

  it('honors an explicit anchorOverride when still inside 5h', () => {
    const now = new Date('2026-06-09T12:00:00.000Z');
    const override = new Date('2026-06-09T09:30:00.000Z');
    const records = [rec('2026-06-09T10:00:00.000Z', 100)];
    const w = computeSessionWindow(records, now, override);
    expect(w.start).toEqual(override);
    expect(w.resetAt.getTime()).toBe(override.getTime() + SESSION_WINDOW_MS);
  });

  it('ignores a stale anchorOverride older than 5h and re-infers', () => {
    const now = new Date('2026-06-09T12:00:00.000Z');
    const stale = new Date('2026-06-09T05:00:00.000Z'); // 7h ago
    const records = [rec('2026-06-09T10:00:00.000Z', 100)];
    const w = computeSessionWindow(records, now, stale);
    expect(w.start.toISOString()).toBe('2026-06-09T10:00:00.000Z');
  });

  it('sorts unordered input internally', () => {
    const now = new Date('2026-06-09T12:00:00.000Z');
    const records = [
      rec('2026-06-09T11:00:00.000Z', 300),
      rec('2026-06-09T09:00:00.000Z', 100),
      rec('2026-06-09T10:00:00.000Z', 200),
    ];
    const w = computeSessionWindow(records, now);
    expect(w.start.toISOString()).toBe('2026-06-09T09:00:00.000Z');
    expect(w.consumedTokens).toBe(600);
  });
});

describe('sessionRemainingTokens', () => {
  it('returns headroom and never goes negative', () => {
    const now = new Date('2026-06-09T12:00:00.000Z');
    const w = computeSessionWindow([rec('2026-06-09T11:00:00.000Z', 40_000)], now);
    expect(sessionRemainingTokens(w, 44_000)).toBe(4_000);
    expect(sessionRemainingTokens(w, 10_000)).toBe(0);
  });
});

describe('hasSessionRolledOver', () => {
  it('is true once now reaches the prior resetAt', () => {
    const resetAt = new Date('2026-06-09T14:00:00.000Z');
    expect(hasSessionRolledOver(resetAt, new Date('2026-06-09T13:59:59.000Z'))).toBe(false);
    expect(hasSessionRolledOver(resetAt, new Date('2026-06-09T14:00:00.000Z'))).toBe(true);
  });
});
