/**
 * Reflective-store signal-sink tests (LP-05).
 *
 * Verifies the orphaned memory-v2 reflective store is correctly fed from a
 * learning signal: positive signals reinforce, negative signals produce
 * concrete adjustments, the self-score maps reward → [0,1], tenant/user
 * scope is carried, and a store failure is swallowed (best-effort sink).
 */

import { describe, it, expect } from 'vitest';

import {
  buildReflectiveNoteFromSignal,
  createReflectiveSignalSink,
  type ReflectiveNoteLike,
  type ReflectiveStoreLike,
  type SignalLike,
} from '../reflective-signal-sink.js';

function signal(overrides: Partial<SignalLike> = {}): SignalLike {
  return {
    signalHash: 'h',
    actionRef: 'act-1',
    actionKind: 'decide',
    reward: 0.8,
    components: {
      sla: 0,
      override: 0,
      complaint: 0,
      regulator: 0,
      cost: 0,
      satisfaction: 0,
    },
    tenantScope: 'org',
    subjectUserId: null,
    subjectOrgId: 'tenant-9',
    capturedAt: '2026-06-03T00:00:00.000Z',
    ...overrides,
  };
}

const deps = {
  store: { async upsertNote(n: ReflectiveNoteLike) { return n; } },
  idFactory: () => 'note-1',
  now: () => '2026-06-03T01:00:00.000Z',
};

describe('buildReflectiveNoteFromSignal', () => {
  it('maps a positive reward to a high self-score + reinforcing adjustment', () => {
    const note = buildReflectiveNoteFromSignal(signal({ reward: 1 }), deps);
    expect(note.selfScore).toBe(1); // reward 1 → (1+1)/2
    expect(note.insight).toMatch(/strong positive outcome/);
    expect(note.adjustments[0]).toMatch(/Reinforce/);
  });

  it('maps a neutral reward to a 0.5 self-score', () => {
    const note = buildReflectiveNoteFromSignal(signal({ reward: 0 }), deps);
    expect(note.selfScore).toBe(0.5);
  });

  it('derives concrete adjustments from negative drivers', () => {
    const note = buildReflectiveNoteFromSignal(
      signal({
        reward: -0.4,
        components: {
          sla: -1,
          override: -1,
          complaint: 0,
          regulator: 0,
          cost: 0,
          satisfaction: 0,
        },
      }),
      deps,
    );
    expect(note.selfScore).toBeCloseTo(0.3, 5); // (-0.4+1)/2
    expect(note.insight).toMatch(/negative outcome/);
    // The two negative drivers (SLA + override) produce adjustments.
    expect(note.adjustments.length).toBe(2);
    expect(note.adjustments.join(' ')).toMatch(/turnaround|override/i);
  });

  it('carries org scope into tenantId and null userId', () => {
    const note = buildReflectiveNoteFromSignal(signal(), deps);
    expect(note.tenantId).toBe('tenant-9');
    expect(note.userId).toBeNull();
  });

  it('carries user scope + falls back to platformTenantId', () => {
    const note = buildReflectiveNoteFromSignal(
      signal({ tenantScope: 'user', subjectUserId: 'owner-3', subjectOrgId: null }),
      { ...deps, platformTenantId: 'platform' },
    );
    expect(note.userId).toBe('owner-3');
    expect(note.tenantId).toBe('platform');
  });

  it('sets a zero-width reflection period at the capture time', () => {
    const note = buildReflectiveNoteFromSignal(signal(), deps);
    expect(note.periodStart).toBe('2026-06-03T00:00:00.000Z');
    expect(note.periodEnd).toBe('2026-06-03T00:00:00.000Z');
  });
});

describe('createReflectiveSignalSink', () => {
  it('upserts a note and returns true (emitter adapter contract)', async () => {
    const written: ReflectiveNoteLike[] = [];
    const store: ReflectiveStoreLike = {
      async upsertNote(n) {
        written.push(n);
        return n;
      },
    };
    const sink = createReflectiveSignalSink({ ...deps, store });
    const ok = await sink(signal());
    expect(ok).toBe(true);
    expect(written).toHaveLength(1);
    expect(written[0].id).toBe('note-1');
  });

  it('swallows a store failure and returns false (best-effort, never throws)', async () => {
    const store: ReflectiveStoreLike = {
      async upsertNote() {
        throw new Error('store down');
      },
    };
    const sink = createReflectiveSignalSink({ ...deps, store });
    await expect(sink(signal())).resolves.toBe(false);
  });
});
