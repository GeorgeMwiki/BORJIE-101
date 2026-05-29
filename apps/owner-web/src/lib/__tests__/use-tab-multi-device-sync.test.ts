/**
 * CT-5 multi-device sync — round-trip test.
 *
 * Simulates a brain-emitted `cockpit.tab.spawned` event arriving on
 * Device B while it was originated on Device A. Verifies:
 *   1. The event flows through `useTabMultiDeviceSync`.
 *   2. Device B's tab store sees the new tab.
 *   3. Echo-back to Device A is filtered (originDeviceId match).
 *   4. Latency from publish-to-store-applied is <500 ms target
 *      (timed synchronously — real-world SSE adds the network hop).
 */

import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

// We mock useCockpitStream so the hook receives events synchronously
// without spinning up a real EventSource.
let onEventHandler: ((e: unknown) => void) | null = null;
vi.mock('../cockpit-sse', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../cockpit-sse')>();
  return {
    ...actual,
    useCockpitStream: (opts: { onEvent?: (e: unknown) => void }) => {
      onEventHandler = opts.onEvent ?? null;
      return { connected: true, events: [], error: null };
    },
  };
});

import {
  useTabMultiDeviceSync,
  ensureTabDeviceId,
} from '../use-tab-multi-device-sync';

describe('useTabMultiDeviceSync', () => {
  it('applies a tab.spawned from another device within <500 ms', async () => {
    const start = Date.now();
    // Single hook that BOTH owns the store AND subscribes to sync —
    // mirrors the real cockpit shell where the hook tree is collated.
    const { result: syncResult } = renderHook(() =>
      useTabMultiDeviceSync({
        userId: 'owner-1',
        deviceId: 'device-B',
        language: 'en',
      }),
    );
    expect(syncResult.current.applied).toBe(0);

    // Publish from Device A — Device B (this test) should pick it up.
    await act(async () => {
      onEventHandler?.({
        kind: 'cockpit.tab.spawned',
        tenantId: 'tenant-1',
        emittedAt: new Date().toISOString(),
        userId: 'owner-1',
        tabId: 'finance|focus:gold',
        tabType: 'finance',
        title: 'Gold Quarter',
        config: { mineralKind: 'gold', window: 'quarter' },
        originDeviceId: 'device-A',
        source: 'brain',
      });
    });

    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(500);
    expect(syncResult.current.applied).toBeGreaterThanOrEqual(1);
    expect(syncResult.current.lastAppliedKind).toBe('cockpit.tab.spawned');
  });

  it('SKIPS an echo from the same device (origin matches)', async () => {
    const { result: syncResult } = renderHook(() =>
      useTabMultiDeviceSync({
        userId: 'owner-1',
        deviceId: 'device-A',
      }),
    );

    const before = syncResult.current.applied;

    await act(async () => {
      onEventHandler?.({
        kind: 'cockpit.tab.spawned',
        tenantId: 'tenant-1',
        emittedAt: new Date().toISOString(),
        userId: 'owner-1',
        tabId: 'finance|focus:silver',
        tabType: 'finance',
        title: 'Silver',
        config: { mineralKind: 'gemstone' },
        originDeviceId: 'device-A', // SAME as our deviceId — skip
        source: 'brain',
      });
    });

    expect(syncResult.current.skipped).toBeGreaterThanOrEqual(1);
    // No apply happened (echo filtered out).
    expect(syncResult.current.applied).toBe(before);
  });

  it('SKIPS events for a different userId in the same tenant', async () => {
    const { result: syncResult } = renderHook(() =>
      useTabMultiDeviceSync({
        userId: 'owner-1',
        deviceId: 'device-X',
      }),
    );

    await act(async () => {
      onEventHandler?.({
        kind: 'cockpit.tab.spawned',
        tenantId: 'tenant-1',
        emittedAt: new Date().toISOString(),
        userId: 'OTHER-USER',
        tabId: 'finance|focus:zinc',
        tabType: 'finance',
        title: 'Zinc',
        config: {},
        originDeviceId: 'device-Z',
        source: 'brain',
      });
    });

    expect(syncResult.current.skipped).toBeGreaterThanOrEqual(1);
  });

  it('calls onProposal for cockpit.tab.proposed events', async () => {
    const onProposal = vi.fn();
    renderHook(() =>
      useTabMultiDeviceSync({
        userId: 'owner-1',
        deviceId: 'device-1',
        onProposal,
      }),
    );

    await act(async () => {
      onEventHandler?.({
        kind: 'cockpit.tab.proposed',
        tenantId: 'tenant-1',
        emittedAt: new Date().toISOString(),
        userId: 'owner-1',
        proposalId: 'prop-1',
        tabType: 'finance',
        title: 'Pin Mwadui',
        reasonEn: '3 drills this week',
        reasonSw: null,
        evidenceIds: ['e1'],
        confidence: 0.8,
      });
    });

    expect(onProposal).toHaveBeenCalledTimes(1);
  });
});

describe('ensureTabDeviceId', () => {
  it('returns a stable id within a session', () => {
    const a = ensureTabDeviceId();
    const b = ensureTabDeviceId();
    expect(a).toBe(b);
    expect(a.length).toBeGreaterThan(8);
  });
});
