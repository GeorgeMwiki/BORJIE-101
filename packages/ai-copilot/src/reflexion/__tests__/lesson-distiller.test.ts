/**
 * Lesson distiller tests — Reflexion (Phase E P8 Gap 7).
 *
 * Behaviours under test:
 *   - Returns null for uneventful turns and clean high-score successes.
 *   - Emits a lesson for failures, partials, low-score "successes",
 *     and successes whose trace contains an error observation.
 *   - The lesson respects the LESSON_MAX_CHARS cap.
 *   - Determinism: deps.now and deps.id are honoured.
 */

import { describe, it, expect } from 'vitest';
import { distillLesson } from '../lesson-distiller.js';
import { LESSON_MAX_CHARS } from '../types.js';
import { buildOutcome, buildStep, buildTrace, buildVerdict } from './helpers.js';

describe('distillLesson', () => {
  const fixedNow = () => new Date('2026-05-23T12:34:56.000Z');
  const fixedId = () => 'lsn_fixed';

  it('returns null when outcome is uneventful', () => {
    const lesson = distillLesson(
      buildTrace(),
      buildOutcome('uneventful'),
      buildVerdict({ score: 0.95, verdict: 'pass' }),
      { now: fixedNow, id: fixedId },
    );
    expect(lesson).toBeNull();
  });

  it('returns null for a clean high-score success with no error signal', () => {
    const cleanTrace = buildTrace({
      steps: [
        buildStep({ index: 0, thought: 'all good' }),
        buildStep({ index: 1, thought: 'done', observation: 'ok' }),
      ],
    });
    const lesson = distillLesson(
      cleanTrace,
      buildOutcome('success'),
      buildVerdict({ score: 0.92, verdict: 'pass' }),
      { now: fixedNow, id: fixedId },
    );
    expect(lesson).toBeNull();
  });

  it('emits a lesson on failure with judge rationale embedded', () => {
    const lesson = distillLesson(
      buildTrace(),
      buildOutcome('failure'),
      buildVerdict({ score: 0.3, verdict: 'fail', rationale: 'wrong tool' }),
      { now: fixedNow, id: fixedId },
    );
    expect(lesson).not.toBeNull();
    expect(lesson!.id).toBe('lsn_fixed');
    expect(lesson!.tenantId).toBe('t1');
    expect(lesson!.taskTag).toBe('maintenance.triage');
    expect(lesson!.createdAt).toBe('2026-05-23T12:34:56.000Z');
    expect(lesson!.lesson).toContain('Avoid');
    expect(lesson!.lesson).toContain('Judge noted: wrong tool');
    expect(lesson!.evidence).toMatch(/^trace:trc_\d+ \/ step 1 \/ tool=kb\.search$/);
  });

  it('emits a lesson when a "successful" turn has a judge score below the threshold', () => {
    const lesson = distillLesson(
      buildTrace(),
      buildOutcome('success'),
      buildVerdict({ score: 0.55, verdict: 'pass' }),
      { now: fixedNow, id: fixedId },
    );
    expect(lesson).not.toBeNull();
    expect(lesson!.lesson).toContain('Re-check');
  });

  it('emits a lesson when a success trace contains an error observation', () => {
    const noisyTrace = buildTrace({
      steps: [
        buildStep({ index: 0, thought: 'try' }),
        buildStep({ index: 1, thought: 'call api', tool: 'api', observation: 'timeout occurred' }),
        buildStep({ index: 2, thought: 'recovered' }),
      ],
    });
    const lesson = distillLesson(
      noisyTrace,
      buildOutcome('success'),
      buildVerdict({ score: 0.95, verdict: 'pass' }),
      { now: fixedNow, id: fixedId },
    );
    expect(lesson).not.toBeNull();
    expect(lesson!.evidence).toContain('tool=api');
  });

  it('truncates the lesson text at LESSON_MAX_CHARS', () => {
    const longRationale = 'x'.repeat(LESSON_MAX_CHARS * 2);
    const lesson = distillLesson(
      buildTrace(),
      buildOutcome('failure'),
      buildVerdict({ score: 0.1, verdict: 'fail', rationale: longRationale }),
      { now: fixedNow, id: fixedId },
    );
    expect(lesson).not.toBeNull();
    expect(lesson!.lesson.length).toBeLessThanOrEqual(LESSON_MAX_CHARS);
  });

  it('returns null when the trace has no steps', () => {
    const empty = buildTrace({ steps: [] });
    const lesson = distillLesson(
      empty,
      buildOutcome('failure'),
      buildVerdict(),
      { now: fixedNow, id: fixedId },
    );
    expect(lesson).toBeNull();
  });
});
