/**
 * Wave-3-int2 — payment observation routes to FINANCE / LITFIN.
 *
 * A "Mr Juma paid 200k" file_event with an `amount` entity must produce
 * a proposal whose module_template_id is LITFIN (the platform's money
 * tab) and action is `raise_invoice` — confirming the dispatcher walks
 * the matrix correctly for the money path.
 *
 * Per the hard rule, money mutations go through LedgerService.post() —
 * but THIS test only verifies routing. The handler (post_receipt_draft)
 * is covered by the registry tests.
 */

import { describe, it, expect } from 'vitest';
import { createStubHandlerRegistry } from '../handler-registry.js';
import { runDispatchPipeline } from '../dispatcher.js';
import {
  mkCapture,
  persona,
  setupWave3Deps,
} from './_fixtures.js';
import type { ResolvedEntity } from '../types.js';

describe('Wave-3-int2 dispatcher_routes_payment_observation_to_finance', () => {
  it('routes an amount file_event to LITFIN', async () => {
    const deps = setupWave3Deps();
    const handlerRegistry = createStubHandlerRegistry();

    const amountEntity: ResolvedEntity = {
      type: 'amount',
      canonical_id: 'amt_200k_tzs',
      raw_value: '200,000 TZS',
      confidence: 0.95,
      source: 'regex_currency',
    };

    const capture = mkCapture({
      entities: [amountEntity],
      intent: 'propose_action', // raise_invoice is propose_action
      capture_confidence: 0.85,
    });

    const result = await runDispatchPipeline(
      {
        tenant_id: 'trc',
        capture,
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

    const litfin = result.proposals.find(
      (p) => p.module_template_id === 'LITFIN' && p.action === 'raise_invoice',
    );
    expect(litfin).toBeDefined();
    expect(litfin!.matrix_row_id).toBe('L-ROW-05');
    expect(litfin!.priority).toBe('high');
  });

  it('emits HITL gate (hitl_required=true) for the money path', async () => {
    const deps = setupWave3Deps();
    const handlerRegistry = createStubHandlerRegistry();
    const capture = mkCapture({
      entities: [
        {
          type: 'amount',
          canonical_id: 'amt_1',
          raw_value: '500,000',
          confidence: 0.95,
          source: 'regex_currency',
        },
      ],
      intent: 'propose_action',
      capture_confidence: 0.95, // above L-ROW-05.auto_apply_threshold (0.9)
    });

    const result = await runDispatchPipeline(
      { tenant_id: 'trc', capture, persona },
      {
        routingRules: deps.routingRules.loader,
        handlerRegistry,
        proposalStore: deps.proposalStore,
        eventLog: deps.eventLog,
        auditSink: deps.auditSink,
      },
    );

    const litfin = result.proposals.find((p) => p.module_template_id === 'LITFIN');
    expect(litfin).toBeDefined();
    expect(litfin!.hitl_required).toBe(true);
    // Even though confidence > auto_apply_threshold, hitl_required=true
    // means status STAYS pending_hitl. Money path must not auto-execute.
    expect(litfin!.status).toBe('pending_hitl');
  });
});
