/**
 * Lesson store tests — Reflexion (Phase E P8 Gap 7).
 *
 * Behaviours under test:
 *   - Tenant isolation: lessons in tenant A are invisible to tenant B.
 *   - Task-tag isolation within a tenant.
 *   - Duplicate text bumps recencyScore (capped at 1.0) without
 *     mutating the original record.
 *   - recent() honours the limit and sorts by recencyScore desc.
 *   - clear() wipes everything.
 */

import { describe, it, expect } from 'vitest';
import { createInMemoryLessonStore } from '../lesson-store.js';
import type { Lesson } from '../types.js';

function lesson(overrides: Partial<Lesson> = {}): Lesson {
  return {
    id: overrides.id ?? 'lsn_1',
    tenantId: overrides.tenantId ?? 't1',
    taskTag: overrides.taskTag ?? 'maintenance.triage',
    lesson: overrides.lesson ?? 'Avoid retrying the same failing tool twice.',
    evidence: overrides.evidence ?? 'trace:t1 / step 2',
    createdAt: overrides.createdAt ?? '2026-05-23T10:00:00.000Z',
    recencyScore: overrides.recencyScore ?? 0.9,
  };
}

describe('createInMemoryLessonStore', () => {
  it('isolates lessons by tenant', async () => {
    const store = createInMemoryLessonStore();
    await store.put(lesson({ id: 'a', tenantId: 'tenantA' }));
    await store.put(lesson({ id: 'b', tenantId: 'tenantB' }));
    const forA = await store.recent('tenantA', 'maintenance.triage', 10);
    const forB = await store.recent('tenantB', 'maintenance.triage', 10);
    expect(forA.map((l) => l.id)).toEqual(['a']);
    expect(forB.map((l) => l.id)).toEqual(['b']);
  });

  it('isolates lessons by task tag within a tenant', async () => {
    const store = createInMemoryLessonStore();
    await store.put(lesson({ id: 'a', taskTag: 'maintenance.triage' }));
    await store.put(lesson({ id: 'b', taskTag: 'owner.report' }));
    const triage = await store.recent('t1', 'maintenance.triage', 10);
    const report = await store.recent('t1', 'owner.report', 10);
    expect(triage.map((l) => l.id)).toEqual(['a']);
    expect(report.map((l) => l.id)).toEqual(['b']);
  });

  it('returns lessons sorted by recencyScore descending', async () => {
    const store = createInMemoryLessonStore();
    await store.put(lesson({ id: 'low', lesson: 'low score one', recencyScore: 0.3 }));
    await store.put(lesson({ id: 'high', lesson: 'high score one', recencyScore: 0.95 }));
    await store.put(lesson({ id: 'mid', lesson: 'mid score one', recencyScore: 0.6 }));
    const out = await store.recent('t1', 'maintenance.triage', 10);
    expect(out.map((l) => l.id)).toEqual(['high', 'mid', 'low']);
  });

  it('honours the limit argument', async () => {
    const store = createInMemoryLessonStore();
    for (let i = 0; i < 5; i += 1) {
      await store.put(
        lesson({ id: `l${i}`, lesson: `lesson body ${i}`, recencyScore: i / 10 }),
      );
    }
    const out = await store.recent('t1', 'maintenance.triage', 2);
    expect(out).toHaveLength(2);
    expect(out[0]!.id).toBe('l4');
    expect(out[1]!.id).toBe('l3');
  });

  it('bumps recencyScore for duplicate lesson text (capped at 1.0)', async () => {
    const store = createInMemoryLessonStore();
    const a = await store.put(lesson({ id: 'orig', recencyScore: 0.5 }));
    expect(a.recencyScore).toBeCloseTo(0.5);
    const b = await store.put(lesson({ id: 'dup', recencyScore: 0.8 }));
    // duplicate text — returned record keeps the original id but bumps score.
    expect(b.id).toBe('orig');
    expect(b.recencyScore).toBeCloseTo(0.6);
    const c = await store.put(lesson({ id: 'dup2' }));
    expect(c.recencyScore).toBeCloseTo(0.7);
  });

  it('caps recencyScore at 1.0 after repeated bumps', async () => {
    const store = createInMemoryLessonStore();
    await store.put(lesson({ recencyScore: 0.95 }));
    for (let i = 0; i < 10; i += 1) {
      await store.put(lesson());
    }
    const out = await store.recent('t1', 'maintenance.triage', 1);
    expect(out[0]!.recencyScore).toBe(1);
  });

  it('clear() wipes all buckets', async () => {
    const store = createInMemoryLessonStore();
    await store.put(lesson({ tenantId: 'a' }));
    await store.put(lesson({ tenantId: 'b' }));
    await store.clear();
    expect(await store.recent('a', 'maintenance.triage', 10)).toEqual([]);
    expect(await store.recent('b', 'maintenance.triage', 10)).toEqual([]);
  });
});
