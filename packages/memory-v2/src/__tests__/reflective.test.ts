import { describe, expect, it } from 'vitest';
import {
  createInMemoryReflectiveStore,
  reflect,
} from '../reflective/store-inmemory.js';
import type { Brain } from '../types.js';

const TENANT = 'tenant-1';

describe('reflective store', () => {
  it('upserts and reads back a note', async () => {
    const store = createInMemoryReflectiveStore();
    await store.upsertNote({
      id: 'note-1',
      tenantId: TENANT,
      userId: 'u1',
      insight: 'insight',
      adjustments: ['a1'],
      periodStart: '2026-05-01T00:00:00.000Z',
      periodEnd: '2026-05-08T00:00:00.000Z',
      selfScore: 0.7,
      createdAt: '2026-05-08T00:00:00.000Z',
    });
    const latest = await store.getLatestForTenant(TENANT);
    expect(latest?.id).toBe('note-1');
  });

  it('returns the most-recent note per tenant', async () => {
    const store = createInMemoryReflectiveStore();
    await store.upsertNote({
      id: 'older',
      tenantId: TENANT,
      userId: null,
      insight: '',
      adjustments: [],
      periodStart: '2026-05-01T00:00:00.000Z',
      periodEnd: '2026-05-08T00:00:00.000Z',
      selfScore: 0.5,
      createdAt: '2026-05-08T00:00:00.000Z',
    });
    await store.upsertNote({
      id: 'newer',
      tenantId: TENANT,
      userId: null,
      insight: '',
      adjustments: [],
      periodStart: '2026-05-08T00:00:00.000Z',
      periodEnd: '2026-05-15T00:00:00.000Z',
      selfScore: 0.5,
      createdAt: '2026-05-15T00:00:00.000Z',
    });
    const latest = await store.getLatestForTenant(TENANT);
    expect(latest?.id).toBe('newer');
  });

  it('returns null when no notes exist', async () => {
    const store = createInMemoryReflectiveStore();
    expect(await store.getLatestForTenant(TENANT)).toBeNull();
  });
});

describe('reflect()', () => {
  it('falls back to heuristic when no brain supplied', async () => {
    const note = await reflect({
      tenantId: TENANT,
      userId: 'u1',
      transcript: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
      ],
      periodStart: '2026-05-01T00:00:00.000Z',
      periodEnd: '2026-05-08T00:00:00.000Z',
      idFactory: () => 'note-1',
      now: () => '2026-05-08T00:00:00.000Z',
    });
    expect(note.insight).toContain('Heuristic summary');
    expect(note.adjustments.length).toBeGreaterThan(0);
  });

  it('uses brain output when supplied + parseable', async () => {
    const brain: Brain = {
      async summarise() {
        return JSON.stringify({
          insight: 'brain insight',
          adjustments: ['x', 'y'],
          self_score: 0.75,
        });
      },
    };
    const note = await reflect({
      tenantId: TENANT,
      userId: 'u1',
      transcript: [
        { role: 'user', content: 'hi' },
        { role: 'assistant', content: 'hello' },
      ],
      periodStart: '2026-05-01T00:00:00.000Z',
      periodEnd: '2026-05-08T00:00:00.000Z',
      idFactory: () => 'note-1',
      now: () => '2026-05-08T00:00:00.000Z',
      brain,
    });
    expect(note.insight).toBe('brain insight');
    expect(note.adjustments).toEqual(['x', 'y']);
    expect(note.selfScore).toBeCloseTo(0.75, 5);
  });

  it('falls back to heuristic when brain output is non-JSON', async () => {
    const brain: Brain = {
      async summarise() {
        return 'not json at all';
      },
    };
    const note = await reflect({
      tenantId: TENANT,
      userId: 'u1',
      transcript: [{ role: 'user', content: 'hi' }],
      periodStart: '2026-05-01T00:00:00.000Z',
      periodEnd: '2026-05-08T00:00:00.000Z',
      idFactory: () => 'note-1',
      now: () => '2026-05-08T00:00:00.000Z',
      brain,
    });
    expect(note.insight).toContain('Heuristic summary');
  });

  it('clamps brain selfScore into [0, 1]', async () => {
    const brain: Brain = {
      async summarise() {
        return JSON.stringify({
          insight: 'ok',
          adjustments: [],
          self_score: 2.5,
        });
      },
    };
    const note = await reflect({
      tenantId: TENANT,
      userId: null,
      transcript: [{ role: 'user', content: 'hi' }],
      periodStart: '2026-05-01T00:00:00.000Z',
      periodEnd: '2026-05-08T00:00:00.000Z',
      idFactory: () => 'note-1',
      now: () => '2026-05-08T00:00:00.000Z',
      brain,
    });
    expect(note.selfScore).toBeLessThanOrEqual(1);
    expect(note.selfScore).toBeGreaterThanOrEqual(0);
  });

  it('returns a note even on empty transcript', async () => {
    const note = await reflect({
      tenantId: TENANT,
      userId: null,
      transcript: [],
      periodStart: '2026-05-01T00:00:00.000Z',
      periodEnd: '2026-05-08T00:00:00.000Z',
      idFactory: () => 'note-1',
      now: () => '2026-05-08T00:00:00.000Z',
    });
    expect(note.insight).toBeTruthy();
  });
});
