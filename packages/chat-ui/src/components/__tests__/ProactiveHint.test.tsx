/**
 * ProactiveHint — surfaces brain-driven hints whenever Theory-of-Mind
 * flags the user as frustrated, confused, or anxious. Tests cover the
 * threshold matrix, dismissal persistence, action-event dispatch, and
 * the affective-profile TTL contract.
 */

import { describe, expect, it, vi, afterEach } from 'vitest';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';

import {
  ProactiveHint,
  matchesThreshold,
  readDismissed,
  selectHint,
  storageKeyFor,
  type HintCandidate,
  type HintStorage,
} from '../ProactiveHint';
import {
  isFresh,
  useAffectiveProfile,
  type AffectiveProfile,
} from '../../hooks/useAffectiveProfile';

// ---------------------------------------------------------------------------
// Fixtures + fakes
// ---------------------------------------------------------------------------

const ALL_HINTS: ReadonlyArray<HintCandidate> = [
  {
    id: 'frustrated-human-handoff',
    trigger: 'frustration',
    threshold: 0.5,
    title: 'Looks like this is taking longer than expected.',
    body: 'Want to chat with a human?',
    action: { label: 'Talk to a human', emit: 'handoff:human' },
  },
  {
    id: 'low-comprehension-simpler',
    trigger: 'comprehension',
    threshold: 0.4,
    title: 'Want me to explain this in simpler terms?',
    body: 'I can break this down step by step.',
    action: { label: 'Explain simply' },
  },
  {
    id: 'high-anxiety-safety',
    trigger: 'anxiety',
    threshold: 0.6,
    title: 'Your data is safe.',
    body: 'I never auto-execute irreversible actions without confirming.',
  },
];

const NOW_ISO = '2026-05-21T12:00:00.000Z';
const NOW_MS = Date.parse(NOW_ISO);

function profile(
  overrides: Partial<AffectiveProfile> = {},
): AffectiveProfile {
  return {
    frustration: 0.1,
    comprehension: 0.9,
    anxiety: 0.1,
    trust: 0.9,
    urgency: 0.1,
    lastUpdated: NOW_ISO,
    ...overrides,
  };
}

function fakeStorage(): HintStorage & { snapshot: () => Map<string, string> } {
  const map = new Map<string, string>();
  return {
    getItem: (k) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
    snapshot: () => new Map(map),
  };
}

// ---------------------------------------------------------------------------
// Pure-helper tests (cheap + deterministic)
// ---------------------------------------------------------------------------

describe('matchesThreshold', () => {
  it('fires frustration hint when value meets the >= threshold', () => {
    expect(matchesThreshold(profile({ frustration: 0.5 }), ALL_HINTS[0]!)).toBe(true);
    expect(matchesThreshold(profile({ frustration: 0.49 }), ALL_HINTS[0]!)).toBe(false);
  });

  it('fires comprehension hint when value meets the <= threshold', () => {
    expect(matchesThreshold(profile({ comprehension: 0.4 }), ALL_HINTS[1]!)).toBe(true);
    expect(matchesThreshold(profile({ comprehension: 0.41 }), ALL_HINTS[1]!)).toBe(false);
  });

  it('idle trigger always matches regardless of profile', () => {
    const idleHint: HintCandidate = {
      id: 'idle',
      trigger: 'idle',
      threshold: 0,
      title: 'Still there?',
      body: 'Let me know when you are ready.',
    };
    expect(matchesThreshold(null, idleHint)).toBe(true);
    expect(matchesThreshold(profile(), idleHint)).toBe(true);
  });

  it('non-idle triggers return false when profile is null', () => {
    expect(matchesThreshold(null, ALL_HINTS[0]!)).toBe(false);
  });
});

describe('selectHint', () => {
  it('returns null when hints array is empty', () => {
    expect(selectHint(profile({ frustration: 0.9 }), [], new Set())).toBeNull();
  });

  it('returns the first matching hint and skips dismissed ones', () => {
    const dismissed = new Set(['frustrated-human-handoff']);
    const picked = selectHint(
      profile({ frustration: 0.9, comprehension: 0.2 }),
      ALL_HINTS,
      dismissed,
    );
    expect(picked?.id).toBe('low-comprehension-simpler');
  });

  it('returns null when no hint thresholds match', () => {
    expect(selectHint(profile(), ALL_HINTS, new Set())).toBeNull();
  });
});

describe('readDismissed', () => {
  it('returns an empty set when storage is null', () => {
    expect(readDismissed(ALL_HINTS, null, 1000, () => NOW_MS).size).toBe(0);
  });

  it('drops dismissals whose TTL has expired', () => {
    const storage = fakeStorage();
    storage.setItem(storageKeyFor('high-anxiety-safety'), String(NOW_MS - 60_000));
    const dismissed = readDismissed(ALL_HINTS, storage, 30_000, () => NOW_MS);
    expect(dismissed.size).toBe(0);
    expect(storage.getItem(storageKeyFor('high-anxiety-safety'))).toBeNull();
  });

  it('keeps dismissals that are still within TTL', () => {
    const storage = fakeStorage();
    storage.setItem(storageKeyFor('high-anxiety-safety'), String(NOW_MS - 10_000));
    const dismissed = readDismissed(ALL_HINTS, storage, 30_000, () => NOW_MS);
    expect(dismissed.has('high-anxiety-safety')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Component tests
// ---------------------------------------------------------------------------

describe('ProactiveHint component', () => {
  afterEach(() => {
    // Each test owns its own fakeStorage; nothing global to reset, but
    // be defensive in case a future test taps real localStorage.
    if (typeof window !== 'undefined') window.localStorage.clear();
  });

  it('renders nothing when profile is null and no idle hint is supplied', () => {
    const { container } = render(
      <ProactiveHint
        profile={null}
        hints={ALL_HINTS}
        storage={fakeStorage()}
        now={() => NOW_MS}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when no hint threshold is met', () => {
    const { container } = render(
      <ProactiveHint
        profile={profile()}
        hints={ALL_HINTS}
        storage={fakeStorage()}
        now={() => NOW_MS}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the frustration hint when frustration >= 0.5', () => {
    render(
      <ProactiveHint
        profile={profile({ frustration: 0.7 })}
        hints={ALL_HINTS}
        storage={fakeStorage()}
        now={() => NOW_MS}
      />,
    );
    const node = screen.getByTestId('proactive-hint');
    expect(node).toBeInTheDocument();
    expect(node.getAttribute('data-hint-id')).toBe('frustrated-human-handoff');
    expect(node.getAttribute('data-hint-trigger')).toBe('frustration');
    expect(screen.getByText(/Looks like this is taking longer/i)).toBeInTheDocument();
  });

  it('renders the comprehension hint when comprehension <= 0.4', () => {
    render(
      <ProactiveHint
        profile={profile({ comprehension: 0.3 })}
        hints={ALL_HINTS}
        storage={fakeStorage()}
        now={() => NOW_MS}
      />,
    );
    expect(screen.getByText(/Want me to explain this in simpler terms\?/i)).toBeInTheDocument();
  });

  it('renders the anxiety hint when anxiety >= 0.6', () => {
    render(
      <ProactiveHint
        profile={profile({ anxiety: 0.8 })}
        hints={ALL_HINTS}
        storage={fakeStorage()}
        now={() => NOW_MS}
      />,
    );
    expect(screen.getByText(/Your data is safe/i)).toBeInTheDocument();
  });

  it('exposes role="status" + aria-live="polite" for screen readers', () => {
    render(
      <ProactiveHint
        profile={profile({ frustration: 0.9 })}
        hints={ALL_HINTS}
        storage={fakeStorage()}
        now={() => NOW_MS}
      />,
    );
    const node = screen.getByTestId('proactive-hint');
    expect(node.getAttribute('role')).toBe('status');
    expect(node.getAttribute('aria-live')).toBe('polite');
  });

  it('dismisses the active hint and persists to storage', () => {
    const storage = fakeStorage();
    const onDismiss = vi.fn();
    render(
      <ProactiveHint
        profile={profile({ frustration: 0.9 })}
        hints={ALL_HINTS}
        onDismiss={onDismiss}
        storage={storage}
        now={() => NOW_MS}
      />,
    );
    fireEvent.click(screen.getByTestId('proactive-hint-dismiss'));
    expect(onDismiss).toHaveBeenCalledWith('frustrated-human-handoff');
    expect(screen.queryByTestId('proactive-hint')).toBeNull();
    expect(
      storage.getItem(storageKeyFor('frustrated-human-handoff')),
    ).toBe(String(NOW_MS));
  });

  it('hydrates dismissals from storage on mount', () => {
    const storage = fakeStorage();
    storage.setItem(
      storageKeyFor('frustrated-human-handoff'),
      String(NOW_MS - 5_000),
    );
    const { container } = render(
      <ProactiveHint
        profile={profile({ frustration: 0.9 })}
        hints={ALL_HINTS}
        storage={storage}
        now={() => NOW_MS}
      />,
    );
    // The frustration hint is already dismissed -> nothing should render
    // because no other thresholds fire for this profile.
    expect(container.firstChild).toBeNull();
  });

  it('dispatches a custom event when action.emit is set and onActionClick fires', () => {
    const handler = vi.fn();
    window.addEventListener('proactive-hint:action', handler as EventListener);
    const onActionClick = vi.fn();
    render(
      <ProactiveHint
        profile={profile({ frustration: 0.9 })}
        hints={ALL_HINTS}
        onActionClick={onActionClick}
        storage={fakeStorage()}
        now={() => NOW_MS}
      />,
    );
    fireEvent.click(screen.getByTestId('proactive-hint-action'));
    expect(onActionClick).toHaveBeenCalledWith('frustrated-human-handoff');
    expect(handler).toHaveBeenCalledTimes(1);
    const ev = handler.mock.calls[0]?.[0] as CustomEvent<{ id: string; action: string }>;
    expect(ev.detail).toEqual({
      id: 'frustrated-human-handoff',
      action: 'handoff:human',
    });
    window.removeEventListener('proactive-hint:action', handler as EventListener);
  });
});

// ---------------------------------------------------------------------------
// useAffectiveProfile hook
// ---------------------------------------------------------------------------

describe('isFresh', () => {
  it('returns true when within TTL', () => {
    expect(isFresh(profile(), 30_000, () => NOW_MS + 10_000)).toBe(true);
  });

  it('returns false when older than TTL', () => {
    expect(isFresh(profile(), 30_000, () => NOW_MS + 60_000)).toBe(false);
  });

  it('returns false when lastUpdated is malformed', () => {
    expect(
      isFresh({ ...profile(), lastUpdated: 'not-a-date' }, 30_000, () => NOW_MS),
    ).toBe(false);
  });
});

describe('useAffectiveProfile', () => {
  it('returns null when the getter returns null', () => {
    const { result } = renderHook(() =>
      useAffectiveProfile({
        getProfile: () => null,
        ttlMs: 60_000,
        pollMs: 0,
        now: () => NOW_MS,
      }),
    );
    expect(result.current).toBeNull();
  });

  it('returns the profile when it is within TTL', () => {
    const { result } = renderHook(() =>
      useAffectiveProfile({
        getProfile: () => profile({ frustration: 0.7 }),
        ttlMs: 60_000,
        pollMs: 0,
        now: () => NOW_MS,
      }),
    );
    expect(result.current?.frustration).toBe(0.7);
  });

  it('returns null when the profile is stale beyond TTL', () => {
    const { result } = renderHook(() =>
      useAffectiveProfile({
        getProfile: () => profile({ lastUpdated: NOW_ISO }),
        ttlMs: 1_000,
        pollMs: 0,
        now: () => NOW_MS + 10_000,
      }),
    );
    expect(result.current).toBeNull();
  });

  it('detects freshness changes on poll tick', () => {
    vi.useFakeTimers();
    try {
      let mockNow = NOW_MS;
      const tick = (ms: number): void => {
        mockNow += ms;
        vi.advanceTimersByTime(ms);
      };
      let supply: AffectiveProfile | null = null;
      const { result } = renderHook(() =>
        useAffectiveProfile({
          getProfile: () => supply,
          ttlMs: 60_000,
          pollMs: 100,
          now: () => mockNow,
        }),
      );
      expect(result.current).toBeNull();
      // New brain response arrives.
      supply = profile({ frustration: 0.9, lastUpdated: new Date(mockNow).toISOString() });
      act(() => {
        tick(150);
      });
      expect(result.current?.frustration).toBe(0.9);
    } finally {
      vi.useRealTimers();
    }
  });
});
