/**
 * yjs-doc.ts tests — CRDT binding, status transitions, conflict resolution.
 *
 * Conflict-resolution sample (CRDT merge) is the load-bearing assertion:
 * if Y.applyUpdate convergence ever breaks for our wire format, the
 * brain and human edits start stomping each other.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as Y from 'yjs';
import {
  createYjsBinding,
  configureYjsProvider,
  __resetYjsProviderFactory,
  useDocumentBindingFactory,
  type ReactHookShim,
} from '../yjs-doc.js';
import type { LiveblocksRoom } from '../client.js';

function mockRoom(): LiveblocksRoom {
  return {
    roomId: 'borjie:lease-editing:tnt-1:lease-42',
    client: { stub: true } as never,
    disconnect: vi.fn(),
  };
}

describe('createYjsBinding', () => {
  beforeEach(() => {
    __resetYjsProviderFactory();
  });

  it('throws when no provider factory is configured', () => {
    expect(() => createYjsBinding({ room: mockRoom() })).toThrow(
      /no Yjs provider configured/,
    );
  });

  it('throws when room.client is missing', () => {
    configureYjsProvider(() => ({ destroy: vi.fn() }));
    expect(() =>
      createYjsBinding({
        room: { roomId: 'r', client: null as never, disconnect: vi.fn() },
      }),
    ).toThrow(/room\.client/);
  });

  it('starts in connecting status and transitions to ready on sync', () => {
    let syncCb: ((synced: boolean) => void) | null = null;
    configureYjsProvider(() => ({
      destroy: vi.fn(),
      on: (event, cb) => {
        if (event === 'sync') syncCb = cb;
      },
      off: vi.fn(),
    }));

    const binding = createYjsBinding({ room: mockRoom() });
    expect(binding.status).toBe('connecting');

    syncCb?.(true);
    expect(binding.status).toBe('ready');

    binding.destroy();
  });

  it('notifies subscribers on status change and on subscribe', () => {
    let syncCb: ((synced: boolean) => void) | null = null;
    configureYjsProvider(() => ({
      destroy: vi.fn(),
      on: (event, cb) => {
        if (event === 'sync') syncCb = cb;
      },
      off: vi.fn(),
    }));

    const binding = createYjsBinding({ room: mockRoom() });
    const events: string[] = [];
    binding.onStatusChange((s) => events.push(s));
    // Initial: synchronous emit on subscribe
    expect(events).toEqual(['connecting']);
    syncCb?.(true);
    expect(events).toEqual(['connecting', 'ready']);
    binding.destroy();
    expect(events).toEqual(['connecting', 'ready', 'closed']);
  });

  it('destroy is idempotent at the binding surface', () => {
    const destroySpy = vi.fn();
    configureYjsProvider(() => ({
      destroy: destroySpy,
    }));
    const binding = createYjsBinding({ room: mockRoom() });
    binding.destroy();
    binding.destroy();
    // destroy only fires once on the underlying provider (the second
    // call swallows the throw).
    expect(destroySpy).toHaveBeenCalledTimes(1);
  });

  it('Y.Doc CRDT merge: brain edit + human edit converge to same state', () => {
    // This test does NOT need the Liveblocks plumbing — it pins the
    // Yjs semantic our wire relies on. If this ever fails, our entire
    // collaborative-editing claim is broken.
    const human = new Y.Doc();
    const brain = new Y.Doc();
    human.getText('body').insert(0, 'Hello, ');
    brain.getText('body').insert(0, 'Hi ');

    // Bidirectional sync.
    const humanUpdate = Y.encodeStateAsUpdate(human);
    const brainUpdate = Y.encodeStateAsUpdate(brain);
    Y.applyUpdate(human, brainUpdate);
    Y.applyUpdate(brain, humanUpdate);

    const a = human.getText('body').toString();
    const b = brain.getText('body').toString();
    expect(a).toBe(b);
    // Both edits survived
    expect(a).toContain('Hello, ');
    expect(a).toContain('Hi ');
  });
});

describe('useDocumentBindingFactory', () => {
  it('returns ydoc + status reflecting binding', () => {
    let stateValue: unknown = 'idle';
    let effectFn: (() => void | (() => void)) | null = null;
    const shim: ReactHookShim = {
      useState: <T,>(initial: T) => {
        stateValue = initial;
        return [
          initial,
          (next: T) => {
            stateValue = next;
          },
        ];
      },
      useEffect: (fn) => {
        effectFn = fn as never;
      },
    };
    const useDocumentBinding = useDocumentBindingFactory(shim);

    const fakeBinding = {
      ydoc: new Y.Doc(),
      roomId: 'r',
      status: 'ready' as const,
      destroy: vi.fn(),
      onStatusChange: vi.fn(() => vi.fn()),
    };

    const result = useDocumentBinding(fakeBinding as never);
    expect(result.ydoc).toBe(fakeBinding.ydoc);
    // Initial value comes from `binding.status ?? 'idle'`.
    expect(stateValue).toBe('ready');

    // Effect subscribes to status changes.
    effectFn?.();
    expect(fakeBinding.onStatusChange).toHaveBeenCalled();
  });

  it('returns null ydoc when binding is null', () => {
    const shim: ReactHookShim = {
      useState: <T,>(initial: T) =>
        [initial, () => undefined] as [T, (next: T) => void],
      useEffect: () => undefined,
    };
    const useDocumentBinding = useDocumentBindingFactory(shim);
    const result = useDocumentBinding(null);
    expect(result.ydoc).toBeNull();
  });
});
