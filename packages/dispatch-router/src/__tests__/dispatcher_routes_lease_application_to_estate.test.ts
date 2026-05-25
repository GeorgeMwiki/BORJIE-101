/**
 * Wave-3-int2 — dispatcher routes a lease-application capture to ESTATE.
 *
 * Verifies the END-TO-END contract: a chat capture with a customer +
 * unit entity at propose_action intent emits a proposal whose
 * (module_template_id, action) pair is the ESTATE.create_lease_application
 * row from the PLATFORM_ROUTING_MATRIX.
 */

import { describe, it, expect } from 'vitest';
import { createStubHandlerRegistry } from '../handler-registry.js';
import { runDispatchPipeline } from '../dispatcher.js';
import {
  mkCapture,
  persona,
  setupWave3Deps,
} from './_fixtures.js';

describe('Wave-3-int2 dispatcher_routes_lease_application_to_estate', () => {
  it('routes a propose_action chat capture to ESTATE.create_lease_application', async () => {
    const deps = setupWave3Deps();
    const handlerRegistry = createStubHandlerRegistry();

    const result = await runDispatchPipeline(
      {
        tenant_id: 'trc',
        capture: mkCapture(),
        persona,
      },
      {
        routingRules: deps.routingRules.loader,
        handlerRegistry,
        proposalStore: deps.proposalStore,
        eventLog: deps.eventLog,
        auditSink: deps.auditSink,
        randomId: deps.randomId,
        clock: deps.clock,
      },
    );

    expect(result.proposals.length).toBeGreaterThan(0);
    const lease = result.proposals.find(
      (p) =>
        p.module_template_id === 'ESTATE' &&
        p.action === 'create_lease_application',
    );
    expect(lease).toBeDefined();
    expect(lease!.priority).toBe('high');
    expect(lease!.matrix_row_id).toBe('L-ROW-01');
    // High-risk action must be HITL even at high confidence.
    expect(lease!.hitl_required).toBe(true);
    expect(lease!.status).toBe('pending_hitl');
  });

  it('captures the customer + unit canonical ids on the proposal entity_refs', async () => {
    const deps = setupWave3Deps();
    const handlerRegistry = createStubHandlerRegistry();
    const result = await runDispatchPipeline(
      {
        tenant_id: 'trc',
        capture: mkCapture(),
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
    const lease = result.proposals.find(
      (p) => p.action === 'create_lease_application',
    );
    expect(lease).toBeDefined();
    const types = lease!.entity_refs.map((e) => e.type);
    expect(types).toContain('customer');
    expect(types).toContain('unit');
    const customer = lease!.entity_refs.find((e) => e.type === 'customer');
    expect(customer!.canonical_id).toBe('cust_juma_x');
  });
});
