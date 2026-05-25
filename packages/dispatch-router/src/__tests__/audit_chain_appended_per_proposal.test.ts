/**
 * Wave-3-int2 — every proposal hash-chains into ai_audit_chain.
 *
 * The hash-chain is the tamper-evident AI-turn log. Every proposal
 * created by the dispatcher MUST trigger an audit chain append. The
 * audit row's prev_hash must equal the previous row's this_hash, so the
 * chain is verifiable end-to-end.
 */

import { describe, it, expect } from 'vitest';
import { createStubHandlerRegistry } from '../handler-registry.js';
import { runDispatchPipeline } from '../dispatcher.js';
import { mkCapture, persona, setupWave3Deps } from './_fixtures.js';

describe('Wave-3-int2 audit_chain_appended_per_proposal', () => {
  it('appends an audit row per proposal', async () => {
    const deps = setupWave3Deps();
    const handlerRegistry = createStubHandlerRegistry();
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

    expect(result.proposals.length).toBeGreaterThan(0);
    const chain = deps.auditSink.snapshot('trc');
    const proposalRows = chain.filter((c) => c.action === 'proposal_created');
    // One audit row per proposal — the chain length must be ≥ proposal count.
    expect(proposalRows.length).toBe(result.proposals.length);
  });

  it('the chain is hash-linked: each prev_hash matches the previous this_hash', async () => {
    const deps = setupWave3Deps();
    const handlerRegistry = createStubHandlerRegistry();
    await runDispatchPipeline(
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

    const chain = deps.auditSink.snapshot('trc');
    expect(chain.length).toBeGreaterThan(1);
    for (let i = 1; i < chain.length; i++) {
      const prev = chain[i - 1];
      const cur = chain[i];
      expect(prev).toBeDefined();
      expect(cur).toBeDefined();
      expect(cur!.prev_hash).toBe(prev!.this_hash);
      // sequence_id must increase strictly.
      expect(cur!.sequence_id).toBe(prev!.sequence_id + 1);
    }
  });

  it('genesis link prev_hash is GENESIS for a brand-new tenant chain', async () => {
    const deps = setupWave3Deps();
    const handlerRegistry = createStubHandlerRegistry();
    await runDispatchPipeline(
      {
        tenant_id: 'new_tenant_zzz',
        capture: mkCapture({ tenant_id: 'new_tenant_zzz' }),
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
    const chain = deps.auditSink.snapshot('new_tenant_zzz');
    expect(chain.length).toBeGreaterThan(0);
    expect(chain[0]!.prev_hash).toBe('GENESIS');
    expect(chain[0]!.sequence_id).toBe(1);
  });
});
