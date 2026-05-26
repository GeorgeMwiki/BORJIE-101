/**
 * metric-computer.test — covers the bucketing rules:
 *   - first-submit acceptance is the per-artifact earliest-event check.
 *   - revision_rate counts distinct artifacts with any `revised` event.
 *   - regulator_flag_count is a literal event count.
 *   - section_revision_rates divides by composition count (not by total
 *     revision count) so 1 revised section out of 10 compositions = 10 %.
 *   - composition_count = 0 yields zeros (no division-by-zero leak).
 */

import { describe, it, expect } from 'vitest';
import { computeRecipeStats } from '../aggregator/metric-computer.js';
import type { DocFeedbackEventRow } from '../types.js';

const baseRow = (overrides: Partial<DocFeedbackEventRow>): DocFeedbackEventRow => ({
  id: overrides.id ?? 'e1',
  artifact_id: overrides.artifact_id ?? 'a1',
  tenant_id: overrides.tenant_id ?? 't1',
  feedback_kind: overrides.feedback_kind ?? 'accepted',
  section_path: overrides.section_path ?? null,
  detail: overrides.detail ?? {},
  recorded_at: overrides.recorded_at ?? '2026-05-01T10:00:00Z',
});

describe('computeRecipeStats', () => {
  const baseInput = {
    recipe_id: 'tumemadini_monthly_return',
    recipe_version: 1,
    tenant_id: 't1',
    window_start_iso: '2026-03-01T00:00:00Z',
    window_end_iso: '2026-05-01T00:00:00Z',
  };

  it('returns zeros when no compositions in window', () => {
    const stats = computeRecipeStats({
      ...baseInput,
      composition_count: 0,
      events: [],
    });
    expect(stats.composition_count).toBe(0);
    expect(stats.first_submit_acceptance_rate).toBe(0);
    expect(stats.revision_rate).toBe(0);
    expect(stats.regulator_flag_count).toBe(0);
    expect(stats.section_revision_rates).toEqual([]);
    expect(stats.avg_time_to_approve_seconds).toBeNull();
  });

  it('treats first event per artifact as the first-submit signal', () => {
    const stats = computeRecipeStats({
      ...baseInput,
      composition_count: 2,
      events: [
        baseRow({ id: 'e1', artifact_id: 'a1', feedback_kind: 'accepted', recorded_at: '2026-04-01T09:00:00Z' }),
        baseRow({ id: 'e2', artifact_id: 'a1', feedback_kind: 'revised', recorded_at: '2026-04-01T10:00:00Z', section_path: 'sections.assays' }),
        baseRow({ id: 'e3', artifact_id: 'a2', feedback_kind: 'revised', recorded_at: '2026-04-02T09:00:00Z', section_path: 'sections.assays' }),
      ],
    });
    // Only a1 was first-accepted. a2's first event was a revision.
    expect(stats.first_submit_acceptance_rate).toBe(0.5);
    // Both a1 and a2 had a revision -> 2/2.
    expect(stats.revision_rate).toBe(1);
  });

  it('counts regulator_flag events literally, not by distinct artifact', () => {
    const stats = computeRecipeStats({
      ...baseInput,
      composition_count: 1,
      events: [
        baseRow({ id: 'e1', artifact_id: 'a1', feedback_kind: 'regulator_flag', recorded_at: '2026-04-01T09:00:00Z' }),
        baseRow({ id: 'e2', artifact_id: 'a1', feedback_kind: 'regulator_flag', recorded_at: '2026-04-02T09:00:00Z' }),
      ],
    });
    expect(stats.regulator_flag_count).toBe(2);
  });

  it('reports per-section revision rates and sorts by descending rate', () => {
    const stats = computeRecipeStats({
      ...baseInput,
      composition_count: 10,
      events: [
        // section.a revised in 3 distinct artifacts (30%)
        baseRow({ id: 'e1', artifact_id: 'a1', feedback_kind: 'revised', section_path: 'section.a' }),
        baseRow({ id: 'e2', artifact_id: 'a2', feedback_kind: 'revised', section_path: 'section.a' }),
        baseRow({ id: 'e3', artifact_id: 'a3', feedback_kind: 'revised', section_path: 'section.a' }),
        // section.b revised in 1 distinct artifact (10%)
        baseRow({ id: 'e4', artifact_id: 'a4', feedback_kind: 'revised', section_path: 'section.b' }),
      ],
    });
    expect(stats.section_revision_rates).toEqual([
      { section_path: 'section.a', revision_rate: 0.3, revision_count: 3 },
      { section_path: 'section.b', revision_rate: 0.1, revision_count: 1 },
    ]);
  });

  it('averages time_to_approve seconds from detail payload', () => {
    const stats = computeRecipeStats({
      ...baseInput,
      composition_count: 2,
      events: [
        baseRow({ feedback_kind: 'time_to_approve', detail: { seconds: 100 } }),
        baseRow({ feedback_kind: 'time_to_approve', detail: { seconds: 200 } }),
      ],
    });
    expect(stats.avg_time_to_approve_seconds).toBe(150);
  });

  it('clamps reading detail.seconds when string number provided', () => {
    const stats = computeRecipeStats({
      ...baseInput,
      composition_count: 1,
      events: [
        baseRow({ feedback_kind: 'time_to_approve', detail: { seconds: '42' } }),
      ],
    });
    expect(stats.avg_time_to_approve_seconds).toBe(42);
  });

  it('ignores non-numeric detail.seconds gracefully', () => {
    const stats = computeRecipeStats({
      ...baseInput,
      composition_count: 1,
      events: [
        baseRow({ feedback_kind: 'time_to_approve', detail: { seconds: 'abc' } }),
      ],
    });
    expect(stats.avg_time_to_approve_seconds).toBeNull();
  });

  it('treats negative composition_count as zero', () => {
    const stats = computeRecipeStats({
      ...baseInput,
      composition_count: -5,
      events: [],
    });
    expect(stats.composition_count).toBe(0);
  });
});
