/**
 * user-mastery — boundary, recency, gate, hook, and tooltip tests.
 *
 * Covered:
 *   1.  level boundary 10 → novice
 *   2.  level boundary 11 → intermediate
 *   3.  level boundary 50 → intermediate
 *   4.  level boundary 51 → expert
 *   5.  level boundary 200 → expert
 *   6.  level boundary 201 → power-user
 *   7.  recordUserAction upserts via store adapter
 *   8.  recordUserAction validates inputs
 *   9.  recordUserAction wraps adapter errors
 *  10.  recency weight: <7d full, >90d floor, blended in between
 *  11.  recency weight: empty / dormant → floor (suppresses tier)
 *  12.  loadMasteryScore reads + computes
 *  13.  MasteryGate renders children at exact level
 *  14.  MasteryGate hides children below level
 *  15.  MasteryGate renders configurable tooltip when locked
 *  16.  MasteryGate renders lockedFallback when supplied
 *  17.  MasteryGate renders null when score is null and no fallback
 *  18.  MasteryGate respects lockedHint=false
 *  19.  useUserMastery returns null score during loading
 *  20.  useUserMastery returns level + nextThreshold once ready
 *  21.  useUserMastery surfaces errors
 *  22.  useUserMastery record() increments and refreshes
 *  23.  compareLevels orders correctly
 *  24.  nextThresholdAbove caps at top tier
 */

import { describe, it, expect, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { renderHook } from '@testing-library/react';
import {
  MASTERY_LEVELS,
  MIN_RECENCY_WEIGHT,
  RECENT_WINDOW_MS,
  STALE_WINDOW_MS,
  compareLevels,
  computeMasteryScore,
  computeRecencyWeight,
  isLevelAtLeast,
  levelFromWeightedActions,
  loadMasteryScore,
  nextLevelAbove,
  nextThresholdAbove,
  recordUserAction,
  type UserActionRecord,
  type UserActionStore,
} from '../lib/user-mastery';
import { MasteryGate } from '../components/MasteryGate';
import { useUserMastery } from '../hooks/useUserMastery';

const NOW = new Date('2026-05-21T12:00:00Z').getTime();

function recentRecord(
  partial: Partial<UserActionRecord> & {
    readonly actionId: string;
    readonly actionCount: number;
  },
): UserActionRecord {
  return {
    tenantId: 't1',
    userId: 'u1',
    firstSeen: new Date(NOW - RECENT_WINDOW_MS / 2).toISOString(),
    lastSeen: new Date(NOW - 1000).toISOString(), // 1 second ago
    ...partial,
  };
}

function makeFakeStore(initial: ReadonlyArray<UserActionRecord> = []): {
  readonly store: UserActionStore;
  readonly rows: Map<string, UserActionRecord>;
  readonly readCalls: number[];
} {
  const rows = new Map<string, UserActionRecord>();
  for (const record of initial) {
    rows.set(`${record.tenantId}|${record.userId}|${record.actionId}`, record);
  }
  const readCalls: number[] = [];
  const store: UserActionStore = {
    read: async (tenantId, userId) => {
      readCalls.push(Date.now());
      return Array.from(rows.values()).filter(
        (r) => r.tenantId === tenantId && r.userId === userId,
      );
    },
    upsert: async (event) => {
      const key = `${event.tenantId}|${event.userId}|${event.actionId}`;
      const ts = event.timestamp ?? new Date().toISOString();
      const existing = rows.get(key);
      const next: UserActionRecord = existing
        ? {
            ...existing,
            actionCount: existing.actionCount + 1,
            lastSeen: ts,
          }
        : {
            tenantId: event.tenantId,
            userId: event.userId,
            actionId: event.actionId,
            actionCount: 1,
            firstSeen: ts,
            lastSeen: ts,
          };
      rows.set(key, next);
      return next;
    },
  };
  return { store, rows, readCalls };
}

// ---------------------------------------------------------------------------
// 1. Boundary tests — 10/11, 50/51, 200/201
// ---------------------------------------------------------------------------

describe('mastery level boundaries', () => {
  it('classifies 10 weighted actions as novice (upper bound inclusive)', () => {
    expect(levelFromWeightedActions(10)).toBe('novice');
  });

  it('classifies 11 weighted actions as intermediate (boundary)', () => {
    expect(levelFromWeightedActions(11)).toBe('intermediate');
  });

  it('classifies 50 weighted actions as intermediate (upper bound)', () => {
    expect(levelFromWeightedActions(50)).toBe('intermediate');
  });

  it('classifies 51 weighted actions as expert (boundary)', () => {
    expect(levelFromWeightedActions(51)).toBe('expert');
  });

  it('classifies 200 weighted actions as expert (upper bound)', () => {
    expect(levelFromWeightedActions(200)).toBe('expert');
  });

  it('classifies 201 weighted actions as power-user (boundary)', () => {
    expect(levelFromWeightedActions(201)).toBe('power-user');
  });

  it('treats negative / NaN inputs as novice', () => {
    expect(levelFromWeightedActions(-1)).toBe('novice');
    expect(levelFromWeightedActions(Number.NaN)).toBe('novice');
  });
});

// ---------------------------------------------------------------------------
// 2. compareLevels + nextThresholdAbove
// ---------------------------------------------------------------------------

describe('level ordering helpers', () => {
  it('orders all four levels correctly', () => {
    expect(compareLevels('novice', 'intermediate')).toBe(-1);
    expect(compareLevels('intermediate', 'intermediate')).toBe(0);
    expect(compareLevels('power-user', 'expert')).toBe(1);
  });

  it('isLevelAtLeast is inclusive', () => {
    expect(isLevelAtLeast('expert', 'expert')).toBe(true);
    expect(isLevelAtLeast('power-user', 'expert')).toBe(true);
    expect(isLevelAtLeast('intermediate', 'expert')).toBe(false);
  });

  it('nextThresholdAbove caps at top tier', () => {
    expect(nextThresholdAbove('power-user')).toBeNull();
    expect(nextLevelAbove('power-user')).toBeNull();
  });

  it('nextThresholdAbove uses upper-bound + 1', () => {
    expect(nextThresholdAbove('novice')).toBe(11);
    expect(nextThresholdAbove('intermediate')).toBe(51);
    expect(nextThresholdAbove('expert')).toBe(201);
  });

  it('MASTERY_LEVELS is the canonical 4-tier order', () => {
    expect(MASTERY_LEVELS).toEqual([
      'novice',
      'intermediate',
      'expert',
      'power-user',
    ]);
  });
});

// ---------------------------------------------------------------------------
// 3. recency weighting
// ---------------------------------------------------------------------------

describe('recency weighting', () => {
  it('returns 1.0 for activity within the recent window', () => {
    expect(computeRecencyWeight(NOW - RECENT_WINDOW_MS + 1, NOW)).toBe(1);
  });

  it('returns the floor for activity older than the stale window', () => {
    expect(computeRecencyWeight(NOW - STALE_WINDOW_MS - 1, NOW)).toBe(
      MIN_RECENCY_WEIGHT,
    );
  });

  it('interpolates linearly between recent and stale windows', () => {
    const midpoint =
      NOW - (RECENT_WINDOW_MS + (STALE_WINDOW_MS - RECENT_WINDOW_MS) / 2);
    const weight = computeRecencyWeight(midpoint, NOW);
    const expected = 1 - (1 - MIN_RECENCY_WEIGHT) / 2;
    expect(weight).toBeCloseTo(expected, 5);
  });

  it('floors to MIN_RECENCY_WEIGHT when no activity recorded', () => {
    expect(computeRecencyWeight(0, NOW)).toBe(MIN_RECENCY_WEIGHT);
    expect(computeRecencyWeight(Number.NaN, NOW)).toBe(MIN_RECENCY_WEIGHT);
  });
});

// ---------------------------------------------------------------------------
// 4. computeMasteryScore — full scoring + nextThreshold
// ---------------------------------------------------------------------------

describe('computeMasteryScore', () => {
  it('returns the novice baseline for empty input', () => {
    const score = computeMasteryScore([], { now: NOW });
    expect(score.level).toBe('novice');
    expect(score.totalActions).toBe(0);
    expect(score.distinctActions).toBe(0);
    expect(score.nextThreshold).toBe(11);
    expect(score.nextLevel).toBe('intermediate');
  });

  it('sums action counts and counts distinct actions', () => {
    const score = computeMasteryScore(
      [
        recentRecord({ actionId: 'a', actionCount: 5 }),
        recentRecord({ actionId: 'b', actionCount: 7 }),
      ],
      { now: NOW },
    );
    expect(score.totalActions).toBe(12);
    expect(score.distinctActions).toBe(2);
    expect(score.level).toBe('intermediate');
  });

  it('penalises stale users with the recency floor', () => {
    const score = computeMasteryScore(
      [
        {
          tenantId: 't1',
          userId: 'u1',
          actionId: 'a',
          actionCount: 100, // would be expert if fresh
          firstSeen: new Date(NOW - STALE_WINDOW_MS - 1000).toISOString(),
          lastSeen: new Date(NOW - STALE_WINDOW_MS - 1000).toISOString(),
        },
      ],
      { now: NOW },
    );
    expect(score.recencyWeight).toBe(MIN_RECENCY_WEIGHT);
    expect(score.weightedScore).toBe(25); // 100 × 0.25
    expect(score.level).toBe('intermediate');
  });
});

// ---------------------------------------------------------------------------
// 5. recordUserAction
// ---------------------------------------------------------------------------

describe('recordUserAction', () => {
  it('upserts a new row through the adapter', async () => {
    const { store, rows } = makeFakeStore();
    const result = await recordUserAction(store, {
      tenantId: 't1',
      userId: 'u1',
      actionId: 'add-property',
    });
    expect(result.actionCount).toBe(1);
    expect(rows.size).toBe(1);
  });

  it('increments the count on a second invocation', async () => {
    const { store } = makeFakeStore();
    await recordUserAction(store, {
      tenantId: 't1',
      userId: 'u1',
      actionId: 'add-property',
    });
    const second = await recordUserAction(store, {
      tenantId: 't1',
      userId: 'u1',
      actionId: 'add-property',
    });
    expect(second.actionCount).toBe(2);
  });

  it('rejects missing tenantId / userId / actionId', async () => {
    const { store } = makeFakeStore();
    await expect(
      recordUserAction(store, {
        tenantId: '',
        userId: 'u1',
        actionId: 'a',
      }),
    ).rejects.toThrow(/tenantId/);
    await expect(
      recordUserAction(store, {
        tenantId: 't1',
        userId: '',
        actionId: 'a',
      }),
    ).rejects.toThrow(/userId/);
    await expect(
      recordUserAction(store, {
        tenantId: 't1',
        userId: 'u1',
        actionId: '',
      }),
    ).rejects.toThrow(/actionId/);
  });

  it('wraps adapter errors with a stable message', async () => {
    const store: UserActionStore = {
      read: async () => [],
      upsert: async () => {
        throw new Error('db connection refused');
      },
    };
    await expect(
      recordUserAction(store, {
        tenantId: 't1',
        userId: 'u1',
        actionId: 'a',
      }),
    ).rejects.toThrow(/failed to persist action 'a'/);
  });

  it('loadMasteryScore reads via store and computes', async () => {
    const { store } = makeFakeStore([
      recentRecord({ actionId: 'a', actionCount: 60 }),
    ]);
    const score = await loadMasteryScore(store, 't1', 'u1', { now: NOW });
    expect(score.level).toBe('expert');
    expect(score.totalActions).toBe(60);
  });
});

// ---------------------------------------------------------------------------
// 6. MasteryGate component
// ---------------------------------------------------------------------------

describe('MasteryGate', () => {
  function buildScore(level: 'novice' | 'intermediate' | 'expert' | 'power-user') {
    const totals: Record<typeof level, number> = {
      novice: 5,
      intermediate: 30,
      expert: 100,
      'power-user': 300,
    };
    return computeMasteryScore(
      [recentRecord({ actionId: 'a', actionCount: totals[level] })],
      { now: NOW },
    );
  }

  it('renders children when user is at the required level', () => {
    render(
      <MasteryGate level="intermediate" score={buildScore('intermediate')}>
        <button type="button" data-testid="advanced-btn">
          Bulk export
        </button>
      </MasteryGate>,
    );
    expect(screen.getByTestId('advanced-btn')).toBeInTheDocument();
  });

  it('renders children when user is above the required level', () => {
    render(
      <MasteryGate level="intermediate" score={buildScore('expert')}>
        <span data-testid="kids">contents</span>
      </MasteryGate>,
    );
    expect(screen.getByTestId('kids')).toBeInTheDocument();
  });

  it('shows the unlock hint when user is below the required level', () => {
    render(
      <MasteryGate level="expert" score={buildScore('novice')}>
        <span data-testid="kids">contents</span>
      </MasteryGate>,
    );
    expect(screen.queryByTestId('kids')).toBeNull();
    const hint = screen.getByTestId('mastery-gate-locked');
    expect(hint.textContent).toBe('Unlocks at expert level');
  });

  it('renders lockedFallback when supplied', () => {
    render(
      <MasteryGate
        level="expert"
        score={buildScore('novice')}
        lockedFallback={<span data-testid="alt">Pro feature</span>}
      >
        <span data-testid="kids">contents</span>
      </MasteryGate>,
    );
    expect(screen.queryByTestId('kids')).toBeNull();
    expect(screen.getByTestId('alt')).toBeInTheDocument();
  });

  it('returns null when score is still loading and no fallback set', () => {
    const { container } = render(
      <MasteryGate level="expert" score={null}>
        <span data-testid="kids">contents</span>
      </MasteryGate>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('honours lockedHint=false (renders nothing when locked)', () => {
    const { container } = render(
      <MasteryGate
        level="expert"
        score={buildScore('novice')}
        lockedHint={false}
      >
        <span data-testid="kids">contents</span>
      </MasteryGate>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('uses the hintTemplate override with {level} interpolation', () => {
    render(
      <MasteryGate
        level="expert"
        score={buildScore('novice')}
        hintTemplate="Available to {level} users"
      >
        <span>contents</span>
      </MasteryGate>,
    );
    expect(screen.getByText('Available to expert users')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// 7. useUserMastery hook
// ---------------------------------------------------------------------------

describe('useUserMastery', () => {
  it('returns score=null during initial loading', () => {
    let resolve: (value: ReadonlyArray<UserActionRecord>) => void = () => {};
    const store: UserActionStore = {
      read: () =>
        new Promise<ReadonlyArray<UserActionRecord>>((r) => {
          resolve = r;
        }),
      upsert: async () => ({
        tenantId: 't1',
        userId: 'u1',
        actionId: 'a',
        actionCount: 1,
        firstSeen: new Date(NOW).toISOString(),
        lastSeen: new Date(NOW).toISOString(),
      }),
    };

    const { result } = renderHook(() =>
      useUserMastery({ tenantId: 't1', userId: 'u1', store, now: NOW }),
    );
    expect(result.current.status).toBe('loading');
    expect(result.current.score).toBeNull();
    resolve([]);
  });

  it('exposes level + nextThreshold once data resolves', async () => {
    const { store } = makeFakeStore([
      recentRecord({ actionId: 'a', actionCount: 60 }),
    ]);
    const { result } = renderHook(() =>
      useUserMastery({ tenantId: 't1', userId: 'u1', store, now: NOW }),
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.score?.level).toBe('expert');
    expect(result.current.score?.nextThreshold).toBe(201);
    expect(result.current.score?.nextLevel).toBe('power-user');
  });

  it('captures and exposes adapter errors', async () => {
    const store: UserActionStore = {
      read: async () => {
        throw new Error('network down');
      },
      upsert: async () => {
        throw new Error('unused');
      },
    };
    const { result } = renderHook(() =>
      useUserMastery({ tenantId: 't1', userId: 'u1', store, now: NOW }),
    );
    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error?.message).toBe('network down');
    expect(result.current.score).toBeNull();
  });

  it('record() increments the underlying store and refreshes the score', async () => {
    const { store } = makeFakeStore();
    const { result } = renderHook(() =>
      useUserMastery({ tenantId: 't1', userId: 'u1', store, now: NOW }),
    );
    await waitFor(() => expect(result.current.status).toBe('ready'));
    expect(result.current.score?.totalActions).toBe(0);

    await act(async () => {
      await result.current.record('add-property');
    });

    await waitFor(() => expect(result.current.score?.totalActions).toBe(1));
  });
});

// ---------------------------------------------------------------------------
// 8. Cross-tenant isolation (adapter-level) — RLS is enforced in the
// database tests; here we verify the in-memory adapter pattern that any
// real adapter must replicate.
// ---------------------------------------------------------------------------

describe('cross-tenant isolation (adapter contract)', () => {
  it('does not leak records across tenants', async () => {
    const { store } = makeFakeStore([
      recentRecord({
        tenantId: 't1',
        userId: 'u1',
        actionId: 'a',
        actionCount: 5,
      }),
      recentRecord({
        tenantId: 't2',
        userId: 'u1',
        actionId: 'a',
        actionCount: 999,
      }),
    ]);
    const t1Records = await store.read('t1', 'u1');
    const t2Records = await store.read('t2', 'u1');
    expect(t1Records).toHaveLength(1);
    expect(t1Records[0]?.actionCount).toBe(5);
    expect(t2Records).toHaveLength(1);
    expect(t2Records[0]?.actionCount).toBe(999);
  });
});
