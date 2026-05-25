/**
 * Lesson renderer tests — Reflexion (Phase E P8 Gap 7).
 *
 * Behaviours under test:
 *   - Empty store → empty string.
 *   - Header + lines for non-empty store.
 *   - Token cap respected — overflowing lessons dropped (LRU by score).
 *   - Lesson cap respected.
 *   - Tenant + task-tag isolation honoured at the renderer layer.
 *   - Pathological tiny token budget → empty string.
 */

import { describe, it, expect } from 'vitest';
import { renderLessons } from '../lesson-renderer.js';
import { createInMemoryLessonStore } from '../lesson-store.js';
import {
  CHARS_PER_TOKEN,
  DEFAULT_MAX_TOKENS,
  type Lesson,
  type LessonStore,
} from '../types.js';

function lesson(overrides: Partial<Lesson> = {}): Lesson {
  return {
    id: overrides.id ?? 'lsn_1',
    tenantId: overrides.tenantId ?? 't1',
    taskTag: overrides.taskTag ?? 'maintenance.triage',
    lesson: overrides.lesson ?? 'Tighten the tool-retry pattern.',
    evidence: overrides.evidence ?? 'trace:abc / step 2',
    createdAt: overrides.createdAt ?? '2026-05-23T10:00:00.000Z',
    recencyScore: overrides.recencyScore ?? 0.9,
  };
}

async function seed(store: LessonStore, lessons: ReadonlyArray<Lesson>): Promise<void> {
  for (const l of lessons) {
    await store.put(l);
  }
}

describe('renderLessons', () => {
  it('returns empty string when the store has no lessons', async () => {
    const store = createInMemoryLessonStore();
    const out = await renderLessons(store, 't1', 'maintenance.triage');
    expect(out).toBe('');
  });

  it('renders header + bullets when lessons exist', async () => {
    const store = createInMemoryLessonStore();
    await seed(store, [
      lesson({ id: 'a', lesson: 'Avoid retrying timeouts.', recencyScore: 0.9 }),
      lesson({ id: 'b', lesson: 'Prefer the search tool first.', recencyScore: 0.8 }),
    ]);
    const out = await renderLessons(store, 't1', 'maintenance.triage');
    expect(out).toContain('## Lessons from prior turns');
    expect(out).toContain('[lesson a] Avoid retrying timeouts.');
    expect(out).toContain('[lesson b] Prefer the search tool first.');
    // higher score listed first
    expect(out.indexOf('[lesson a]')).toBeLessThan(out.indexOf('[lesson b]'));
  });

  it('respects the maxLessons cap', async () => {
    const store = createInMemoryLessonStore();
    await seed(
      store,
      Array.from({ length: 8 }, (_, i) =>
        lesson({ id: `l${i}`, lesson: `Lesson body ${i}.`, recencyScore: 1 - i * 0.05 }),
      ),
    );
    const out = await renderLessons(store, 't1', 'maintenance.triage', { maxLessons: 3 });
    const matches = out.match(/\[lesson l\d+\]/g) ?? [];
    expect(matches).toHaveLength(3);
  });

  it('respects the maxTokens cap (LRU evicts low-recency lessons)', async () => {
    const store = createInMemoryLessonStore();
    // Each lesson is intentionally long.
    const lessons = Array.from({ length: 10 }, (_, i) =>
      lesson({
        id: `l${i}`,
        lesson: `Long lesson body that costs a number of tokens index ${i}.`,
        evidence: `trace:t${i} / step 1`,
        recencyScore: 1 - i * 0.05,
      }),
    );
    await seed(store, lessons);
    const tightCap = 40;
    const out = await renderLessons(store, 't1', 'maintenance.triage', {
      maxTokens: tightCap,
    });
    expect(out).not.toBe('');
    const tokenEstimate = Math.ceil(out.length / CHARS_PER_TOKEN);
    expect(tokenEstimate).toBeLessThanOrEqual(tightCap);
    // The high-recency lesson MUST be present.
    expect(out).toContain('[lesson l0]');
    // The lowest-recency lesson MUST be evicted.
    expect(out).not.toContain('[lesson l9]');
  });

  it('returns empty string when the token cap is smaller than the header', async () => {
    const store = createInMemoryLessonStore();
    await seed(store, [lesson()]);
    const out = await renderLessons(store, 't1', 'maintenance.triage', { maxTokens: 2 });
    expect(out).toBe('');
  });

  it('honours tenant isolation at the renderer layer', async () => {
    const store = createInMemoryLessonStore();
    await seed(store, [
      lesson({ id: 'a', tenantId: 'tenantA', lesson: 'A-specific lesson.' }),
      lesson({ id: 'b', tenantId: 'tenantB', lesson: 'B-specific lesson.' }),
    ]);
    const outA = await renderLessons(store, 'tenantA', 'maintenance.triage');
    const outB = await renderLessons(store, 'tenantB', 'maintenance.triage');
    expect(outA).toContain('[lesson a]');
    expect(outA).not.toContain('[lesson b]');
    expect(outB).toContain('[lesson b]');
    expect(outB).not.toContain('[lesson a]');
  });

  it('honours task-tag isolation', async () => {
    const store = createInMemoryLessonStore();
    await seed(store, [
      lesson({ id: 'a', taskTag: 'maintenance.triage', lesson: 'Triage lesson.' }),
      lesson({ id: 'b', taskTag: 'owner.report', lesson: 'Report lesson.' }),
    ]);
    const triage = await renderLessons(store, 't1', 'maintenance.triage');
    expect(triage).toContain('[lesson a]');
    expect(triage).not.toContain('[lesson b]');
  });

  it('uses the default token cap when no options provided', async () => {
    const store = createInMemoryLessonStore();
    await seed(store, [lesson()]);
    const out = await renderLessons(store, 't1', 'maintenance.triage');
    const tokenEstimate = Math.ceil(out.length / CHARS_PER_TOKEN);
    expect(tokenEstimate).toBeLessThanOrEqual(DEFAULT_MAX_TOKENS);
  });
});
