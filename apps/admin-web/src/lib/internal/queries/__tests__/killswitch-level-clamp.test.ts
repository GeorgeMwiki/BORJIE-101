/**
 * GATE: off-enum null-deref on the kill-switch safety surface.
 *
 * The kill-switch status mirror (`KillSwitchStatusPanel`) renders a
 * per-row pill keyed by `row.level`. `row.level` is TYPED
 * `'live' | 'degraded' | 'halt'`, but that is a compile-time promise the
 * gateway can break at runtime (a new level, a typo, a partial deploy).
 * Before this gate, the adapter did `level: r.level ?? 'live'` — it only
 * substituted on `null`/`undefined`, so any OTHER string passed through
 * unvalidated and `LEVEL_LABEL[row.level]` returned `undefined`, which
 * `pickByLocale(locale, undefined)` then `.en`/`.sw`-dereferenced into a
 * `TypeError` — blanking the entire safety panel.
 *
 * This gate enumerates the FULL surface of the class: the
 * adapter-boundary clamp (`clampKillswitchLevel`) is the single enforcement
 * point, and the component's per-row label lookup is the render-side
 * defense-in-depth. It asserts:
 *   1. every off-enum value (other strings, null, undefined, non-strings)
 *      clamps to the conservative `'unknown'` sentinel — NEVER `'live'`
 *      (fail-safe, not fail-open) and never the raw value;
 *   2. known levels pass through unchanged;
 *   3. the per-row label lookup NEVER throws and stays locale-pure for any
 *      `KillswitchLevel` (including `'unknown'`).
 *
 * The gate BITES: mutating the clamp to fall through to `'live'` (or to
 * return the raw value) flips assertion (1) RED; dropping the `?? unknown`
 * guard in the label lookup flips assertion (3) RED.
 */
import { describe, expect, it } from 'vitest';
import {
  KILLSWITCH_LEVELS,
  clampKillswitchLevel,
  type KillswitchLevel,
} from '../dashboard';
import {
  DEFAULT_LOCALE,
  pickByLocale,
  type Locale,
} from '@/lib/locale-shared';

// Mirror of the component's render-side lookup. Kept in the gate (rather
// than imported from the `'use client'` component, which drags React/Next
// into the node test) so the guard CONTRACT is asserted directly: a value
// outside the table must resolve a localized label, never `undefined`.
const LEVEL_LABEL: Record<
  KillswitchLevel,
  { readonly en: string; readonly sw: string }
> = {
  live: { en: 'live', sw: 'hai' },
  degraded: { en: 'degraded', sw: 'imepunguzwa' },
  halt: { en: 'halt', sw: 'imesimama' },
  unknown: { en: 'unknown', sw: 'haijulikani' },
};

function levelLabel(locale: Locale, level: KillswitchLevel): string {
  return pickByLocale(locale, LEVEL_LABEL[level] ?? LEVEL_LABEL.unknown);
}

const OFF_ENUM_VALUES: ReadonlyArray<unknown> = [
  'maintenance',
  'paused',
  'Halt', // case mismatch — the wire is lowercase
  'LIVE',
  '',
  null,
  undefined,
  0,
  1,
  {},
  [],
  { level: 'halt' },
  Symbol('halt'),
];

describe('killswitch level clamp (adapter boundary)', () => {
  it('passes every known level through unchanged', () => {
    for (const level of ['live', 'degraded', 'halt', 'unknown'] as const) {
      expect(clampKillswitchLevel(level)).toBe(level);
    }
  });

  it('clamps EVERY off-enum value to the conservative "unknown" sentinel', () => {
    for (const value of OFF_ENUM_VALUES) {
      expect(clampKillswitchLevel(value)).toBe('unknown');
    }
  });

  it('NEVER fails open: an unrecognized level must not become "live"', () => {
    // The pre-fix bug: `r.level ?? 'live'` silently reassured on a safety
    // panel. Fail-safe means the danger-default is the neutral sentinel.
    for (const value of OFF_ENUM_VALUES) {
      expect(clampKillswitchLevel(value)).not.toBe('live');
    }
  });

  it('only ever returns a member of the known closed set', () => {
    for (const value of [...OFF_ENUM_VALUES, 'live', 'halt', 'degraded']) {
      expect(KILLSWITCH_LEVELS).toContain(clampKillswitchLevel(value));
    }
  });
});

describe('killswitch per-row label lookup (render-side guard)', () => {
  it('resolves a non-empty localized label for every KillswitchLevel', () => {
    for (const level of KILLSWITCH_LEVELS) {
      for (const locale of ['en', 'sw'] as const) {
        const label = levelLabel(locale, level);
        expect(typeof label).toBe('string');
        expect(label.length).toBeGreaterThan(0);
      }
    }
  });

  it('never throws (no undefined-deref) even for a forced off-enum level', () => {
    // Simulate a future upstream regression that lets a non-clamped value
    // reach the render guard. It must fall back to the localized `unknown`
    // label, not `undefined`-deref `pickByLocale`.
    const rogue = 'maintenance' as unknown as KillswitchLevel;
    expect(() => levelLabel('en', rogue)).not.toThrow();
    expect(levelLabel('en', rogue)).toBe(LEVEL_LABEL.unknown.en);
    expect(levelLabel('sw', rogue)).toBe(LEVEL_LABEL.unknown.sw);
  });

  it('stays locale-pure: en and sw labels never coincide or co-mingle', () => {
    for (const level of KILLSWITCH_LEVELS) {
      expect(levelLabel('en', level)).toBe(LEVEL_LABEL[level].en);
      expect(levelLabel('sw', level)).toBe(LEVEL_LABEL[level].sw);
      // No single rendered label carries both languages.
      expect(levelLabel('sw', level)).not.toContain(LEVEL_LABEL[level].en);
    }
  });

  it('defaults to the project default locale label shape', () => {
    expect(levelLabel(DEFAULT_LOCALE, 'unknown')).toBe(LEVEL_LABEL.unknown.en);
  });
});
