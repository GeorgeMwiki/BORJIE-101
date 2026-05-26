import { describe, expect, it } from 'vitest';
import {
  buildHealthSnapshot,
  handleHealthRequest,
} from '../routes/health.js';
import type { NightlySweepSummary } from '../types.js';

const NOW_MS = new Date('2026-05-15T03:00:00.000Z').getTime();

function summary(over: Partial<NightlySweepSummary> = {}): NightlySweepSummary {
  return {
    startedAtIso: over.startedAtIso ?? '2026-05-15T02:00:00.000Z',
    finishedAtIso: over.finishedAtIso ?? '2026-05-15T02:01:00.000Z',
    recipesProcessed: over.recipesProcessed ?? 3,
    proposalsEmitted: over.proposalsEmitted ?? 1,
    locksApplied: over.locksApplied ?? 0,
    errored: over.errored ?? 0,
    results: over.results ?? [],
  };
}

describe('buildHealthSnapshot', () => {
  it('reports down when worker is not operational', () => {
    const snap = buildHealthSnapshot({
      state: { lastSummary: null, schedule: '0 2 * * *', operational: false },
      nowMs: NOW_MS,
    });
    expect(snap.status).toBe('down');
  });

  it('reports degraded when no sweep has run yet but operational', () => {
    const snap = buildHealthSnapshot({
      state: { lastSummary: null, schedule: '0 2 * * *', operational: true },
      nowMs: NOW_MS,
    });
    expect(snap.status).toBe('degraded');
  });

  it('reports ok when a recent successful sweep exists', () => {
    const snap = buildHealthSnapshot({
      state: { lastSummary: summary(), schedule: '0 2 * * *', operational: true },
      nowMs: NOW_MS,
    });
    expect(snap.status).toBe('ok');
  });

  it('reports degraded when the last sweep had errors', () => {
    const snap = buildHealthSnapshot({
      state: {
        lastSummary: summary({ errored: 2 }),
        schedule: '0 2 * * *',
        operational: true,
      },
      nowMs: NOW_MS,
    });
    expect(snap.status).toBe('degraded');
  });

  it('reports degraded when the last sweep is stale (> 26h)', () => {
    const snap = buildHealthSnapshot({
      state: {
        lastSummary: summary({ finishedAtIso: '2026-05-12T02:01:00.000Z' }),
        schedule: '0 2 * * *',
        operational: true,
      },
      nowMs: NOW_MS,
    });
    expect(snap.status).toBe('degraded');
  });
});

describe('handleHealthRequest', () => {
  it('returns 200 + ok body when healthy', () => {
    const res = handleHealthRequest({
      lastSummary: summary({
        finishedAtIso: new Date(Date.now() - 60_000).toISOString(),
      }),
      schedule: '0 2 * * *',
      operational: true,
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('returns 503 + body when degraded', () => {
    const res = handleHealthRequest({
      lastSummary: null,
      schedule: '0 2 * * *',
      operational: true,
    });
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('degraded');
  });
});
