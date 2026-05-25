/**
 * Wave-3-int2 — missing routing rule falls through (no proposal, no crash).
 *
 * When a capture has an entity type / intent pair that no matrix row
 * covers, the dispatcher must:
 *   - return an empty proposal array
 *   - NOT throw an exception
 *   - NOT append a spurious audit row
 *
 * This is the "soft fail" contract — the brain can produce captures the
 * platform doesn't know what to do with, and the dispatcher gracefully
 * declines instead of escalating.
 */

import { describe, it, expect } from 'vitest';
import { createStubHandlerRegistry } from '../handler-registry.js';
import { runDispatchPipeline, mergeMatrices } from '../dispatcher.js';
import { mkCapture, persona, setupWave3Deps } from './_fixtures.js';

describe('Wave-3-int2 missing_routing_rule_falls_through', () => {
  it('returns empty proposals when no matrix row matches', async () => {
    const deps = setupWave3Deps();
    const handlerRegistry = createStubHandlerRegistry();
    // request_info intent has NO matrix rows in PLATFORM_ROUTING_MATRIX.
    const result = await runDispatchPipeline(
      {
        tenant_id: 'trc',
        capture: mkCapture({ intent: 'request_info', capture_confidence: 0.95 }),
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
    expect(result.proposals).toEqual([]);
  });

  it('does NOT crash when routingRules loader returns empty', async () => {
    const deps = setupWave3Deps();
    const handlerRegistry = createStubHandlerRegistry();
    // The default in-memory loader has no rows seeded.
    // We expect platform defaults to still apply.
    const result = await runDispatchPipeline(
      {
        tenant_id: 'trc',
        capture: mkCapture({ capture_confidence: 0.75 }),
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
    // Without tenant overrides, platform defaults produce proposals.
    expect(result.proposals.length).toBeGreaterThan(0);
    expect(result.tenantOverrideCount).toBe(0);
  });

  it('does NOT append any audit rows when no proposals fire', async () => {
    const deps = setupWave3Deps();
    const handlerRegistry = createStubHandlerRegistry();
    await runDispatchPipeline(
      {
        tenant_id: 'trc',
        capture: mkCapture({ intent: 'request_info', capture_confidence: 0.95 }),
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
    const chain = deps.auditSink.snapshot('trc');
    expect(chain.length).toBe(0);
  });

  it('mergeMatrices with empty inputs returns empty matrix', () => {
    const merged = mergeMatrices([], []);
    expect(merged).toEqual([]);
  });

  it('matrix size + override count reflect dispatcher input', async () => {
    const deps = setupWave3Deps();
    const handlerRegistry = createStubHandlerRegistry();

    // Inject 2 overrides.
    deps.routingRules.store.add({
      id: 'OVR_1',
      entity_type: 'customer',
      intent: 'ask_for_help',
      module_template_id: 'CRM',
      action: 'open_ticket',
      min_confidence: 0.4,
      auto_apply_threshold: 0.9,
      hitl_required: true,
      priority: 'medium',
      min_approver_tier: 3,
      jurisdiction: '*',
      tenant_scope: 'trc',
    });
    deps.routingRules.store.add({
      id: 'OVR_2',
      entity_type: 'amount',
      intent: 'ask_for_help',
      module_template_id: 'CRM',
      action: 'open_ticket',
      min_confidence: 0.4,
      auto_apply_threshold: 0.9,
      hitl_required: true,
      priority: 'medium',
      min_approver_tier: 3,
      jurisdiction: '*',
      tenant_scope: 'trc',
    });

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
    expect(result.tenantOverrideCount).toBeGreaterThanOrEqual(2);
    // matrixSize includes platform defaults + overrides — at least 17.
    expect(result.matrixSize).toBeGreaterThanOrEqual(17);
  });
});
