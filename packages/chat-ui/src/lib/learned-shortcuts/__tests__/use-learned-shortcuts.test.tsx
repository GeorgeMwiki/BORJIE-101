/**
 * useLearnedShortcuts hook tests.
 *
 * The hook ties the ranker to a Supabase-shaped fetcher and provides
 * pin/unpin/refresh. Tests cover:
 *   - mastery threshold gating (returns null when < 3 distinct actions)
 *   - route change triggers re-fetch
 *   - pinning is persisted to the supplied storage
 *   - error path
 *   - empty userId returns null without fetching
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useLearnedShortcuts } from '../../../hooks/useLearnedShortcuts';
import type {
  PinnedStorage,
  UseLearnedShortcutsOptions,
  UserActionTrackerRow,
} from '../types';

function row(
  id: string,
  overrides: Partial<UserActionTrackerRow> = {},
): UserActionTrackerRow {
  return {
    id,
    label: `Label ${id}`,
    frequency: 5,
    lastSeenIso: new Date().toISOString(),
    successCount: 4,
    cancelCount: 1,
    ...overrides,
  };
}

function makeMemoryStorage(): PinnedStorage & {
  store: Map<string, string>;
} {
  const store = new Map<string, string>();
  return {
    store,
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => {
      store.set(k, v);
    },
    removeItem: (k) => {
      store.delete(k);
    },
  };
}

interface ProbeProps extends UseLearnedShortcutsOptions {
  readonly onResult?: (
    r: ReturnType<typeof useLearnedShortcuts>,
  ) => void;
}

function Probe({ onResult, ...opts }: ProbeProps): JSX.Element {
  const result = useLearnedShortcuts(opts);
  if (onResult) onResult(result);
  if (result.shortcuts === null) return <div data-testid="probe-null" />;
  return (
    <ul data-testid="probe-list">
      {result.shortcuts.map((s) => (
        <li key={s.id} data-testid={`probe-${s.id}`}>
          {s.label}
        </li>
      ))}
    </ul>
  );
}

describe('useLearnedShortcuts', () => {
  it('returns null shortcuts below the mastery threshold', async () => {
    const storage = makeMemoryStorage();
    const fetcher = vi.fn(async () => [row('a'), row('b')]);
    render(
      <Probe
        userId="u1"
        route="/owner"
        fetcher={fetcher}
        storage={storage}
        masteryThreshold={3}
      />,
    );
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
    expect(await screen.findByTestId('probe-null')).toBeInTheDocument();
  });

  it('returns ranked shortcuts once mastery threshold is met', async () => {
    const storage = makeMemoryStorage();
    const fetcher = vi.fn(async () => [row('a'), row('b'), row('c')]);
    render(
      <Probe
        userId="u1"
        route="/owner"
        fetcher={fetcher}
        storage={storage}
        masteryThreshold={3}
      />,
    );
    expect(await screen.findByTestId('probe-list')).toBeInTheDocument();
    expect(screen.getByTestId('probe-a')).toBeInTheDocument();
    expect(screen.getByTestId('probe-b')).toBeInTheDocument();
    expect(screen.getByTestId('probe-c')).toBeInTheDocument();
  });

  it('returns null when userId is empty (SSR / pre-auth)', async () => {
    const fetcher = vi.fn(async () => [row('a'), row('b'), row('c')]);
    render(<Probe userId="" route="/owner" fetcher={fetcher} />);
    expect(await screen.findByTestId('probe-null')).toBeInTheDocument();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('re-fetches when the route changes', async () => {
    const storage = makeMemoryStorage();
    const fetcher = vi.fn(async ({ route }) => {
      if (route === '/owner') {
        return [row('a'), row('b'), row('c')];
      }
      return [row('x'), row('y'), row('z')];
    });
    const { rerender } = render(
      <Probe
        userId="u1"
        route="/owner"
        fetcher={fetcher}
        storage={storage}
        masteryThreshold={3}
      />,
    );
    await screen.findByTestId('probe-a');
    rerender(
      <Probe
        userId="u1"
        route="/tenants"
        fetcher={fetcher}
        storage={storage}
        masteryThreshold={3}
      />,
    );
    await screen.findByTestId('probe-x');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[0]?.[0]?.route).toBe('/owner');
    expect(fetcher.mock.calls[1]?.[0]?.route).toBe('/tenants');
  });

  it('persists pinned IDs to storage and re-ranks immediately', async () => {
    const storage = makeMemoryStorage();
    const fetcher = vi.fn(async () => [
      row('a', { frequency: 100 }),
      row('b', { frequency: 50 }),
      row('c', { frequency: 10 }),
    ]);
    let captured: ReturnType<typeof useLearnedShortcuts> | null = null;
    render(
      <Probe
        userId="u1"
        route="/owner"
        fetcher={fetcher}
        storage={storage}
        masteryThreshold={3}
        onResult={(r) => {
          captured = r;
        }}
      />,
    );
    await screen.findByTestId('probe-a');

    // Pin "c" — should jump to position 0 in the next render.
    act(() => {
      captured?.pin('c');
    });

    await waitFor(() => {
      const list = screen.getByTestId('probe-list');
      const firstChild = list.firstElementChild as HTMLElement | null;
      expect(firstChild?.getAttribute('data-testid')).toBe('probe-c');
    });

    // Storage was written.
    expect(storage.store.get('learned-shortcuts:pinned:u1:/owner')).toBe(
      JSON.stringify(['c']),
    );
  });

  it('restores pinned IDs from storage on mount', async () => {
    const storage = makeMemoryStorage();
    storage.store.set(
      'learned-shortcuts:pinned:u1:/owner',
      JSON.stringify(['c']),
    );
    const fetcher = vi.fn(async () => [
      row('a', { frequency: 100 }),
      row('b', { frequency: 50 }),
      row('c', { frequency: 10 }),
    ]);
    render(
      <Probe
        userId="u1"
        route="/owner"
        fetcher={fetcher}
        storage={storage}
        masteryThreshold={3}
      />,
    );
    await screen.findByTestId('probe-c');
    const list = screen.getByTestId('probe-list');
    const firstChild = list.firstElementChild as HTMLElement | null;
    expect(firstChild?.getAttribute('data-testid')).toBe('probe-c');
  });

  it('exposes a fetch error to the caller', async () => {
    const storage = makeMemoryStorage();
    const boom = new Error('supabase down');
    const fetcher = vi.fn(async () => {
      throw boom;
    });
    let captured: ReturnType<typeof useLearnedShortcuts> | null = null;
    render(
      <Probe
        userId="u1"
        route="/owner"
        fetcher={fetcher}
        storage={storage}
        onResult={(r) => {
          captured = r;
        }}
      />,
    );
    await waitFor(() => expect(captured?.error).toBe(boom));
  });

  it('unpinning removes the id from storage', async () => {
    const storage = makeMemoryStorage();
    storage.store.set(
      'learned-shortcuts:pinned:u1:/owner',
      JSON.stringify(['c', 'a']),
    );
    const fetcher = vi.fn(async () => [row('a'), row('b'), row('c')]);
    let captured: ReturnType<typeof useLearnedShortcuts> | null = null;
    render(
      <Probe
        userId="u1"
        route="/owner"
        fetcher={fetcher}
        storage={storage}
        masteryThreshold={3}
        onResult={(r) => {
          captured = r;
        }}
      />,
    );
    await screen.findByTestId('probe-list');
    act(() => {
      captured?.unpin('c');
    });
    await waitFor(() =>
      expect(storage.store.get('learned-shortcuts:pinned:u1:/owner')).toBe(
        JSON.stringify(['a']),
      ),
    );
  });

  it('refresh() forces a new fetch', async () => {
    const storage = makeMemoryStorage();
    const fetcher = vi.fn(async () => [row('a'), row('b'), row('c')]);
    let captured: ReturnType<typeof useLearnedShortcuts> | null = null;
    render(
      <Probe
        userId="u1"
        route="/owner"
        fetcher={fetcher}
        storage={storage}
        masteryThreshold={3}
        staleAfterMs={1_000_000}
        onResult={(r) => {
          captured = r;
        }}
      />,
    );
    await screen.findByTestId('probe-list');
    expect(fetcher).toHaveBeenCalledTimes(1);
    act(() => {
      captured?.refresh();
    });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  });
});
