/**
 * Wave-3-int2 — HITL gate blocks low-confidence proposals.
 *
 * A capture below the matrix row's `min_confidence` MUST NOT produce a
 * proposal at all. A capture above `min_confidence` but below
 * `auto_apply_threshold` MUST produce a `pending_hitl` proposal.
 *
 * This guarantees the platform never auto-applies a low-confidence
 * action — the human is always in the loop until trust is established.
 */

import { describe, it, expect } from 'vitest';
import { createStubHandlerRegistry } from '../handler-registry.js';
import { runDispatchPipeline } from '../dispatcher.js';
import { mkCapture, persona, setupWave3Deps } from './_fixtures.js';

describe('Wave-3-int2 hitl_gate_blocks_low_confidence', () => {
  it('drops capture below min_confidence — no proposals emitted', async () => {
    const deps = setupWave3Deps();
    const handlerRegistry = createStubHandlerRegistry();
    const result = await runDispatchPipeline(
      {
        tenant_id: 'trc',
        capture: mkCapture({ capture_confidence: 0.1 }),
        persona,
      },
      {
        routingRules: deps.routingRules.loader,
        handlerRegistry,
        proposalStore: deps.proposalStore,
        eventLog: deps.eventLog,
        auditSink: deps.auditSink,
      },
    );
    expect(result.proposals.length).toBe(0);
  });

  it('routes capture above min_confidence but below auto_apply to pending_hitl', async () => {
    const deps = setupWave3Deps();
    const handlerRegistry = createStubHandlerRegistry();
    const result = await runDispatchPipeline(
      {
        tenant_id: 'trc',
        capture: mkCapture({ capture_confidence: 0.7 }), // > 0.6 min, < 0.92 auto
        persona,
      },
      {
        routingRules: deps.routingRules.loader,
        handlerRegistry,
        proposalStore: deps.proposalStore,
        eventLog: deps.eventLog,
        auditSink: deps.auditSink,
      },
    );
    expect(result.proposals.length).toBeGreaterThan(0);
    for (const p of result.proposals) {
      // Every proposal must be HITL-gated.
      expect(p.status).toBe('pending_hitl');
    }
  });

  it('high-confidence non-HITL row still respects GLOBAL_AUTO_APPLY_FLOOR', async () => {
    const deps = setupWave3Deps();
    const handlerRegistry = createStubHandlerRegistry();
    // confidence 0.84 — above L-ROW-03 auto_apply (0.85)? NO — just below
    // the global floor (0.85). So auto-apply must NOT fire.
    const result = await runDispatchPipeline(
      {
        tenant_id: 'trc',
        capture: mkCapture({
          intent: 'file_event',
          capture_confidence: 0.84,
          entities: [
            {
              type: 'lease',
              canonical_id: 'le_1',
              raw_value: 'lease',
              confidence: 0.95,
              source: 'exact',
            },
          ],
        }),
        persona,
      },
      {
        routingRules: deps.routingRules.loader,
        handlerRegistry,
        proposalStore: deps.proposalStore,
        eventLog: deps.eventLog,
        auditSink: deps.auditSink,
      },
    );
    const leaseEvt = result.proposals.find((p) => p.action === 'append_lease_event');
    expect(leaseEvt).toBeDefined();
    expect(leaseEvt!.status).toBe('pending_hitl');
  });
});
