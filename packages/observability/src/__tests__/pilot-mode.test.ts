/**
 * pilot-mode.ts — flag detection + context-injection tests.
 *
 * Coverage focus:
 *
 *   - Flag detection: each of the three env names flips the result.
 *   - Context build: cohort/user/replay tags surface ONLY when pilot
 *     mode is on AND the input is a non-empty trimmed string.
 *   - Sample-rate resolution: pilot mode forces 1.0 by default,
 *     baseline returns 0.1 by default, callers can override either.
 *   - Immutability: returned bundles are frozen so callers cannot
 *     mutate the cached context.
 */

import { afterEach, describe, expect, it } from 'vitest';

import {
  PILOT_MODE_ENV_NAMES,
  buildPilotEventContext,
  isPilotMode,
  readDefaultPilotCohort,
  resolvePilotSampleRate,
} from '../pilot-mode.js';

const PROCESS_KEYS = [
  ...PILOT_MODE_ENV_NAMES,
  'BORJIE_PILOT_COHORT',
] as const;

afterEach(() => {
  for (const key of PROCESS_KEYS) {
    delete process.env[key];
  }
});

describe('isPilotMode', () => {
  it('returns false when no pilot env var is set', () => {
    expect(isPilotMode()).toBe(false);
    expect(isPilotMode({})).toBe(false);
  });

  it('returns true for each known env name (server, web, mobile)', () => {
    for (const name of PILOT_MODE_ENV_NAMES) {
      const source = { [name]: 'true' } as const;
      expect(isPilotMode(source)).toBe(true);
    }
  });

  it('parses truthy values case-insensitively and rejects others', () => {
    for (const truthy of ['1', 'true', 'TRUE', 'yes', 'YES', '  True  ']) {
      expect(isPilotMode({ BORJIE_PILOT_MODE: truthy })).toBe(true);
    }
    for (const falsy of ['0', 'false', 'off', 'no', '', '   ', 'maybe']) {
      expect(isPilotMode({ BORJIE_PILOT_MODE: falsy })).toBe(false);
    }
  });

  it('falls back to process.env when no source is supplied', () => {
    expect(isPilotMode()).toBe(false);
    process.env.BORJIE_PILOT_MODE = 'true';
    expect(isPilotMode()).toBe(true);
  });
});

describe('buildPilotEventContext', () => {
  it('returns empty tags + baseline rate when pilot mode is OFF', () => {
    const ctx = buildPilotEventContext(
      { pilotUserId: 'usr-1', pilotCohort: 'cohort-a' },
      { source: {} },
    );
    expect(ctx.tags).toEqual({});
    expect(ctx.extra).toEqual({});
    expect(ctx.tracesSampleRate).toBe(0.1);
  });

  it('injects cohort/user/replay tags when pilot mode is ON', () => {
    const ctx = buildPilotEventContext(
      {
        pilotUserId: 'usr-42',
        pilotCohort: 'tanzanite-alpha',
        replaySessionId: 'sess-abc',
      },
      { source: { BORJIE_PILOT_MODE: '1' } },
    );
    expect(ctx.tags).toEqual({
      pilot_mode: 'true',
      pilot_user_id: 'usr-42',
      pilot_cohort: 'tanzanite-alpha',
    });
    expect(ctx.extra).toEqual({ replay_session_id: 'sess-abc' });
    expect(ctx.tracesSampleRate).toBe(1.0);
  });

  it('drops empty / whitespace input fields silently', () => {
    const ctx = buildPilotEventContext(
      {
        pilotUserId: '  ',
        pilotCohort: '',
        replaySessionId: undefined,
      },
      { source: { BORJIE_PILOT_MODE: 'yes' } },
    );
    expect(ctx.tags).toEqual({ pilot_mode: 'true' });
    expect(ctx.extra).toEqual({});
  });

  it('honours caller-supplied sample-rate overrides + clamps to [0,1]', () => {
    const high = buildPilotEventContext(
      {},
      { source: { BORJIE_PILOT_MODE: 'true' }, pilotSampleRate: 1.5 },
    );
    expect(high.tracesSampleRate).toBe(1);

    const negative = buildPilotEventContext(
      {},
      { source: {}, baselineSampleRate: -0.2 },
    );
    expect(negative.tracesSampleRate).toBe(0);

    const custom = buildPilotEventContext(
      {},
      {
        source: { BORJIE_PILOT_MODE: 'true' },
        pilotSampleRate: 0.5,
      },
    );
    expect(custom.tracesSampleRate).toBe(0.5);
  });

  it('returns frozen objects so callers cannot mutate the bundle', () => {
    const ctx = buildPilotEventContext(
      { pilotUserId: 'u', pilotCohort: 'c' },
      { source: { BORJIE_PILOT_MODE: 'true' } },
    );
    expect(Object.isFrozen(ctx)).toBe(true);
    expect(Object.isFrozen(ctx.tags)).toBe(true);
    expect(Object.isFrozen(ctx.extra)).toBe(true);
  });
});

describe('resolvePilotSampleRate', () => {
  it('returns the pilot rate when pilot mode is ON', () => {
    expect(
      resolvePilotSampleRate({ source: { BORJIE_PILOT_MODE: 'true' } }),
    ).toBe(1);
  });

  it('returns the baseline rate when pilot mode is OFF', () => {
    expect(resolvePilotSampleRate({ source: {} })).toBe(0.1);
  });
});

describe('readDefaultPilotCohort', () => {
  it('returns trimmed cohort when set', () => {
    expect(
      readDefaultPilotCohort({ BORJIE_PILOT_COHORT: '  ferengi-beta ' }),
    ).toBe('ferengi-beta');
  });

  it('returns undefined when unset / empty', () => {
    expect(readDefaultPilotCohort({})).toBeUndefined();
    expect(readDefaultPilotCohort({ BORJIE_PILOT_COHORT: '   ' })).toBeUndefined();
  });
});
