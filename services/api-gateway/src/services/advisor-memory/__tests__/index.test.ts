/**
 * Advisor-memory facade tests.
 *
 * Wave BRAIN-DEPTH. Drives the `getMemory` / `recordObservation` /
 * `renderMemoryDirective` surface with an in-memory db stub. The
 * underlying repository is a thin SQL wrapper, so we assert the
 * normalization + the rendered prompt directive only.
 */

import { describe, it, expect, vi } from 'vitest';

import {
  getMemory,
  recordObservation,
  renderMemoryDirective,
  DEFAULT_PREFERENCES,
  type MemorySnapshot,
} from '../index';

function makeStubDb(rowsByCall: ReadonlyArray<unknown>) {
  let i = 0;
  const execute = vi.fn(async () => {
    const next = rowsByCall[i] ?? [];
    i += 1;
    return next;
  });
  return { execute };
}

describe('advisor-memory.getMemory', () => {
  it('synthesizes defaults when the DB returns no preferences row', async () => {
    const db = makeStubDb([[], []]);
    const snap = await getMemory(db, 'tenant-a');
    expect(snap.preferences.tenantId).toBe('tenant-a');
    expect(snap.preferences.language).toBe(DEFAULT_PREFERENCES.language);
    expect(snap.preferences.communicationStyle).toBe(
      DEFAULT_PREFERENCES.communicationStyle,
    );
    expect(snap.patterns).toHaveLength(0);
  });

  it('parses a populated preferences row + observed patterns', async () => {
    const db = makeStubDb([
      [
        {
          tenant_id: 'tenant-a',
          language: 'en',
          time_zone: 'Europe/London',
          default_brief_cadence: 'weekly',
          communication_style: 'technical',
          preferred_channels: ['email', 'slack'],
          do_not_disturb: [],
          last_taught_at: null,
          mastery_levels: { compliance: 'expert' },
          friction_signals: { dropped_turns: 5 },
          updated_at: '2026-05-28T00:00:00Z',
        },
      ],
      [
        {
          id: 'p1',
          tenant_id: 'tenant-a',
          pattern_kind: 'routine',
          pattern_payload: {
            action: 'royalty_file',
            day_of_month: 12,
            signature: 'routine:royalty_file:dom-12',
          },
          confidence: 0.74,
          first_seen_at: '2026-04-12T00:00:00Z',
          last_seen_at: '2026-05-12T00:00:00Z',
          occurrences: 6,
        },
      ],
    ]);
    const snap = await getMemory(db, 'tenant-a');
    expect(snap.preferences.language).toBe('en');
    expect(snap.preferences.communicationStyle).toBe('technical');
    expect(snap.patterns).toHaveLength(1);
    expect(snap.patterns[0]!.patternKind).toBe('routine');
    expect(snap.patterns[0]!.occurrences).toBe(6);
  });
});

describe('advisor-memory.recordObservation', () => {
  it('emits a recurring_question + peak_time upsert per turn', async () => {
    const calls: Array<unknown> = [];
    const db = {
      execute: vi.fn(async (q: unknown) => {
        calls.push(q);
        return [];
      }),
    };
    await recordObservation(db, {
      tenantId: 'tenant-a',
      userId: 'u-1',
      responseLengthChars: 300,
      localHour: 7,
      questionKind: 'finance.summary',
      normalizedQuestion: 'how much did i make this month',
      engagement: 'continue',
    });
    // At minimum: one recurring_question, one peak_time = 2 SQL calls.
    expect(db.execute).toHaveBeenCalled();
    expect(db.execute.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('emits a routine pattern when an action is detected', async () => {
    const db = {
      execute: vi.fn(async () => []),
    };
    await recordObservation(db, {
      tenantId: 'tenant-a',
      userId: 'u-1',
      responseLengthChars: 200,
      localHour: 12,
      questionKind: 'compliance.tax',
      normalizedQuestion: 'filed royalty',
      engagement: 'continue',
      detectedRoutineAction: 'royalty_file',
      routineDayOfMonth: 12,
    });
    // recurring_question + peak_time + routine = 3 SQL upsert paths.
    expect(db.execute.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it('bumps friction signals on bounce + long response', async () => {
    const db = {
      execute: vi.fn(async () => []),
    };
    await recordObservation(db, {
      tenantId: 'tenant-a',
      userId: 'u-1',
      responseLengthChars: 2500,
      localHour: 15,
      questionKind: 'general',
      normalizedQuestion: 'tell me a long story',
      engagement: 'bounce',
    });
    // 2 pattern upserts + 1 read for friction + 1 write for friction.
    expect(db.execute.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it('never throws on db.execute rejection', async () => {
    const db = {
      execute: vi.fn(async () => {
        throw new Error('boom');
      }),
    };
    await expect(
      recordObservation(db, {
        tenantId: 'tenant-a',
        userId: 'u-1',
        responseLengthChars: 100,
        localHour: 10,
        questionKind: 'general',
        normalizedQuestion: 'hello',
        engagement: 'continue',
      }),
    ).resolves.toBeUndefined();
  });
});

describe('advisor-memory.renderMemoryDirective', () => {
  function snap(overrides: Partial<MemorySnapshot> = {}): MemorySnapshot {
    return {
      preferences: {
        tenantId: 'tenant-a',
        language: 'sw',
        timeZone: 'Africa/Dar_es_Salaam',
        defaultBriefCadence: 'daily',
        communicationStyle: 'concise',
        preferredChannels: ['email'],
        doNotDisturb: [],
        lastTaughtAt: null,
        masteryLevels: {},
        frictionSignals: {},
        updatedAt: '2026-05-28T00:00:00Z',
      },
      patterns: [],
      ...overrides,
    };
  }

  it('renders the communication-style line', () => {
    const out = renderMemoryDirective(snap());
    expect(out).toContain('concise');
  });

  it('mentions Swahili when language is sw', () => {
    const out = renderMemoryDirective(snap());
    expect(out).toContain('Swahili');
  });

  it('mentions routine + day-of-month when present', () => {
    const out = renderMemoryDirective(
      snap({
        patterns: [
          {
            id: 'p1',
            tenantId: 'tenant-a',
            patternKind: 'routine',
            patternPayload: { action: 'royalty_file', day_of_month: 12 },
            confidence: 0.7,
            firstSeenAt: '',
            lastSeenAt: '',
            occurrences: 5,
          },
        ],
      }),
    );
    expect(out).toContain('royalty_file');
    expect(out).toContain('day 12');
  });

  it('surfaces friction signals when over-long-responses repeat', () => {
    const base = snap();
    const out = renderMemoryDirective({
      preferences: { ...base.preferences, frictionSignals: { over_long_responses: 3 } },
      patterns: [],
    });
    expect(out).toMatch(/long replies/i);
  });
});
