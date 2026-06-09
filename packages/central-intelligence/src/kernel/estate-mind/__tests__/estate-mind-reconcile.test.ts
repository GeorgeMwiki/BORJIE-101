/**
 * EstateMind RECONCILE-step tests (the DEFERRAL / FOLLOW-THROUGH sweep wired
 * into the resident Slow Loop between ORIENT and PROPOSE).
 *
 * Covers:
 *   - the tick CALLS the injected reconciliation port and threads its summary
 *     into the tick result;
 *   - a reconcile FAULT degrades the tick (degradedReason) but NEVER throws —
 *     the heartbeat is never broken;
 *   - when no reconciliation port is wired, the tick runs exactly as before
 *     (the deferral organ is purely additive) and `reconcile` is null.
 */

import { describe, it, expect } from 'vitest';

import {
  createInMemorySituationalModelStore,
  createSituationalModel,
} from '../../situational-model/index.js';
import { createMotivationEngine } from '../../motivation/index.js';
import { createEstateMind } from '../index.js';
import type { ReconciliationPort, ReconcileResult } from '../index.js';

const T = 'tenant-A';

function build(reconciliation: ReconciliationPort | null) {
  const now = () => 1000;
  const store = createInMemorySituationalModelStore({ now });
  const situationalModel = createSituationalModel({ store, now });
  const motivation = createMotivationEngine({ now });
  return createEstateMind({
    situationalModel,
    motivation,
    perception: null,
    proposalSink: null,
    reconciliation,
    now,
  });
}

describe('EstateMind — RECONCILE step', () => {
  it('calls the reconciliation port and threads its summary into the tick result', async () => {
    const summary: ReconcileResult = {
      reviewed: 3,
      surfaced: 2,
      escalated: 1,
      confirmed: 0,
      reopened: 0,
      degradedReason: null,
    };
    let called = false;
    const port: ReconciliationPort = {
      async reconcile(input) {
        called = true;
        expect(input.tenantId).toBe(T);
        return summary;
      },
    };

    const mind = build(port);
    const result = await mind.tick(T);
    expect(called).toBe(true);
    expect(result.reconcile).toEqual(summary);
    expect(result.degradedReason).toBeNull();
  });

  it('a reconcile FAULT degrades the tick but never throws', async () => {
    const port: ReconciliationPort = {
      async reconcile() {
        throw new Error('reconcile blew up');
      },
    };
    const mind = build(port);
    const result = await mind.tick(T);
    // The tick completed (did not throw) and recorded the degradation.
    expect(result.degradedReason).toBe('reconcile-failed');
    expect(result.reconcile).toBeNull();
  });

  it('is purely additive — no reconciliation port → tick runs as before, reconcile is null', async () => {
    const mind = build(null);
    const result = await mind.tick(T);
    expect(result.reconcile).toBeNull();
    expect(result.degradedReason).toBeNull();
  });
});
