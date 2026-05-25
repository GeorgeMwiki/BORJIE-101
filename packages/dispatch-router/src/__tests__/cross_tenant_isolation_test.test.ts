/**
 * Wave-3-int2 — cross-tenant isolation in the dispatch pipeline.
 *
 * Two captures from different tenants MUST produce proposals only on
 * their own tenant. Tenant A's override rules MUST NOT affect Tenant B.
 * Tenant A's proposals MUST NOT be visible to Tenant B.
 *
 * This is the audit invariant we cannot break — RLS protects the DB at
 * the table level, but the dispatcher's in-memory matrix needs equal
 * discipline.
 */

import { describe, it, expect } from 'vitest';
import { createStubHandlerRegistry } from '../handler-registry.js';
import { runDispatchPipeline } from '../dispatcher.js';
import { mkCapture, persona, setupWave3Deps } from './_fixtures.js';
import type { RoutingMatrixRow } from '../types.js';

describe('Wave-3-int2 cross_tenant_isolation', () => {
  it("tenant A's routing-rules override does not leak to tenant B", async () => {
    const deps = setupWave3Deps();
    const handlerRegistry = createStubHandlerRegistry();

    // Tenant A registers a fake high-priority override row.
    const overrideRow: RoutingMatrixRow = {
      id: 'TENANT_A_OVERRIDE_1',
      entity_type: 'customer',
      intent: 'propose_action',
      module_template_id: 'ESTATE',
      action: 'create_lease_application',
      min_confidence: 0.5,
      auto_apply_threshold: 0.55, // very generous — would auto-apply!
      hitl_required: false, // bypass HITL
      priority: 'critical',
      min_approver_tier: 1,
      jurisdiction: '*',
      tenant_scope: 'tenant_a',
    };
    deps.routingRules.store.add(overrideRow);

    // Tenant B dispatches a capture — must NOT see tenant A's override.
    const tenantBCapture = mkCapture({
      tenant_id: 'tenant_b',
      id: 'cap_b_1',
      capture_confidence: 0.7,
    });

    const result = await runDispatchPipeline(
      { tenant_id: 'tenant_b', capture: tenantBCapture, persona },
      {
        routingRules: deps.routingRules.loader,
        handlerRegistry,
        proposalStore: deps.proposalStore,
        eventLog: deps.eventLog,
        auditSink: deps.auditSink,
      },
    );

    // tenant_b uses ONLY the platform-default ESTATE row (hitl_required=true).
    const lease = result.proposals.find(
      (p) => p.module_template_id === 'ESTATE' && p.action === 'create_lease_application',
    );
    expect(lease).toBeDefined();
    expect(lease!.matrix_row_id).toBe('L-ROW-01'); // platform row, NOT override
    expect(lease!.hitl_required).toBe(true);
    expect(lease!.priority).toBe('high'); // NOT critical
    expect(lease!.tenant_id).toBe('tenant_b'); // own tenant only
  });

  it("tenant A's proposals do not appear in tenant B's snapshot", async () => {
    const deps = setupWave3Deps();
    const handlerRegistry = createStubHandlerRegistry();

    await runDispatchPipeline(
      { tenant_id: 'tenant_a', capture: mkCapture({ tenant_id: 'tenant_a', id: 'cap_a_1' }), persona },
      {
        routingRules: deps.routingRules.loader,
        handlerRegistry,
        proposalStore: deps.proposalStore,
        eventLog: deps.eventLog,
        auditSink: deps.auditSink,
      },
    );
    await runDispatchPipeline(
      { tenant_id: 'tenant_b', capture: mkCapture({ tenant_id: 'tenant_b', id: 'cap_b_2' }), persona },
      {
        routingRules: deps.routingRules.loader,
        handlerRegistry,
        proposalStore: deps.proposalStore,
        eventLog: deps.eventLog,
        auditSink: deps.auditSink,
      },
    );

    const propsA = await deps.proposalStore.listByTenant('tenant_a');
    const propsB = await deps.proposalStore.listByTenant('tenant_b');
    expect(propsA.length).toBeGreaterThan(0);
    expect(propsB.length).toBeGreaterThan(0);
    expect(propsA.every((p) => p.tenant_id === 'tenant_a')).toBe(true);
    expect(propsB.every((p) => p.tenant_id === 'tenant_b')).toBe(true);
    // No row should appear in BOTH lists.
    const idsA = new Set(propsA.map((p) => p.id));
    const idsB = new Set(propsB.map((p) => p.id));
    for (const id of idsA) expect(idsB.has(id)).toBe(false);
  });
});
