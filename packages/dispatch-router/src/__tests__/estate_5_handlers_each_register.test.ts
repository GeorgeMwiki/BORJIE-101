/**
 * Wave-3-int2 — ESTATE 5-handler registry contract test.
 *
 * Verifies that a registry built with the 5 ESTATE actions answers
 * `.get(ESTATE, action)` for each. Uses a local fake registry that
 * mirrors the shape of `@borjie/module-templates/registry` so the
 * dispatch-router package stays free of a circular workspace dep.
 *
 * Module-templates' OWN integration test in
 * `packages/module-templates/src/__tests__/registry.test.ts` covers the
 * real builder + adapter wiring.
 */

import { describe, it, expect } from 'vitest';
import type {
  AcceptHandler,
  AcceptHandlerRegistry,
} from '../types.js';
import { runDispatchPipeline } from '../dispatcher.js';
import { mkCapture, persona, setupWave3Deps } from './_fixtures.js';

const ESTATE_ACTIONS = [
  'create_lease_application',
  'post_receipt_draft',
  'open_maintenance_case',
  'schedule_renewal_negotiation',
  'bulk_mark_for_renewal_prep',
] as const;

function buildFakeEstateRegistry(): AcceptHandlerRegistry & {
  readonly invoked: ReadonlyArray<{ module: string; action: string }>;
} {
  const handlers = new Map<string, AcceptHandler>();
  const invoked: Array<{ module: string; action: string }> = [];
  for (const action of ESTATE_ACTIONS) {
    handlers.set(`ESTATE::${action}`, async (args) => {
      invoked.push({ module: args.proposal.module_template_id, action: args.proposal.action });
      return {
        ok: true,
        artifacts: [{ type: 'fake_artifact', id: `${action}_${args.proposal.id}` }],
      };
    });
  }
  return {
    get(moduleTemplateId, action) {
      return handlers.get(`${moduleTemplateId}::${action}`);
    },
    get invoked() {
      return invoked;
    },
  };
}

describe('Wave-3-int2 estate_5_handlers_each_register', () => {
  it('all 5 actions are .get()-able on the registry', () => {
    const registry = buildFakeEstateRegistry();
    for (const action of ESTATE_ACTIONS) {
      const handler = registry.get('ESTATE', action);
      expect(handler).toBeDefined();
      expect(typeof handler).toBe('function');
    }
  });

  it('non-registered action returns undefined', () => {
    const registry = buildFakeEstateRegistry();
    const handler = registry.get('ESTATE', 'nonexistent_action');
    expect(handler).toBeUndefined();
  });

  it('non-registered module returns undefined', () => {
    const registry = buildFakeEstateRegistry();
    const handler = registry.get('OTHER_MODULE', 'create_lease_application');
    expect(handler).toBeUndefined();
  });

  it('dispatcher invokes registered handler when auto-applying', async () => {
    const deps = setupWave3Deps();
    const registry = buildFakeEstateRegistry();
    // Set up a capture that lands on L-ROW-03 (lease + file_event,
    // hitl_required=false, auto_apply_threshold=0.85). Plus we override
    // ESTATE::append_lease_event with our fake handler.
    registry; // already created.
    const handlers = new Map<string, AcceptHandler>();
    const invocations: string[] = [];
    handlers.set('ESTATE::append_lease_event', async (args) => {
      invocations.push(args.proposal.id);
      return { ok: true, artifacts: [] };
    });
    // Compose a registry: lease_event handler + 5 estate stubs.
    const composed: AcceptHandlerRegistry = {
      get(moduleTemplateId, action) {
        const direct = handlers.get(`${moduleTemplateId}::${action}`);
        if (direct) return direct;
        return registry.get(moduleTemplateId, action);
      },
    };

    const result = await runDispatchPipeline(
      {
        tenant_id: 'trc',
        capture: mkCapture({
          intent: 'file_event',
          capture_confidence: 0.95,
          entities: [
            {
              type: 'lease',
              canonical_id: 'le_juma_godown3',
              raw_value: 'le_juma_godown3',
              confidence: 0.95,
              source: 'exact',
            },
          ],
        }),
        persona,
      },
      {
        routingRules: deps.routingRules.loader,
        handlerRegistry: composed,
        proposalStore: deps.proposalStore,
        eventLog: deps.eventLog,
        auditSink: deps.auditSink,
      },
    );

    const appendEvt = result.proposals.find((p) => p.action === 'append_lease_event');
    expect(appendEvt).toBeDefined();
    // Auto-apply triggered the handler — invocations must contain its id.
    expect(invocations).toContain(appendEvt!.id);
  });
});
