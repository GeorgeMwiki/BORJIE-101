/**
 * Modality arbiter (COG-07/AUT-14) — unit tests.
 *
 * Proves the 3-tier cascade routes correctly, fails closed to `chat`, never
 * lets the autonomy verdict relax a rail (escalate-only), routes
 * capability-growth through the body-change syscall (the meta-rail), and
 * that the lift is a no-op for chat/action so money/licence tool_calls stay
 * tool_calls that hit the existing gate.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createModalityArbiter,
  liftToModalityDecision,
  DEFAULT_MODALITY_TAU,
} from '../modality-arbiter.js';
import type {
  ArbiterEmbedderPort,
  ModalityArbiterDeps,
  AutonomyDeciderPort,
  SkillRetrieverPort,
  FlowRetrieverPort,
  BodyChangePort,
} from '../modality-arbiter-types.js';
import type { Decision } from '../decision.js';

// A deterministic embedder that returns a fixed unit-ish vector so the
// retriever stubs (which return their own scores) drive routing.
function fixedEmbedder(vec: ReadonlyArray<number> = [1, 0, 0]): ArbiterEmbedderPort {
  return { embed: vi.fn(async () => vec) };
}

const TOOL_CALL: Decision = {
  kind: 'tool_call',
  call: { toolName: 'arrears.lookup', input: { tenantId: 't1' }, callId: 'c1' },
};
const RESPOND: Decision = { kind: 'respond_to_owner', text: 'hello' };

function baseInput(decision: Decision, overrides: Record<string, unknown> = {}) {
  return {
    intentText: 'recover the tenant arrears',
    decision,
    tenantId: 't1',
    calibratedConfidence: 0.9,
    ...overrides,
  };
}

describe('modality-arbiter — Tier 0 short-circuit', () => {
  it('routes a pure text answer to chat WITHOUT calling the embedder', async () => {
    const embedder = fixedEmbedder();
    const arb = createModalityArbiter({ embedder });
    const verdict = await arb.classify(baseInput(RESPOND));
    expect(verdict.modality).toBe('chat');
    expect(verdict.tier).toBe('tier0');
    expect(embedder.embed).not.toHaveBeenCalled();
  });

  it('keeps a tool_call with no matching skill/flow as action', async () => {
    const embedder = fixedEmbedder();
    const arb = createModalityArbiter({
      embedder,
      skillRetriever: { retrieve: vi.fn(async () => []) },
      flowRetriever: { retrieve: vi.fn(async () => []) },
    });
    const verdict = await arb.classify(baseInput(TOOL_CALL));
    // Tier 1 found nothing ≥ τ and there is no tie-break port → action.
    expect(verdict.modality).toBe('action');
  });
});

describe('modality-arbiter — Tier 1 nearest-neighbour', () => {
  it('routes to skill when an active+reviewed skill matches ≥ τ', async () => {
    const skillRetriever: SkillRetrieverPort = {
      retrieve: vi.fn(async () => [
        { skillId: 's_arrears', score: 0.92, humanReviewed: true, status: 'active' as const },
      ]),
    };
    const arb = createModalityArbiter({ embedder: fixedEmbedder(), skillRetriever });
    const verdict = await arb.classify(baseInput(TOOL_CALL));
    expect(verdict.modality).toBe('skill');
    expect(verdict.skillId).toBe('s_arrears');
    expect(verdict.tier).toBe('tier1');
    expect(verdict.score).toBeGreaterThanOrEqual(DEFAULT_MODALITY_TAU);
  });

  it('does NOT select an un-reviewed skill (human_reviewed=false)', async () => {
    const skillRetriever: SkillRetrieverPort = {
      retrieve: vi.fn(async () => [
        { skillId: 's_x', score: 0.99, humanReviewed: false, status: 'active' as const },
      ]),
    };
    const arb = createModalityArbiter({ embedder: fixedEmbedder(), skillRetriever });
    const verdict = await arb.classify(baseInput(TOOL_CALL));
    expect(verdict.modality).not.toBe('skill');
  });

  it('routes to workflow with loopKind set when a standing-loop flow matches', async () => {
    const flowRetriever: FlowRetrieverPort = {
      retrieve: vi.fn(async () => [
        { flowId: 'f_watch', score: 0.9, loopKind: 'reactive' as const },
      ]),
    };
    const arb = createModalityArbiter({ embedder: fixedEmbedder(), flowRetriever });
    const verdict = await arb.classify(baseInput(TOOL_CALL));
    expect(verdict.modality).toBe('workflow');
    expect(verdict.flowId).toBe('f_watch');
    expect(verdict.loopKind).toBe('reactive');
  });
});

describe('modality-arbiter — Tier 2 LLM tie-break', () => {
  it('calls the LLM EXACTLY ONCE when 0 < topScore < τ and honours its label', async () => {
    const classify = vi.fn(async () => ({ modality: 'document' as const, reason: 'doc' }));
    const arb = createModalityArbiter({
      embedder: fixedEmbedder(),
      // A sub-τ skill match forces the tie-break.
      skillRetriever: {
        retrieve: vi.fn(async () => [
          { skillId: 's', score: 0.5, humanReviewed: true, status: 'active' as const },
        ]),
      },
      llmTieBreak: { classify },
    });
    const verdict = await arb.classify(baseInput(TOOL_CALL));
    expect(classify).toHaveBeenCalledTimes(1);
    expect(verdict.modality).toBe('document');
    expect(verdict.tier).toBe('tier2');
  });

  it('FAILS CLOSED to chat on an unknown classifier label', async () => {
    const arb = createModalityArbiter({
      embedder: fixedEmbedder(),
      skillRetriever: {
        retrieve: vi.fn(async () => [
          { skillId: 's', score: 0.5, humanReviewed: true, status: 'active' as const },
        ]),
      },
      // Return a bogus label outside the closed set.
      llmTieBreak: { classify: vi.fn(async () => ({ modality: 'telepathy' as never, reason: 'x' })) },
    });
    const verdict = await arb.classify(baseInput(TOOL_CALL));
    expect(verdict.modality).toBe('chat');
    expect(verdict.tier).toBe('fail-closed');
  });
});

describe('modality-arbiter — autonomy (escalate-only) + rails', () => {
  it('a rail-GATED action stays GATED even at high confidence', async () => {
    // The injected decider mirrors composeWithRail: railGated ⇒ at least gate.
    const decider: AutonomyDeciderPort = vi.fn((input) => ({
      decision: input.railGated ? 'gate' : 'auto',
      reasons: input.railGated ? ['rail-gate wins'] : ['auto'],
      gatedBy: input.railGated ? 'rail' : null,
    }));
    const arb = createModalityArbiter({
      embedder: fixedEmbedder(),
      flowRetriever: { retrieve: vi.fn(async () => [{ flowId: 'f', score: 0.95 }]) },
      autonomyDecider: decider,
    });
    const verdict = await arb.classify(
      baseInput(TOOL_CALL, { railGated: true, calibratedConfidence: 0.99 }),
    );
    expect(verdict.modality).toBe('workflow');
    expect(verdict.autonomy?.decision).toBe('gate');
    expect(verdict.autonomy?.gatedBy).toBe('rail');
  });

  it('a defection-probe flag escalates a rail-ALLOWED media draft to gate (never auto)', async () => {
    const decider: AutonomyDeciderPort = vi.fn((input) => ({
      decision: input.situationFlags?.defectionProbeHit ? 'gate' : 'auto',
      reasons: ['situation'],
      gatedBy: input.situationFlags?.defectionProbeHit ? 'situation' : null,
    }));
    const arb = createModalityArbiter({
      embedder: fixedEmbedder(),
      recipeDescriptors: [
        { modality: 'media', recipeId: 'r_poster', embedding: [1, 0, 0] },
      ],
      autonomyDecider: decider,
    });
    const verdict = await arb.classify(
      baseInput(TOOL_CALL, { situationFlags: { defectionProbeHit: true } }),
    );
    expect(verdict.modality).toBe('media');
    expect(verdict.autonomy?.decision).toBe('gate');
  });
});

describe('modality-arbiter — meta-rail (body-change syscall)', () => {
  it('routes a skill (new capability) through the bodyChangePort and never proceeds when denied', async () => {
    const authorizeBodyChange = vi.fn(async () => ({ authorized: false, reason: 'four-eye pending' }));
    const bodyChangePort: BodyChangePort = { authorizeBodyChange };
    const arb = createModalityArbiter({
      embedder: fixedEmbedder(),
      skillRetriever: {
        retrieve: vi.fn(async () => [
          { skillId: 's', score: 0.95, humanReviewed: true, status: 'active' as const, persistsNewCapability: true },
        ]),
      },
      bodyChangePort,
    });
    const verdict = await arb.classify(baseInput(TOOL_CALL));
    expect(authorizeBodyChange).toHaveBeenCalledTimes(1);
    // Denied capability growth FAILS CLOSED to chat — the arbiter never
    // writes the registry row directly nor proceeds with the skill.
    expect(verdict.modality).toBe('chat');
    expect(verdict.tier).toBe('fail-closed');
  });

  it('proceeds with the skill and marks bodyChangeAuthorized when the syscall approves', async () => {
    const bodyChangePort: BodyChangePort = {
      authorizeBodyChange: vi.fn(async () => ({ authorized: true, reason: 'ok' })),
    };
    const arb = createModalityArbiter({
      embedder: fixedEmbedder(),
      skillRetriever: {
        retrieve: vi.fn(async () => [
          { skillId: 's', score: 0.95, humanReviewed: true, status: 'active' as const },
        ]),
      },
      bodyChangePort,
    });
    const verdict = await arb.classify(baseInput(TOOL_CALL));
    expect(verdict.modality).toBe('skill');
    expect(verdict.bodyChangeAuthorized).toBe(true);
  });
});

describe('modality-arbiter — EN/SW purity', () => {
  it('passes the single-language directive through to the LLM tie-break prompt', async () => {
    const classify = vi.fn(async () => ({ modality: 'chat' as const, reason: 'r' }));
    const arb = createModalityArbiter({
      embedder: fixedEmbedder(),
      skillRetriever: {
        retrieve: vi.fn(async () => [
          { skillId: 's', score: 0.4, humanReviewed: true, status: 'active' as const },
        ]),
      },
      llmTieBreak: { classify },
    });
    await arb.classify(baseInput(TOOL_CALL, { languageDirective: 'Respond only in Swahili.' }));
    expect(classify).toHaveBeenCalledWith(
      expect.objectContaining({ languageDirective: 'Respond only in Swahili.' }),
    );
  });
});

describe('modality-arbiter — classify never throws (fail-closed)', () => {
  it('a throwing embedder fails closed to chat, not a crash', async () => {
    const arb = createModalityArbiter({
      embedder: { embed: vi.fn(async () => { throw new Error('embedder down'); }) },
    });
    const verdict = await arb.classify(baseInput(TOOL_CALL));
    expect(verdict.modality).toBe('chat');
    expect(verdict.tier).toBe('fail-closed');
  });
});

describe('liftToModalityDecision — lift only the higher-order modalities', () => {
  it('chat/action are NO-OPS: a money/licence tool_call stays a tool_call (hits the gate)', () => {
    const moneyCall: Decision = {
      kind: 'tool_call',
      call: { toolName: 'money.transfer', input: { amount: 100 }, callId: 'm1' },
    };
    const liftedAction = liftToModalityDecision(moneyCall, {
      modality: 'action',
      score: 0,
      tier: 'tier0',
      reason: 'action',
    });
    expect(liftedAction).toBe(moneyCall); // identity — no lift
    const liftedChat = liftToModalityDecision(RESPOND, {
      modality: 'chat',
      score: 0,
      tier: 'tier0',
      reason: 'chat',
    });
    expect(liftedChat).toBe(RESPOND);
  });

  it('lifts a skill verdict to a run_skill Decision carrying the tool input as params', () => {
    const lifted = liftToModalityDecision(TOOL_CALL, {
      modality: 'skill',
      skillId: 's_arrears',
      score: 0.9,
      tier: 'tier1',
      reason: 'skill',
    });
    expect(lifted.kind).toBe('run_skill');
    if (lifted.kind === 'run_skill') {
      expect(lifted.skillId).toBe('s_arrears');
      expect(lifted.params).toEqual({ tenantId: 't1' });
    }
  });

  it('lifts a workflow+loopKind verdict to a run_modality Decision with modality=loop', () => {
    const lifted = liftToModalityDecision(TOOL_CALL, {
      modality: 'workflow',
      flowId: 'f_watch',
      loopKind: 'reactive',
      score: 0.9,
      tier: 'tier1',
      reason: 'loop',
    });
    expect(lifted.kind).toBe('run_modality');
    if (lifted.kind === 'run_modality') {
      expect(lifted.modality).toBe('loop');
      expect(lifted.payload).toMatchObject({ flowId: 'f_watch', loopKind: 'reactive' });
    }
  });
});
