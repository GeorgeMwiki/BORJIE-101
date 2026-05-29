'use client';

import { useCallback, useEffect, useState } from 'react';

import {
  describeCockpitEvent,
  useCockpitStream,
  type CockpitEvent,
  type CockpitEventKind,
} from '@/lib/cockpit-sse';

const MAX_ITEMS = 200;
const READ_IDS_KEY = 'borjie.owner.notifications.readIds.v1';

interface StoredEvent {
  readonly id: string;
  readonly kind: CockpitEventKind;
  readonly emittedAt: string;
  readonly event: CockpitEvent;
}

function loadReadIds(): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(READ_IDS_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((v) => typeof v === 'string'));
  } catch {
    return new Set();
  }
}

function persistReadIds(ids: Set<string>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      READ_IDS_KEY,
      JSON.stringify(Array.from(ids)),
    );
  } catch {
    // Quota or private-browsing — never block UI.
  }
}

function eventId(event: CockpitEvent): string {
  return `${event.kind}::${event.emittedAt}`;
}

/**
 * Owner-web notifications inbox — parity with workforce-mobile +
 * buyer-mobile inbox screens. Subscribes to the live cockpit SSE
 * stream and renders the buffered events as a scrollable list with
 * unread markers + mark-read tap + mark-all action.
 */
export function NotificationsInbox(): JSX.Element {
  const [items, setItems] = useState<ReadonlyArray<StoredEvent>>([]);
  const [readIds, setReadIds] = useState<Set<string>>(() => loadReadIds());

  const handleEvent = useCallback((event: CockpitEvent) => {
    setItems((prev) => {
      const id = eventId(event);
      if (prev.some((it) => it.id === id)) return prev;
      const next: StoredEvent = {
        id,
        kind: event.kind,
        emittedAt: event.emittedAt,
        event,
      };
      const merged = [next, ...prev];
      if (merged.length > MAX_ITEMS) merged.length = MAX_ITEMS;
      return merged;
    });
  }, []);

  const stream = useCockpitStream({ enabled: true, onEvent: handleEvent });

  const markRead = useCallback(
    (id: string) => {
      setReadIds((prev) => {
        if (prev.has(id)) return prev;
        const next = new Set(prev);
        next.add(id);
        persistReadIds(next);
        return next;
      });
    },
    [],
  );

  const markAllRead = useCallback(() => {
    setReadIds((prev) => {
      const next = new Set(prev);
      for (const it of items) next.add(it.id);
      persistReadIds(next);
      return next;
    });
  }, [items]);

  useEffect(() => {
    // Re-hydrate read ids when the storage event fires (cross-tab sync).
    const handler = (e: StorageEvent): void => {
      if (e.key !== READ_IDS_KEY) return;
      setReadIds(loadReadIds());
    };
    window.addEventListener('storage', handler);
    return () => window.removeEventListener('storage', handler);
  }, []);

  const unreadCount = items.reduce(
    (acc, it) => (readIds.has(it.id) ? acc : acc + 1),
    0,
  );

  return (
    <section>
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-xs text-neutral-500">
          <span
            className={
              stream.connected
                ? 'inline-block h-2 w-2 rounded-full bg-success'
                : 'inline-block h-2 w-2 rounded-full bg-neutral-500'
            }
            aria-hidden
          />
          <span>{stream.connected ? 'Live' : 'Reconnecting…'}</span>
          {unreadCount > 0 ? (
            <span className="ml-2 rounded-full bg-warning/20 px-2 py-0.5 text-warning">
              {unreadCount} unread
            </span>
          ) : null}
        </div>
        {unreadCount > 0 ? (
          <button
            type="button"
            onClick={markAllRead}
            className="rounded border border-border px-3 py-1 text-xs text-neutral-300 hover:bg-surface"
          >
            Mark all read
          </button>
        ) : null}
      </div>
      {items.length === 0 ? (
        <div className="rounded-2xl border border-border bg-surface p-8 text-sm text-neutral-400">
          No live events yet. We will show every decision, reminder,
          handoff and regulator request here as soon as it lands.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {items.map((item) => {
            const unread = !readIds.has(item.id);
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => markRead(item.id)}
                  className="w-full rounded-xl border border-border bg-surface p-4 text-left hover:bg-surface-raised"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                      {unread ? (
                        <span
                          className="inline-block h-2 w-2 rounded-full bg-warning"
                          aria-hidden
                        />
                      ) : null}
                      <span
                        className={
                          unread
                            ? 'text-sm font-medium text-warning'
                            : 'text-sm font-medium text-foreground'
                        }
                      >
                        {item.kind}
                      </span>
                    </div>
                    <time
                      className="text-xs text-neutral-500"
                      dateTime={item.emittedAt}
                    >
                      {new Date(item.emittedAt).toLocaleString()}
                    </time>
                  </div>
                  <p className="mt-1 text-sm text-neutral-300">
                    {describeCockpitEvent(item.event, 'en')}
                  </p>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
