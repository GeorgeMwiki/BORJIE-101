/**
 * useTabMultiDeviceSync (owner-os) — decoupled chat→tab linkage.
 *
 * The cockpit tab strip must reconcile across devices INDEPENDENTLY of the
 * chat stream: a stalled chat turn must NOT stop tab sync. These tests drive
 * a fake EventSource standing in for the dedicated
 * `/api/v1/portal-genui/tabs/subscribe` channel and assert:
 *
 *   1. A `tab_spawn` frame from the cockpit bus applies to the store even
 *      though NO chat stream is connected (the chat stream is stalled).
 *   2. A `tab_remove` frame from the bus closes the tab.
 *   3. Proposals reach the caller's onProposal banner handler.
 *   4. Teardown closes the EventSource on unmount.
 *
 * The store handlers are driven through the SAME `handleTabSseFrame`
 * dispatcher the in-band fast path uses, so this proves the cross-device
 * path is wired end-to-end.
 */

import { renderHook, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── Fake EventSource — captures listeners so the test can push frames ──
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly url: string;
  readonly listeners = new Map<string, Set<(e: MessageEvent) => void>>();
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, cb: (e: MessageEvent) => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(cb);
    this.listeners.set(type, set);
  }

  close(): void {
    this.closed = true;
  }

  /** Test helper — deliver a frame as the gateway would. */
  emit(type: string, data: unknown): void {
    const set = this.listeners.get(type);
    if (!set) return;
    const event = { data: JSON.stringify(data) } as MessageEvent;
    for (const cb of set) cb(event);
  }
}

// ─── Mock the api-client so the hook resolves a stable base URL ─────────
vi.mock('@/lib/api-client', () => ({ API_BASE: 'http://gateway.test' }));

// ─── In-memory tab store mock — records what the hook applies ───────────
const spawnOrAugment = vi.fn();
const close = vi.fn();
const patchState = vi.fn();
const rename = vi.fn();
vi.mock('@/lib/owner-tabs-store', () => ({
  useOwnerTabs: () => ({ spawnOrAugment, close, patchState, rename }),
}));

// Stable device id so the URL is deterministic.
vi.mock('@/lib/use-tab-multi-device-sync', () => ({
  ensureTabDeviceId: () => 'device-THIS',
}));

import { useTabMultiDeviceSync } from '../useTabMultiDeviceSync';

beforeEach(() => {
  FakeEventSource.instances = [];
  spawnOrAugment.mockReset();
  close.mockReset();
  patchState.mockReset();
  rename.mockReset();
  vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function lastSource(): FakeEventSource {
  const src = FakeEventSource.instances.at(-1);
  if (!src) throw new Error('no EventSource opened');
  return src;
}

describe('useTabMultiDeviceSync (owner-os, decoupled channel)', () => {
  it('opens the dedicated subscribe channel with the echo-filter device id', () => {
    renderHook(() => useTabMultiDeviceSync({ userId: 'owner-1' }));
    const src = lastSource();
    expect(src.url).toContain('/api/v1/portal-genui/tabs/subscribe');
    expect(src.url).toContain('deviceId=device-THIS');
  });

  it('applies a tab.spawned from the cockpit bus when the chat stream stalls', () => {
    // No chat stream is wired in this test — the only transport is the
    // decoupled tab channel. This is the "chat stream stalled" condition.
    const { result } = renderHook(() =>
      useTabMultiDeviceSync({ userId: 'owner-1', language: 'en' }),
    );
    const src = lastSource();

    act(() => {
      src.emit('tab_spawn', {
        at: new Date().toISOString(),
        payload: {
          tagKind: 'tab_spawn',
          tabId: 'finance|focus:gold',
          tabType: 'finance',
          title: 'Gold Quarter',
          config: { mineralKind: 'gold' },
          droppedKeys: [],
          source: 'brain',
        },
      });
    });

    expect(spawnOrAugment).toHaveBeenCalledTimes(1);
    expect(spawnOrAugment).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'finance', title: 'Gold Quarter' }),
    );
    expect(result.current.applied).toBe(1);
    expect(result.current.lastAppliedEvent).toBe('tab_spawn');
  });

  it('closes a tab on a tab_remove frame from the bus', () => {
    renderHook(() => useTabMultiDeviceSync({ userId: 'owner-1' }));
    act(() => {
      lastSource().emit('tab_remove', {
        payload: { tagKind: 'tab_remove', tabId: 'finance|focus:gold', source: 'owner' },
      });
    });
    expect(close).toHaveBeenCalledWith('finance|focus:gold');
  });

  it('routes proposals to the onProposal banner handler', () => {
    const onProposal = vi.fn();
    renderHook(() =>
      useTabMultiDeviceSync({ userId: 'owner-1', onProposal }),
    );
    act(() => {
      lastSource().emit('tab_proposal', {
        payload: {
          tagKind: 'tab_proposal',
          proposalId: 'prop-1',
          tabType: 'finance',
          title: 'Pin Mwadui',
          reasonEn: '3 drills this week',
          reasonSw: null,
          evidenceIds: ['e1'],
          confidence: 0.8,
          config: {},
        },
      });
    });
    expect(onProposal).toHaveBeenCalledTimes(1);
    expect(onProposal.mock.calls[0]?.[0]?.proposalId).toBe('prop-1');
  });

  it('closes the EventSource on unmount (clean teardown)', () => {
    const { unmount } = renderHook(() =>
      useTabMultiDeviceSync({ userId: 'owner-1' }),
    );
    const src = lastSource();
    expect(src.closed).toBe(false);
    unmount();
    expect(src.closed).toBe(true);
  });

  it('does not open a channel when disabled', () => {
    renderHook(() =>
      useTabMultiDeviceSync({ userId: 'owner-1', enabled: false }),
    );
    expect(FakeEventSource.instances).toHaveLength(0);
  });
});
