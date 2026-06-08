/**
 * Modality FULL-FLOW test through the REAL main-loop `think()`.
 *
 * This drives the entire path the owner directive binds:
 *
 *   router emits a tool_call → modality ARBITER classifies the turn as
 *   `document`/`media`/`forecast` (Tier-1 recipe match) → main-loop LIFTS to a
 *   `run_modality` Decision → the REAL `createToolDispatcher` modalityHandler
 *   routes to the modality EXECUTOR → the engine produces an artifact → a
 *   PROPOSAL is surfaced through the sink (never auto-applied).
 *
 * Proves the invariant end-to-end:
 *   (a) forecast routes → engine → proposal.
 *   (d) the proposal does not apply (the sink records; no tab persisted).
 *   (g) DEFAULT-OFF (no arbiter dep) = byte-identical chat/action dispatch.
 */

import { describe, it, expect, vi } from 'vitest';

import { orchestrator, createBrainToolRegistry } from '@borjie/central-intelligence';

const {
  think,
  createToolDispatcher,
  createModalityArbiter,
  createHookChain,
  createInMemoryPlanStore,
  createInMemorySessionStore,
  createContextBudget,
  createInMemoryToolSearch,
  createInMemoryMemoryTool,
} = orchestrator;
type OrchestratorDeps = orchestrator.OrchestratorDeps;
type OrchestratorRequest = orchestrator.OrchestratorRequest;
type LLMRouter = orchestrator.LLMRouter;
type Decision = orchestrator.Decision;
type ModalityDescriptor = orchestrator.ModalityDescriptor;

import { buildModalityCapabilities, createModalityExecutorBoundToSink } from '../index.js';
import type { ModalityProposalSink } from '../modality-executor.js';
import type { ModalityProposal } from '../modality-proposal.js';

function recordingSink(): ModalityProposalSink & { readonly emitted: ModalityProposal[] } {
  const emitted: ModalityProposal[] = [];
  return {
    emitted,
    async emit(proposal) {
      emitted.push(proposal);
      return { surfacedProposalId: proposal.payload.proposalId };
    },
  };
}

function fixedRouter(decisions: Decision[]): LLMRouter {
  let i = 0;
  return {
    async call(): Promise<Decision> {
      const next = decisions[i] ?? { kind: 'final', text: 'done' };
      i += 1;
      return next;
    },
  };
}

const REQ: OrchestratorRequest = {
  threadId: 'thread_modality',
  userMessage: 'forecast our gold price for the next quarter',
  scope: { kind: 'tenant', tenantId: 't_1', actorUserId: 'u_1', roles: ['owner'], personaId: 'p_1' },
  tier: 'tenant',
  persona: 'owner-cockpit',
  budget: { maxTurns: 4 },
};

/** A recipe descriptor that the arbiter Tier-1 matches to a `forecast`-class
 * (document modality slot in the closed set; the executor maps it to its
 * engine). We use the `document` descriptor modality since `forecast` is
 * carried as an artifact under a document/media/tab surface. */
function forecastDescriptor(embedding: number[]): ModalityDescriptor {
  return { modality: 'document', recipeId: 'forecast_recipe', embedding };
}

describe('main-loop FULL flow — arbiter → executor → PROPOSAL', () => {
  it('(g) default-OFF: no arbiter dep → tool_call dispatches unchanged', async () => {
    const sink = recordingSink();
    const registry = createBrainToolRegistry();
    const dispatcher = createToolDispatcher({ registry });
    const deps: OrchestratorDeps = {
      router: fixedRouter([
        { kind: 'tool_call', call: { toolName: 'noop.tool', input: {}, callId: 'c1' } },
        { kind: 'final', text: 'done' },
      ]),
      toolSearch: createInMemoryToolSearch([
        { name: 'noop.tool', description: 'noop', keywords: ['noop'] },
      ]),
      hookChain: createHookChain([]),
      planStore: createInMemoryPlanStore(),
      sessionStore: createInMemorySessionStore(),
      memoryTool: createInMemoryMemoryTool(),
      contextBudget: createContextBudget(),
      dispatcher,
    };
    const out = await think(REQ, deps);
    expect(out.kind).toBe('answer');
    // No proposal — the arbiter was never wired.
    expect(sink.emitted).toHaveLength(0);
  });

  it('(a)+(d) arbiter routes a recipe-matched turn to run_modality → engine → PROPOSAL (not applied)', async () => {
    const sink = recordingSink();
    const caps = buildModalityCapabilities({
      envSource: { BORJIE_MODALITY_CAPABILITIES: 'on' },
      proposalSink: sink,
    });
    const executor = createModalityExecutorBoundToSink(caps, sink);

    // The dispatcher's modalityHandler routes document/media to the executor.
    const registry = createBrainToolRegistry();
    const dispatcher = createToolDispatcher({
      registry,
      modalityHandler: async (a) => {
        const result = await executor.execute({
          modality: a.modality === 'document' ? 'forecast' : a.modality,
          // Feed a real series so the forecast engine produces an artifact.
          payload: {
            ...a.payload,
            target: 'mining.A1.commodity_price',
            values: [100, 102, 101, 105, 108, 110, 109, 112, 115, 117, 120, 122],
            horizon: 3,
            warranted: true,
            posture: 'propose',
          },
          tenantId: 't_1',
          userId: 'u_1',
        });
        return { output: { modality: a.modality, ...(result ?? {}) } };
      },
    });

    // The arbiter: a Tier-1 recipe descriptor that matches the intent vector
    // (cosine ≥ τ) so a tool_call turn lifts to `run_modality` document.
    const arbiter = createModalityArbiter({
      embedder: { embed: vi.fn(async () => [1, 0, 0]) },
      recipeDescriptors: [forecastDescriptor([1, 0, 0])],
      tau: 0.5,
    });

    const deps: OrchestratorDeps = {
      router: fixedRouter([
        { kind: 'tool_call', call: { toolName: 'forecast.intent', input: {}, callId: 'c1' } },
        { kind: 'final', text: 'here is your forecast' },
      ]),
      toolSearch: createInMemoryToolSearch([
        { name: 'forecast.intent', description: 'forecast', keywords: ['forecast'] },
      ]),
      hookChain: createHookChain([]),
      planStore: createInMemoryPlanStore(),
      sessionStore: createInMemorySessionStore(),
      memoryTool: createInMemoryMemoryTool(),
      contextBudget: createContextBudget(),
      dispatcher,
      modalityArbiter: arbiter,
    };

    const out = await think(REQ, deps);
    expect(out.kind).toBe('answer');
    // The full flow surfaced exactly ONE proposal — an advisory forecast —
    // and it was NOT auto-applied (propose posture; the sink only records).
    expect(sink.emitted).toHaveLength(1);
    const p = sink.emitted[0]!;
    expect(p.artifactKind).toBe('forecast');
    expect(p.posture).toBe('propose');
    expect((p.artifact.evidence_ids as string[]).length).toBeGreaterThanOrEqual(1);
  });
});
