/**
 * Claude-backed prompt mutator for the weekly GEPA recompile.
 *
 * Phase C — C7. B4's `gepa-optimizer.ts` ships a deterministic default
 * mutator (paraphrase / append-example / re-order) for tests + offline
 * replay. Production wires THIS mutator: it asks Claude (Opus by
 * default) to act as a prompt-engineer and emit `mutationCount`
 * candidate variants for a given failure case.
 *
 * Design contract:
 *
 *   - The kernel package (`@borjie/central-intelligence`) stays
 *     SDK-free. We duck-type a `ClaudeMessagesClient` here that mirrors
 *     the `CounterModelLlmClient` shape, so the composition root can
 *     pass in the SAME wrapped client (budget guard + circuit breaker).
 *
 *   - When `anthropicClient` is null (e.g. local dev without API key),
 *     the mutator returns the current prompt unchanged. The GEPA loop
 *     short-circuits on identity (it has already seen the base prompt),
 *     so no false-positive improvements get promoted.
 *
 *   - The system prompt is intentionally TIGHT — we want surgical
 *     edits, not creative rewrites. Big jumps fail Pareto-improvement
 *     gates on the golden set and waste API spend.
 *
 *   - Output parsing is forgiving. Claude may wrap the candidates in
 *     prose, JSON, or numbered lists. We strip XML-style `<candidate>`
 *     tags, fall back to numbered-list parsing, and as a last resort
 *     return the raw response as a single candidate.
 */

import { getModelLatest } from '@borjie/brain-llm-router/dynamic-registry';

/**
 * `GoldenCase` mirrors the kernel's `EvalCase` structurally so we have
 * NO compile-time dependency on `@borjie/central-intelligence`. The
 * composition root duck-types the bridge — the kernel `EvalCase` is
 * structurally identical so passing one through is type-safe.
 */
export interface GoldenCase {
  readonly id: string;
  readonly input: string;
  readonly expectedOutput: string;
  readonly capability: string;
}

// ---------------------------------------------------------------------------
// Duck-typed Anthropic Messages client. Same shape as
// `CounterModelLlmClient` in central-intelligence — the composition
// root passes in the SAME singleton so circuit-breaker + budget-guard
// state is shared across all kernel callers.
// ---------------------------------------------------------------------------

export interface ClaudeMessagesClient {
  messages: {
    create(args: {
      model: string;
      max_tokens: number;
      system: string;
      messages: ReadonlyArray<{ role: 'user'; content: string }>;
    }): Promise<{
      readonly content: ReadonlyArray<{ type: string; text?: string }>;
    }>;
  };
}

export interface ClaudeMutatorArgs {
  readonly currentPrompt: string;
  readonly failureCase: GoldenCase;
  readonly capability: string;
  readonly mutationCount: number;
}

export interface ClaudeMutator {
  mutate(args: ClaudeMutatorArgs): Promise<ReadonlyArray<string>>;
}

export interface ClaudeMutatorDeps {
  readonly anthropicClient: ClaudeMessagesClient | null;
  readonly model?: string;
  readonly maxTokens?: number;
}

/** Default — strongest available reasoning model. */
export const DEFAULT_MUTATOR_MODEL = getModelLatest('opus');

const DEFAULT_MAX_TOKENS = 2048;
const MAX_MUTATION_COUNT = 8;
const MIN_MUTATION_COUNT = 1;

/** System prompt for the mutator. Stable across refactors — see test. */
export const MUTATOR_SYSTEM_PROMPT = [
  'You are a prompt engineer specialising in property-management AI agent prompts.',
  'You will receive a CURRENT prompt and a FAILING golden-set case.',
  'Your job: emit a small number of CANDIDATE prompts that surgically fix the failure',
  'without regressing on the prompt\'s other capabilities. Make minimal edits:',
  'add a clarifying instruction, an example, or a constraint — never a full rewrite.',
  '',
  'Output format: emit each candidate wrapped in <candidate>...</candidate> tags,',
  'one per line. No prose, no preamble. The candidates MUST differ from each other.',
].join('\n');

export function createClaudeMutator(deps: ClaudeMutatorDeps): ClaudeMutator {
  const client = deps.anthropicClient;
  const model = deps.model ?? DEFAULT_MUTATOR_MODEL;
  const maxTokens = deps.maxTokens ?? DEFAULT_MAX_TOKENS;

  return {
    async mutate(args) {
      const count = clampCount(args.mutationCount);
      const current = (args.currentPrompt ?? '').trim();

      if (!current) {
        return [];
      }

      if (!client) {
        // Identity fallback — see header doc.
        return [current];
      }

      try {
        const userPrompt = buildMutatorUserPrompt({
          currentPrompt: current,
          failureCase: args.failureCase,
          capability: args.capability,
          mutationCount: count,
        });
        const response = await client.messages.create({
          model,
          max_tokens: maxTokens,
          system: MUTATOR_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: userPrompt }],
        });

        let body = '';
        for (const block of response.content ?? []) {
          if (block.type === 'text' && typeof block.text === 'string') {
            body += block.text;
          }
        }
        const parsed = parseMutatorResponse(body, count);
        return parsed.length > 0 ? parsed : [current];
      } catch {
        // Network / parse failure — return identity so the GEPA loop
        // skips this iteration rather than ingesting noise.
        return [current];
      }
    },
  };
}

/** Build the user-turn prompt. Exported for testing the wire format. */
export function buildMutatorUserPrompt(args: {
  currentPrompt: string;
  failureCase: GoldenCase;
  capability: string;
  mutationCount: number;
}): string {
  return [
    `Capability: ${args.capability}`,
    `Mutation count: ${args.mutationCount}`,
    '',
    'CURRENT PROMPT:',
    '"""',
    args.currentPrompt,
    '"""',
    '',
    'FAILING CASE:',
    `  id: ${args.failureCase.id}`,
    `  input: ${args.failureCase.input}`,
    `  expected_output: ${args.failureCase.expectedOutput}`,
    '',
    `Emit ${args.mutationCount} distinct <candidate>...</candidate> entries.`,
  ].join('\n');
}

/**
 * Parse the mutator response into a list of candidate strings.
 *
 *   1. <candidate>...</candidate> blocks — preferred.
 *   2. Numbered list "1. ...\n2. ..." — fallback.
 *   3. Whole response as a single candidate — last-resort.
 *
 * Deduplicates exact-string-match entries.
 */
export function parseMutatorResponse(
  body: string,
  expected: number,
): ReadonlyArray<string> {
  const trimmed = (body ?? '').trim();
  if (!trimmed) return [];

  const tagged: string[] = [];
  const tagRe = /<candidate>([\s\S]*?)<\/candidate>/gi;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(trimmed)) !== null) {
    const inner = (match[1] ?? '').trim();
    if (inner) tagged.push(inner);
  }
  if (tagged.length > 0) {
    return dedupeCap(tagged, expected);
  }

  const numbered = trimmed
    .split(/\n\s*\d+\.\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (numbered.length >= 2) {
    return dedupeCap(numbered, expected);
  }

  return [trimmed];
}

function dedupeCap(
  items: ReadonlyArray<string>,
  cap: number,
): ReadonlyArray<string> {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    if (seen.has(it)) continue;
    seen.add(it);
    out.push(it);
    if (out.length >= cap) break;
  }
  return out;
}

function clampCount(n: number): number {
  if (!Number.isFinite(n) || n <= 0) return MIN_MUTATION_COUNT;
  return Math.min(Math.floor(n), MAX_MUTATION_COUNT);
}
