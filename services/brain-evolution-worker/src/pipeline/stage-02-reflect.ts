/**
 * Stage 02 — reflect on the day with a 3-LLM jury.
 *
 * Pattern: Letta sleep-time agents + Anthropic "dreaming" + the
 * mixture-of-agents synthesizer in `packages/ai-copilot/src/providers/
 * multi-llm-synthesizer.ts`. Three proposer LLMs each draft an
 * end-of-day reflection, a synthesizer merges them, and we keep the
 * pairwise-Jaccard agreement score as the escalation signal: below
 * threshold = the jury disagreed = surface to a human.
 *
 * This module is pure over its `ReflectionEngine` port. The composition
 * root wires the real `createMultiLLMSynthesizer` here; tests inject a
 * deterministic stub.
 *
 * Output schema (`ReflectionResult`) is intentionally lossy compared to
 * the raw jury chatter — we keep the synthesis text + tagged
 * worked/failed/novel lists + the agreement number. Operators that need
 * the raw transcripts read the audit chain.
 */

import type {
  InteractionTrace,
  ReflectionResult,
  BrainWorkerLogger,
} from '../types.js';

/**
 * Engine port — typically wired to `createMultiLLMSynthesizer` with
 * three proposers + a stronger synthesizer model.
 */
export interface ReflectionEngine {
  reflect(args: {
    readonly tenantId: string;
    readonly windowStart: string;
    readonly windowEnd: string;
    readonly traces: ReadonlyArray<InteractionTrace>;
  }): Promise<{
    readonly synthesis: string;
    readonly worked: ReadonlyArray<string>;
    readonly failed: ReadonlyArray<string>;
    readonly novel: ReadonlyArray<string>;
    readonly agreement: number;
    readonly escalate: boolean;
  }>;
}

export interface ReflectArgs {
  readonly tenantId: string;
  readonly windowStart: string;
  readonly windowEnd: string;
  readonly traces: ReadonlyArray<InteractionTrace>;
  readonly logger?: BrainWorkerLogger;
}

/**
 * Run stage 02. An empty trace set short-circuits to a zero-effort
 * reflection so the rest of the pipeline can no-op cleanly. Engine
 * failures degrade to a single-line synthesis describing the failure;
 * the worker continues so the next tenant isn't blocked.
 */
export async function reflectOnDay(
  engine: ReflectionEngine,
  args: ReflectArgs,
): Promise<ReflectionResult> {
  const baseResult = {
    tenantId: args.tenantId,
    windowStart: args.windowStart,
    windowEnd: args.windowEnd,
    traceCount: args.traces.length,
  };

  if (args.traces.length === 0) {
    return {
      ...baseResult,
      synthesis: 'No interaction traces recorded for this tenant in the window. Sleep-time reflection produced no signal.',
      worked: [],
      failed: [],
      novel: [],
      agreement: 1,
      escalate: false,
    };
  }

  try {
    const out = await engine.reflect({
      tenantId: args.tenantId,
      windowStart: args.windowStart,
      windowEnd: args.windowEnd,
      traces: args.traces,
    });

    return {
      ...baseResult,
      synthesis: out.synthesis,
      worked: out.worked,
      failed: out.failed,
      novel: out.novel,
      agreement: clamp01(out.agreement),
      escalate: out.escalate,
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    args.logger?.warn?.(
      { tenantId: args.tenantId, err: msg },
      'brain-evolution-worker: reflect engine failed — degrading',
    );
    return {
      ...baseResult,
      synthesis: `Reflection engine failed: ${msg}. No deltas can be derived from this run.`,
      worked: [],
      failed: [],
      novel: [],
      agreement: 0,
      escalate: true,
    };
  }
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}
