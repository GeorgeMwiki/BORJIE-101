/**
 * Tier-1 provider — Claude Opus 4.7 with glossary-conditioned prompt.
 *
 * The actual HTTP call to Anthropic is behind an injected `fetcher`
 * port so the unit-test suite never hits the network. The prompt
 * carries an explicit "preserve placeholders" directive; Opus
 * instruction-following obeys this with > 99 % fidelity in our
 * internal evals (see Docs/DESIGN/TRANSLATION_SOTA_SPEC.md §3).
 *
 * Pricing context (March 2026):
 *   - $5 / 1M input tokens, $25 / 1M output tokens
 *     https://platform.claude.com/docs/en/about-claude/pricing
 *     https://www.tldl.io/resources/anthropic-api-pricing
 *   - 1M context GA at standard rates per FOUNDER_LOCKED Finding 1:
 *     https://www.anthropic.com/news/1m-context-ga-2026
 *
 * Persona: Mr. Mwikila. Brand: Borjie. Tanzanian formal register.
 */

import type {
  ProviderId,
  ProviderPort,
  ProviderTranslateRequest,
  ProviderTranslateResult,
} from '../types.js';

export interface ClaudeFetchRequest {
  readonly url: string;
  readonly method: 'POST';
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

export interface ClaudeFetchResponse {
  readonly ok: boolean;
  readonly status: number;
  readonly text: () => Promise<string>;
  readonly json: () => Promise<unknown>;
}

export type ClaudeFetcher = (req: ClaudeFetchRequest) => Promise<ClaudeFetchResponse>;

export interface ClaudeMtConfig {
  readonly apiKey: string;
  readonly model: string;
  readonly endpoint: string;
  /** Sample temperature; deterministic on translation by default. */
  readonly temperature?: number;
  /** Max tokens to generate. */
  readonly maxTokens?: number;
}

export interface ClaudeMtDeps {
  readonly config: ClaudeMtConfig;
  readonly fetcher: ClaudeFetcher;
  /** Now-source — injected for deterministic latency measurement. */
  readonly now: () => number;
  /** Optional health-probe override. */
  readonly healthProbe?: () => Promise<boolean>;
}

export const CLAUDE_PROVIDER_ID: ProviderId = 'claude-opus-4-7';

/**
 * Build the glossary-conditioned system prompt. The translator MUST
 * preserve every placeholder verbatim (Pass 2 of the glossary lock).
 * The runner verifies adherence in Pass 3.
 */
export function buildClaudePrompt(req: ProviderTranslateRequest): string {
  const langName = (code: 'sw' | 'en'): string =>
    code === 'sw' ? 'Tanzanian Kiswahili (formal register)' : 'English';
  const placeholderList =
    req.placeholders.length === 0
      ? '(none)'
      : req.placeholders.join(', ');
  const honorific =
    req.register.honorific !== undefined
      ? ` (source uses honorific "${req.register.honorific}")`
      : '';
  return [
    'You are Mr. Mwikila, the Borjie translation specialist.',
    `Translate the source text from ${langName(req.sourceLang)} to ${langName(req.targetLang)}.`,
    `Source register: ${req.register.level}${honorific}. Mirror the register in the target language.`,
    'CRITICAL: keep every <<G:NNNN>> placeholder token verbatim. Do not translate, modify, or remove them.',
    `Placeholders present in source: ${placeholderList}.`,
    'Output the translated text only — no explanations, no quotes.',
  ].join('\n');
}

/**
 * Reference implementation of the Claude tier-1 provider. The HTTP
 * shape follows the Anthropic Messages API; tests pass a stub
 * fetcher that returns a canned response, never opening a socket.
 */
export function createClaudeProvider(deps: ClaudeMtDeps): ProviderPort {
  return {
    id: CLAUDE_PROVIDER_ID,

    async translate(req: ProviderTranslateRequest): Promise<ProviderTranslateResult> {
      const start = deps.now();
      const systemPrompt = buildClaudePrompt(req);
      const body = JSON.stringify({
        model: deps.config.model,
        max_tokens: deps.config.maxTokens ?? 1024,
        temperature: deps.config.temperature ?? 0,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: req.sourceText,
          },
        ],
      });
      const response = await deps.fetcher({
        url: deps.config.endpoint,
        method: 'POST',
        headers: Object.freeze({
          'x-api-key': deps.config.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        }),
        body,
      });
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(
          `claude-mt provider failed (${response.status}): ${errText}`,
        );
      }
      const payload = (await response.json()) as ClaudeMessageResponse;
      const targetText = extractClaudeText(payload);
      const latencyMs = Math.max(0, Math.round(deps.now() - start));
      const costUsdCents = estimateClaudeCost(req.sourceText, targetText);
      return Object.freeze({
        targetText,
        latencyMs,
        costUsdCents,
      });
    },

    async isHealthy(): Promise<boolean> {
      if (deps.healthProbe !== undefined) {
        return deps.healthProbe();
      }
      return true;
    },
  };
}

// ---------------------------------------------------------------------------
// HTTP response shape (mirrors the Anthropic Messages API)
// ---------------------------------------------------------------------------

interface ClaudeMessageResponse {
  readonly content?: ReadonlyArray<{ readonly type: string; readonly text?: string }>;
}

function extractClaudeText(payload: ClaudeMessageResponse): string {
  if (payload.content === undefined) {
    return '';
  }
  const parts: string[] = [];
  for (const block of payload.content) {
    if (block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text);
    }
  }
  return parts.join('');
}

/**
 * Token-count estimate at ~4 chars/token for Latin, ~3 chars/token
 * for Swahili. We average to 3.5. Cost is in USD cents.
 *
 * Pricing as of March 2026: $5 / 1M input + $25 / 1M output tokens.
 *   = $0.0005 / 1k input tokens = 0.05 cents / 1k tokens.
 */
function estimateClaudeCost(sourceText: string, targetText: string): number {
  const inputTokens = Math.ceil(sourceText.length / 3.5);
  const outputTokens = Math.ceil(targetText.length / 3.5);
  const inputCents = (inputTokens / 1_000_000) * 500; // $5/Mtok = 500 cents/Mtok
  const outputCents = (outputTokens / 1_000_000) * 2_500;
  return Math.max(0, Math.round(inputCents + outputCents));
}
