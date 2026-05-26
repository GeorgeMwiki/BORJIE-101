/**
 * Junior Executor — chat-orchestrator dispatch loop tests.
 *
 * Verifies the contract that closes Borjie issue #17:
 *
 *   1. Per-step lifecycle hooks fire in (start → result) order for every
 *      junior in the dispatch plan.
 *   2. Synthesized inputs are validated against the junior's Zod schema
 *      before `processInput` is called.
 *   3. Each result carries the junior's name, intent, evidence_ids,
 *      confidence, and (on failure) an error string.
 *   4. A failing junior MUST NOT abort the chain — the executor records
 *      the error and continues dispatching the rest of the plan.
 *   5. Missing `ANTHROPIC_API_KEY` raises `BorjieConfigError` BEFORE any
 *      junior runs (no mock fallback path).
 *
 * The Claude client is stubbed deterministically and the registry is
 * stub-injected; no network, no real juniors.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';
import {
  executeJuniors,
  BorjieConfigError,
  type JuniorEntry,
  type DispatchPlanStep,
} from '../src/juniors/executor.js';
import type { ClaudeClient } from '../src/juniors/_shared.js';

// ─────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────

const StubInputSchema = z.object({
  tenantId: z.string().min(1),
  topic: z.string().min(1),
});
type StubInput = z.infer<typeof StubInputSchema>;

function queuedClaude(responses: ReadonlyArray<string>): ClaudeClient {
  const queue = [...responses];
  return {
    async complete() {
      const next = queue.shift();
      if (next === undefined) throw new Error('queuedClaude: out of responses');
      return { content: next };
    },
  };
}

function successFactory(payload: {
  readonly confidence: number;
  readonly evidence_ids: ReadonlyArray<string>;
}) {
  return () => ({
    async processInput(input: StubInput) {
      return {
        echoed_topic: input.topic,
        confidence: payload.confidence,
        evidence_ids: [...payload.evidence_ids],
        rationale: 'stub',
        citations: [],
      };
    },
  });
}

function failingFactory(message: string) {
  return () => ({
    async processInput() {
      throw new Error(message);
    },
  });
}

function buildRegistry(): Record<string, JuniorEntry<typeof StubInputSchema>> {
  return {
    'safety-agent': {
      schema: StubInputSchema,
      factory: successFactory({ confidence: 0.82, evidence_ids: ['ev_safety_1', 'ev_safety_2'] }),
    },
    'compliance-agent': {
      schema: StubInputSchema,
      factory: failingFactory('regulator_api_unreachable'),
    },
  };
}

// Cast helper — production registry is keyed on the abstract `ZodSchema`
// supertype but our stubs use the concrete `StubInputSchema`. The
// executor only reads the entries it dispatches, so the cast is safe.
function asRegistry(
  r: Record<string, JuniorEntry<typeof StubInputSchema>>,
): Record<string, JuniorEntry<z.ZodSchema>> {
  return r as unknown as Record<string, JuniorEntry<z.ZodSchema>>;
}

const VALID_SYNTH = JSON.stringify({ tenantId: 'tenant-1', topic: 'shift-incidents' });

const PLAN: ReadonlyArray<DispatchPlanStep> = [
  { junior: 'safety-agent', intent: 'Surface safety-critical breaches.' },
  { junior: 'compliance-agent', intent: 'Regulator citation lookup.' },
];

// ─────────────────────────────────────────────────────────────────────
// Suite
// ─────────────────────────────────────────────────────────────────────

describe('executeJuniors — dispatch runner', () => {
  const ORIGINAL_KEY = process.env.ANTHROPIC_API_KEY;

  beforeEach(() => {
    process.env.ANTHROPIC_API_KEY = 'test-key';
  });
  afterEach(() => {
    if (ORIGINAL_KEY === undefined) delete process.env.ANTHROPIC_API_KEY;
    else process.env.ANTHROPIC_API_KEY = ORIGINAL_KEY;
  });

  it('runs every junior, capturing success + failure shape', async () => {
    const onStart = vi.fn();
    const onResult = vi.fn();
    const claude = queuedClaude([VALID_SYNTH, VALID_SYNTH]);

    const results = await executeJuniors({
      dispatchPlan: PLAN,
      context: { tenantId: 'tenant-1', chat_message: 'PPE incidents?', mode: 'operations' },
      claude,
      registry: asRegistry(buildRegistry()),
      hooks: { onStart, onResult },
    });

    expect(onStart).toHaveBeenCalledTimes(2);
    expect(onResult).toHaveBeenCalledTimes(2);
    expect(onStart.mock.calls[0]![0]!.junior).toBe('safety-agent');
    expect(onStart.mock.calls[1]![0]!.junior).toBe('compliance-agent');

    expect(results).toHaveLength(2);

    const safety = results[0]!;
    expect(safety.junior_name).toBe('safety-agent');
    expect(safety.error).toBeUndefined();
    expect(safety.evidence_ids).toEqual(['ev_safety_1', 'ev_safety_2']);
    expect(safety.confidence).toBe(0.82);
    expect(safety.input).toEqual({ tenantId: 'tenant-1', topic: 'shift-incidents' });

    const compliance = results[1]!;
    expect(compliance.junior_name).toBe('compliance-agent');
    expect(compliance.error).toMatch(/junior_failed: regulator_api_unreachable/);
    expect(compliance.evidence_ids).toEqual([]);
    expect(compliance.confidence).toBe(0);
    // Input was still synthesized — only `processInput` threw.
    expect(compliance.input).toEqual({ tenantId: 'tenant-1', topic: 'shift-incidents' });
  });

  it('does NOT abort the chain when a junior fails', async () => {
    const plan: ReadonlyArray<DispatchPlanStep> = [
      { junior: 'safety-agent', intent: 'first' },
      { junior: 'compliance-agent', intent: 'second (fails)' },
      { junior: 'cost-engineer', intent: 'third must still run' },
    ];
    const claude = queuedClaude([VALID_SYNTH, VALID_SYNTH, VALID_SYNTH]);
    const registry = buildRegistry();
    registry['cost-engineer'] = {
      schema: StubInputSchema,
      factory: successFactory({ confidence: 0.91, evidence_ids: ['ev_cost_1'] }),
    };

    const results = await executeJuniors({
      dispatchPlan: plan,
      context: { tenantId: 'tenant-1', chat_message: 'q', mode: 'finance' },
      claude,
      registry: asRegistry(registry),
    });

    expect(results).toHaveLength(3);
    expect(results[0]!.error).toBeUndefined();
    expect(results[1]!.error).toBeDefined();
    expect(results[2]!.error).toBeUndefined();
    expect(results[2]!.evidence_ids).toEqual(['ev_cost_1']);
  });

  it('records unknown juniors without aborting', async () => {
    const plan: ReadonlyArray<DispatchPlanStep> = [
      { junior: 'safety-agent', intent: 'real' },
      { junior: 'totally-fake-junior', intent: 'unknown' },
    ];
    const claude = queuedClaude([VALID_SYNTH]); // only safety-agent calls Claude

    const results = await executeJuniors({
      dispatchPlan: plan,
      context: { tenantId: 'tenant-1', chat_message: 'q', mode: 'operations' },
      claude,
      registry: asRegistry(buildRegistry()),
    });

    expect(results).toHaveLength(2);
    expect(results[0]!.error).toBeUndefined();
    expect(results[1]!.error).toMatch(/unknown_junior/);
  });

  it('surfaces synthesis failures without aborting the chain', async () => {
    // MAX_ATTEMPTS=2 — feed two invalid payloads to force SynthesisFailure.
    const claude = queuedClaude(['{"not_a_valid_input":true}', '{"still_wrong":1}']);
    const plan: ReadonlyArray<DispatchPlanStep> = [
      { junior: 'safety-agent', intent: 'synth will fail' },
    ];

    const results = await executeJuniors({
      dispatchPlan: plan,
      context: { tenantId: 'tenant-1', chat_message: 'q', mode: 'operations' },
      claude,
      registry: asRegistry(buildRegistry()),
    });

    expect(results).toHaveLength(1);
    expect(results[0]!.error).toMatch(/synthesis_failed/);
    expect(results[0]!.input).toBeNull();
    expect(results[0]!.output).toBeNull();
  });

  it('throws BorjieConfigError when ANTHROPIC_API_KEY is missing', async () => {
    delete process.env.ANTHROPIC_API_KEY;
    await expect(
      executeJuniors({
        dispatchPlan: PLAN,
        context: { tenantId: 'tenant-1', chat_message: 'q', mode: 'operations' },
        claude: queuedClaude([]),
        registry: asRegistry(buildRegistry()),
      }),
    ).rejects.toThrow(BorjieConfigError);
  });

  it('skips non-executable juniors (master-brain, auditor-agent, document-agent)', async () => {
    const plan: ReadonlyArray<DispatchPlanStep> = [
      { junior: 'master-brain', intent: 'router — already ran upstream' },
      { junior: 'safety-agent', intent: 'real work' },
      { junior: 'auditor-agent', intent: 'gates combined output later' },
    ];
    const claude = queuedClaude([VALID_SYNTH]);

    const results = await executeJuniors({
      dispatchPlan: plan,
      context: { tenantId: 'tenant-1', chat_message: 'q', mode: 'operations' },
      claude,
      registry: asRegistry(buildRegistry()),
    });

    expect(results).toHaveLength(3);
    expect(results[0]!.skipped).toBe(true);
    expect(results[0]!.junior_name).toBe('master-brain');
    expect(results[1]!.skipped).toBeUndefined();
    expect(results[1]!.evidence_ids.length).toBeGreaterThan(0);
    expect(results[2]!.skipped).toBe(true);
    expect(results[2]!.junior_name).toBe('auditor-agent');
  });
});
