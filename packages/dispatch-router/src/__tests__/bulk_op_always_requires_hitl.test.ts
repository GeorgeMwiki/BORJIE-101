/**
 * Wave-3-int2 — bulk ops ALWAYS require HITL.
 *
 * Even when a tenant override row sets `hitl_required: false` for an
 * action whose name starts with `bulk_`, the dispatcher MUST force HITL.
 * This is a platform-level invariant.
 */

import { describe, it, expect } from 'vitest';
import { createStubHandlerRegistry } from '../handler-registry.js';
import { runDispatchPipeline, mergeMatrices } from '../dispatcher.js';
import { mkCapture, persona, setupWave3Deps, bulkOpMatrixRow } from './_fixtures.js';
import { PLATFORM_ROUTING_MATRIX } from '../matrix-defaults.js';

describe('Wave-3-int2 bulk_op_always_requires_hitl', () => {
  it('mergeMatrices forces hitl_required=true on any bulk_* row', () => {
    // Tenant override row tries to disable HITL on a bulk op.
    const tenantBulk = { ...bulkOpMatrixRow, tenant_scope: 'trc', hitl_required: false };
    const merged = mergeMatrices(PLATFORM_ROUTING_MATRIX, [tenantBulk]);
    const found = merged.find((r) => r.action === 'bulk_mark_for_renewal_prep');
    expect(found).toBeDefined();
    // Bulk action MUST be HITL regardless of override.
    expect(found!.hitl_required).toBe(true);
  });

  it('dispatch emits pending_hitl proposal even at max confidence for a bulk op', async () => {
    const deps = setupWave3Deps();
    deps.routingRules.store.add({
      ...bulkOpMatrixRow,
      tenant_scope: 'trc',
      hitl_required: false, // override attempts to bypass HITL
    });

    const handlerRegistry = createStubHandlerRegistry();
    const result = await runDispatchPipeline(
      {
        tenant_id: 'trc',
        capture: mkCapture({
          intent: 'propose_action',
          capture_confidence: 0.99, // max confidence
          entities: [
            {
              type: 'lease',
              canonical_id: 'le_1',
              raw_value: 'lease 1',
              confidence: 0.99,
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

    const bulk = result.proposals.find(
      (p) => p.action === 'bulk_mark_for_renewal_prep',
    );
    expect(bulk).toBeDefined();
    expect(bulk!.status).toBe('pending_hitl');
    expect(bulk!.hitl_required).toBe(true);
  });

  it('non-bulk rows respect their hitl_required as-set', () => {
    const merged = mergeMatrices(PLATFORM_ROUTING_MATRIX, []);
    const leaseEvt = merged.find((r) => r.action === 'append_lease_event');
    expect(leaseEvt).toBeDefined();
    expect(leaseEvt!.hitl_required).toBe(false); // L-ROW-03 is auto-applyable
  });
});
