/**
 * Full lesson-orchestrator tests — exercise the whole pipeline for
 * three concepts and verify mastery events are flushed.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  startLesson,
  runLesson,
  InMemoryConceptStore,
  StubTutoringDataAdapter,
  TutoringEngineError,
  noopMasteryRecorder,
  tutorActionId,
  summariseLessonOutcomes,
  type MasteryRecorder,
} from '../index.js';

function buildStore() {
  return new InMemoryConceptStore();
}

function buildAdapter() {
  const adapter = new StubTutoringDataAdapter();
  adapter.register('payments-ledger.tenant.month_summary', {
    values: {
      gross_income: 100000,
      op_ex: 35000,
      noi_expected: 65000,
      period_label: 'Sept 2025',
    },
    citations: [
      {
        key: 'gross_income',
        value: 100000,
        sourceRef: 'ledger:abc-123',
      },
      {
        key: 'op_ex',
        value: 35000,
        sourceRef: 'ledger:def-456',
      },
    ],
  });
  adapter.register('payments-ledger.arrears.buckets', {
    values: {
      b1: 12000,
      b2: 7500,
      b3: 4200,
      b4: 9800,
      total: 33500,
      period_label: 'April 2026',
    },
    citations: [],
  });
  adapter.register('occupancy.portfolio.snapshot', {
    values: { total: 50, occupied: 47, rate_pct: 94 },
    citations: [],
  });
  return adapter;
}

describe('runLesson — full lesson for 3 concepts', () => {
  it.each([
    ['net_operating_income'],
    ['arrears_aging'],
    ['occupancy_rate'],
  ])('runs the full lesson for %s and reaches complete', async (slug) => {
    const events = await runLesson(
      { tenantId: 't1', userId: 'u1', conceptSlug: slug },
      {
        conceptStore: buildStore(),
        dataAdapter: buildAdapter(),
        masteryRecorder: noopMasteryRecorder,
      },
    );
    expect(events.length).toBeGreaterThanOrEqual(5);
    const final = events[events.length - 1]!;
    expect(final.step).toBe('complete');
    // Every event should have a message.
    for (const e of events) {
      expect(e.message.length).toBeGreaterThan(0);
    }
  });

  it('grounds worked example with live tenant data', async () => {
    const events = await runLesson(
      {
        tenantId: 't1',
        userId: 'u1',
        conceptSlug: 'net_operating_income',
      },
      {
        conceptStore: buildStore(),
        dataAdapter: buildAdapter(),
      },
    );
    const worked = events.find((e) => e.step === 'worked_example');
    expect(worked).toBeDefined();
    // The numbers from the stub adapter should appear (formatted with
    // thousands separators).
    expect(worked!.message).toMatch(/100,000/);
    expect(worked!.message).toMatch(/35,000/);
    expect(worked!.message).toMatch(/65,000/);
    expect(worked!.message).toMatch(/Sept 2025/);
    expect(worked!.citations?.length).toBe(2);
  });
});

describe('startLesson — manual session', () => {
  it('progresses on correct + incorrect replies and flushes mastery events', async () => {
    const recorded: Array<{
      tenantId: string;
      userId: string;
      actionId: string;
    }> = [];
    const recorder: MasteryRecorder = {
      record: async (input) => {
        recorded.push({
          tenantId: input.tenantId,
          userId: input.userId,
          actionId: tutorActionId(input.conceptSlug, input.outcome),
        });
      },
    };
    const session = await startLesson(
      { tenantId: 't1', userId: 'u1', conceptSlug: 'net_operating_income' },
      {
        conceptStore: buildStore(),
        dataAdapter: buildAdapter(),
        masteryRecorder: recorder,
      },
    );
    let event = session.describeCurrent();
    expect(event.step).toBe('assess');
    event = await session.submit('I have some idea.');
    expect(event.step).toBe('hook');
    event = await session.submit(null); // hook -> explain
    expect(event.step).toBe('explain');
    event = await session.submit(null); // explain -> worked_example
    expect(event.step).toBe('worked_example');
    event = await session.submit(null); // worked_example -> check_understanding
    expect(event.step).toBe('check_understanding');

    // Wrong answer first.
    event = await session.submit('maybe');
    expect(event.step).toBe('check_understanding');
    expect(event.message).toMatch(/Not quite/);

    // Right answer second.
    event = await session.submit('no');
    // Next probe.
    expect(event.step).toBe('check_understanding');

    // Right answer to the next probe.
    event = await session.submit('no');
    expect(event.step).toBe('mastery');
    event = await session.submit(null);
    expect(event.step).toBe('complete');

    // Mastery flushes one incorrect, two correct.
    const summary = summariseLessonOutcomes(recorded, {
      tenantId: 't1',
      userId: 'u1',
      conceptSlug: 'net_operating_income',
    });
    expect(summary.correct).toBe(2);
    expect(summary.incorrect).toBe(1);
  });

  it('"I dont get it" branches into remediate with citation', async () => {
    const session = await startLesson(
      { tenantId: 't1', userId: 'u1', conceptSlug: 'net_operating_income' },
      {
        conceptStore: buildStore(),
        dataAdapter: buildAdapter(),
      },
    );
    let event = session.describeCurrent();
    while (event.step !== 'check_understanding') {
      event = await session.submit(
        event.waitingForLearner ? 'I have some idea.' : null,
      );
    }
    event = await session.submit("I don't get the gross income figure");
    expect(event.step).toBe('remediate');
    // Citation surfaced.
    expect(event.message).toMatch(/100,?000/);
    expect(event.message).toMatch(/abc-123/);
  });

  it('failing the data adapter still lets the lesson run', async () => {
    const breakingAdapter = {
      resolve: vi.fn().mockRejectedValue(new Error('boom')),
    };
    const session = await startLesson(
      { tenantId: 't1', userId: 'u1', conceptSlug: 'net_operating_income' },
      {
        conceptStore: buildStore(),
        dataAdapter: breakingAdapter,
      },
    );
    // The lesson still starts because groundWorkedExample swallows
    // adapter errors and degrades to static text.
    const event = session.describeCurrent();
    expect(event.step).toBe('assess');
  });

  it('rejects unknown concept slug', async () => {
    let caught: unknown;
    try {
      await startLesson(
        { tenantId: 't1', userId: 'u1', conceptSlug: 'no_such_concept' },
        {
          conceptStore: buildStore(),
          dataAdapter: buildAdapter(),
        },
      );
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(TutoringEngineError);
    expect((caught as TutoringEngineError).code).toBe('CONCEPT_NOT_FOUND');
  });

  it('runs without a mastery recorder (fallback mode)', async () => {
    const events = await runLesson(
      { tenantId: 't1', userId: 'u1', conceptSlug: 'depreciation' },
      {
        conceptStore: buildStore(),
        dataAdapter: buildAdapter(),
      },
    );
    expect(events[events.length - 1]!.step).toBe('complete');
  });
});
