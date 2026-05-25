/**
 * Production Haiku-backed consolidation critic.
 *
 * Stage 03 of the 8-stage nightly sleep-time consolidation
 * (`services/consolidation-worker/src/stages/03-reflect.ts`) is the
 * "what went well / what failed / next time" reflection pass. The
 * default worker implementation ships a deterministic stub
 * (`createStubCritic()` in 03-reflect.ts) that produces a recognisable
 * `stub-haiku: ...` line so audit dashboards can spot un-wired
 * deployments at a glance. This module wraps the real Anthropic Haiku
 * model around the same `ReflectionCritic` port so production builds
 * route every cluster through a cheap LLM critique instead.
 *
 * The interfaces here are intentionally duck-typed (no compile-time
 * dep on `services/consolidation-worker`) — the consolidation-worker's
 * `ReflectionCritic` / `ReflectionResult` / `TraceCluster` shapes are
 * mirrored locally. The worker's composition root binds this factory
 * via `services/consolidation-worker/src/index.ts` and feeds the
 * resulting port into `runConsolidationOrchestrator`'s `critic` slot.
 *
 * Design constraints (per `.planning/central-command/00-architecture.md`
 * §"Progressive intelligence cadence" — nightly tier):
 *   - Cheapest model: `claude-haiku-4-5-20251001`.
 *   - Cost-bounded: max 500 output tokens per cluster; clusters with
 *     >50 traces are sampled down to 50 random traces before the
 *     prompt is composed.
 *   - Fail-closed against API errors: any exception (transport, 4xx,
 *     5xx, malformed response) falls back to a deterministic stub so
 *     the consolidation cycle still produces a usable reflection.
 *   - Tenant-pure: the critic gets a cluster blob already grouped by
 *     `tenantId`; the prompt never crosses tenants.
 */

// ─────────────────────────────────────────────────────────────────────
// Public types — mirror the consolidation-worker port shapes
// ─────────────────────────────────────────────────────────────────────

/**
 * One captured agent trace. Mirrors
 * `services/consolidation-worker/src/stages/types.ts#TraceEntry`.
 */
export interface ConsolidationTraceEntry {
  readonly traceId: string;
  readonly tenantId: string | null;
  readonly userId: string;
  readonly threadId: string;
  readonly summary: string;
  readonly capturedAt: string;
}

/**
 * Cluster of similar agent traces. Mirrors
 * `services/consolidation-worker/src/stages/types.ts#TraceCluster`.
 */
export interface ConsolidationTraceCluster {
  readonly clusterId: string;
  readonly tenantId: string | null;
  readonly intentLabel: string;
  readonly traces: ReadonlyArray<ConsolidationTraceEntry>;
  readonly outcome: 'success' | 'failure' | 'mixed';
  readonly score: number;
  readonly signalsInside: number;
}

/**
 * Reflection result emitted per cluster. Mirrors
 * `services/consolidation-worker/src/stages/types.ts#ReflectionResult`.
 */
export interface ConsolidationReflectionResult {
  readonly clusterId: string;
  readonly tenantId: string | null;
  readonly text: string;
  readonly outcome: 'success' | 'failure' | 'mixed';
  readonly intentLabel: string;
}

/**
 * Port shape the orchestrator's stage 03 consumes. Mirrors
 * `services/consolidation-worker/src/stages/types.ts#ReflectionCritic`.
 */
export interface ConsolidationReflectionCritic {
  reflect(
    cluster: ConsolidationTraceCluster,
  ): Promise<ConsolidationReflectionResult>;
}

/**
 * Structural duck-shape of the Anthropic Messages client. Mirrors the
 * client used by `consolidation-runner.ts` so callers can pass the
 * same SDK instance.
 */
export interface AnthropicMessagesLike {
  readonly messages: {
    create(args: {
      model: string;
      max_tokens: number;
      system?: string;
      messages: ReadonlyArray<{
        role: 'user' | 'assistant';
        content: string | unknown;
      }>;
    }): Promise<{
      content: ReadonlyArray<{ type: string; text?: string }>;
    }>;
  };
}

export interface HaikuCriticDeps {
  /** Anthropic SDK client. Required. */
  readonly anthropicClient: AnthropicMessagesLike;
  /** Override model id (tests). Default `claude-haiku-4-5-20251001`. */
  readonly modelId?: string;
  /** Hard cap on output tokens per call. Default 500. */
  readonly maxTokens?: number;
  /** Trace-sampling cap. Clusters with > sampleCap traces are downsampled
   *  to `sampleCap` random entries before the prompt is composed. Default 50. */
  readonly sampleCap?: number;
  /** Optional seeded RNG for deterministic tests (returns [0,1)). */
  readonly rng?: () => number;
  /** Optional structured logger. */
  readonly logger?: {
    readonly info?: (meta: object, msg: string) => void;
    readonly warn?: (meta: object, msg: string) => void;
  };
  /**
   * Optional fallback critic. When the Anthropic call fails or
   * returns empty body the critic delegates to `fallbackCritic` so
   * the consolidation cycle still produces a usable reflection. When
   * unset, a built-in deterministic stub is used (mirrors
   * `createStubCritic` in the worker).
   */
  readonly fallbackCritic?: ConsolidationReflectionCritic;
}

/**
 * Structured reflection triple emitted by the Haiku critic. Composed
 * into the `text` field of `ConsolidationReflectionResult` for
 * back-compat with the worker port; also extractable standalone via
 * {@link parseHaikuTextSections}.
 */
export interface HaikuReflectionTriple {
  readonly positive: string;
  readonly negative: string;
  readonly suggestedFix: string;
}

// ─────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────

// Dynamic model resolver — auto-picks the newest haiku id every hour
// via L2 provider query; falls back to baseline (`claude-haiku-4-5-...`)
// when the provider is unreachable. See
// `@borjie/brain-llm-router/dynamic-registry`.
import { getModelLatest } from '@borjie/brain-llm-router/dynamic-registry';
// Resolved per-`reflect()` call (not at module init) so cache warmup
// from `wireDynamicModelRegistry` is observed.
function resolveDefaultModel(): string {
  return getModelLatest('haiku');
}
const DEFAULT_MAX_TOKENS = 500;
const DEFAULT_SAMPLE_CAP = 50;
const TRACE_SUMMARY_MAX_CHARS = 300;

export const HAIKU_CRITIC_SYSTEM_PROMPT = [
  'You are a consolidation critic for an agentic property-management',
  'system. You read a cluster of similar agent traces from the last 24',
  'hours and write a structured 3-sentence reflection so the brain can',
  'learn for next time.',
  '',
  'Output FORMAT (strict — no preamble, no markdown, no JSON):',
  '  POSITIVE: <one sentence: what worked well across the cluster>',
  '  NEGATIVE: <one sentence: what failed or went poorly>',
  '  FIX: <one concrete, actionable improvement for next time>',
  '',
  'Constraints:',
  '  - Three sentences only. Each line starts with the exact header.',
  '  - No more than 60 words per line.',
  '  - Concrete, not generic. Reference the cluster intent label.',
  '  - If the outcome is "success", POSITIVE is detailed and NEGATIVE',
  '    + FIX are short ("no failure" / "no change needed").',
  '  - If the outcome is "failure", POSITIVE may be terse and NEGATIVE',
  '    + FIX must be specific and actionable.',
].join('\n');

/**
 * Build a production-grade `ReflectionCritic` backed by Claude Haiku.
 * Falls back to the deterministic stub on any Anthropic error so the
 * consolidation cycle never breaks because the LLM was unreachable.
 */
export function createHaikuConsolidationCritic(
  deps: HaikuCriticDeps,
): ConsolidationReflectionCritic {
  if (!deps.anthropicClient) {
    throw new Error(
      'createHaikuConsolidationCritic: anthropicClient is required',
    );
  }
  const model = deps.modelId ?? resolveDefaultModel();
  const maxTokens = clampInt(deps.maxTokens, DEFAULT_MAX_TOKENS, 1, 4_000);
  const sampleCap = clampInt(deps.sampleCap, DEFAULT_SAMPLE_CAP, 1, 1_000);
  const fallback = deps.fallbackCritic ?? createDeterministicFallback();
  const rng = deps.rng ?? Math.random;

  return {
    async reflect(
      cluster: ConsolidationTraceCluster,
    ): Promise<ConsolidationReflectionResult> {
      const sampled = maybeSampleTraces(cluster.traces, sampleCap, rng);
      const userPrompt = composeHaikuPrompt(cluster, sampled);

      let body = '';
      try {
        const response = await deps.anthropicClient.messages.create({
          model,
          max_tokens: maxTokens,
          system: HAIKU_CRITIC_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userPrompt }],
        });
        for (const block of response.content ?? []) {
          if (block?.type === 'text' && typeof block.text === 'string') {
            body += block.text;
          }
        }
        body = body.trim();
      } catch (err) {
        if (deps.logger?.warn) {
          deps.logger.warn(
            {
              critic: 'haiku-consolidation',
              clusterId: cluster.clusterId,
              tenantId: cluster.tenantId,
              error: err instanceof Error ? err.message : String(err),
            },
            'haiku critic: anthropic call failed; falling back to stub',
          );
        }
        return fallback.reflect(cluster);
      }

      if (!body) {
        if (deps.logger?.warn) {
          deps.logger.warn(
            {
              critic: 'haiku-consolidation',
              clusterId: cluster.clusterId,
              tenantId: cluster.tenantId,
            },
            'haiku critic: empty response; falling back to stub',
          );
        }
        return fallback.reflect(cluster);
      }

      const triple = parseHaikuTextSections(body);
      const text = formatTripleAsText(triple, cluster);

      if (deps.logger?.info) {
        deps.logger.info(
          {
            critic: 'haiku-consolidation',
            clusterId: cluster.clusterId,
            tenantId: cluster.tenantId,
            sampled: sampled.length,
            outcome: cluster.outcome,
          },
          'haiku critic: cluster reflected',
        );
      }

      return {
        clusterId: cluster.clusterId,
        tenantId: cluster.tenantId,
        text,
        outcome: cluster.outcome,
        intentLabel: cluster.intentLabel,
      };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Helpers — sampling, prompt composition, response parsing
// ─────────────────────────────────────────────────────────────────────

/**
 * Sample up to `cap` traces from `traces` using a Fisher-Yates partial
 * shuffle so large clusters don't blow the prompt-token budget. Returns
 * the original array unchanged when `traces.length <= cap`.
 *
 * Exported for tests.
 */
export function maybeSampleTraces(
  traces: ReadonlyArray<ConsolidationTraceEntry>,
  cap: number,
  rng: () => number,
): ReadonlyArray<ConsolidationTraceEntry> {
  if (traces.length <= cap) return traces;
  const copy = traces.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = copy[i] as ConsolidationTraceEntry;
    copy[i] = copy[j] as ConsolidationTraceEntry;
    copy[j] = tmp;
  }
  return copy.slice(0, cap);
}

/**
 * Compose the user-prompt the Haiku critic sees. The cluster header
 * carries the intent label, outcome, signed score, and trace count;
 * each (sampled) trace contributes a single bullet with its summary
 * truncated to {@link TRACE_SUMMARY_MAX_CHARS}.
 *
 * Exported for tests.
 */
export function composeHaikuPrompt(
  cluster: ConsolidationTraceCluster,
  sampledTraces: ReadonlyArray<ConsolidationTraceEntry>,
): string {
  const lines: string[] = [];
  lines.push(`Cluster intent: ${cluster.intentLabel || '(unlabelled)'}`);
  lines.push(`Outcome: ${cluster.outcome}`);
  lines.push(`Signed score (-1 to 1): ${cluster.score.toFixed(2)}`);
  lines.push(`Total traces in cluster: ${cluster.traces.length}`);
  if (sampledTraces.length !== cluster.traces.length) {
    lines.push(
      `(Sampled ${sampledTraces.length} of ${cluster.traces.length} traces for prompt-token budget.)`,
    );
  }
  lines.push('');
  lines.push('Traces:');
  for (const t of sampledTraces) {
    const summary = truncate(t.summary || '(no summary)', TRACE_SUMMARY_MAX_CHARS);
    lines.push(`- ${summary}`);
  }
  lines.push('');
  lines.push(
    'Reflect on the cluster as a whole. Use the strict POSITIVE / NEGATIVE / FIX format.',
  );
  return lines.join('\n');
}

/**
 * Parse the Haiku response back into a structured triple. The model is
 * instructed to emit three lines headed by `POSITIVE:`, `NEGATIVE:`,
 * `FIX:` — we accept either order and tolerate trailing whitespace.
 * Missing sections fall back to a short marker so the consumer always
 * sees non-empty strings.
 *
 * Exported for tests.
 */
export function parseHaikuTextSections(raw: string): HaikuReflectionTriple {
  const text = (raw ?? '').trim();
  const triple: { positive: string; negative: string; suggestedFix: string } = {
    positive: '',
    negative: '',
    suggestedFix: '',
  };
  if (!text) {
    return finalise(triple);
  }
  const lines = text.split(/\r?\n/);
  let active: 'positive' | 'negative' | 'suggestedFix' | null = null;
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const m = /^(POSITIVE|NEGATIVE|FIX)\s*:\s*(.*)$/i.exec(line);
    if (m) {
      const header = (m[1] ?? '').toUpperCase();
      const body = (m[2] ?? '').trim();
      if (header === 'POSITIVE') {
        active = 'positive';
        triple.positive = body;
      } else if (header === 'NEGATIVE') {
        active = 'negative';
        triple.negative = body;
      } else {
        active = 'suggestedFix';
        triple.suggestedFix = body;
      }
    } else if (active) {
      // Continuation line — append to the active section.
      const existing = triple[active];
      triple[active] = existing ? `${existing} ${line}` : line;
    }
  }
  return finalise(triple);
}

function finalise(
  partial: { positive: string; negative: string; suggestedFix: string },
): HaikuReflectionTriple {
  return {
    positive: partial.positive || '(no positive observation extracted)',
    negative: partial.negative || '(no negative observation extracted)',
    suggestedFix:
      partial.suggestedFix || '(no actionable improvement extracted)',
  };
}

/**
 * Compose the triple back into the `text` field stored on
 * {@link ConsolidationReflectionResult}. The format is stable:
 * downstream tooling can re-parse the three sections with
 * {@link parseHaikuTextSections}.
 */
function formatTripleAsText(
  triple: HaikuReflectionTriple,
  cluster: ConsolidationTraceCluster,
): string {
  const header = `haiku-critic[${cluster.intentLabel || 'unlabelled'} · ${cluster.outcome}]`;
  return [
    header,
    `POSITIVE: ${triple.positive}`,
    `NEGATIVE: ${triple.negative}`,
    `FIX: ${triple.suggestedFix}`,
  ].join('\n');
}

/**
 * Deterministic fallback used when no `fallbackCritic` is provided.
 * Mirrors `createStubCritic()` in the worker's stage 03 so audit
 * dashboards can recognise the output as a stub rather than a real
 * LLM call.
 */
function createDeterministicFallback(): ConsolidationReflectionCritic {
  return {
    async reflect(cluster) {
      const verb =
        cluster.outcome === 'success'
          ? 'worked well'
          : cluster.outcome === 'failure'
            ? 'failed'
            : 'was mixed';
      const text =
        `stub-haiku-fallback: cluster '${cluster.intentLabel}' ` +
        `(${cluster.traces.length} traces, score=${cluster.score.toFixed(2)}) ${verb}. ` +
        `Next time, run the typed action with explicit grounding.`;
      return {
        clusterId: cluster.clusterId,
        tenantId: cluster.tenantId,
        text,
        outcome: cluster.outcome,
        intentLabel: cluster.intentLabel,
      };
    },
  };
}

function clampInt(
  value: number | undefined,
  fallback: number,
  min: number,
  max: number,
): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const n = Math.floor(value);
  if (n < min) return min;
  if (n > max) return max;
  return n;
}

function truncate(s: string, max: number): string {
  if (!s) return '';
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}
