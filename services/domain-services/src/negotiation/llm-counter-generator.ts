/**
 * R16 — Negotiation LLM counter-offer generator (G-FIX-2).
 *
 * Wraps a stub deterministic midpoint counter (carried over from
 * `defaultStubAiCounterGenerator` in `negotiation-service.ts`) with a
 * real LLM call. The LLM is asked to propose a single counter offer
 * within [lowerBound, listPrice] together with a natural-language
 * rationale (bilingual sw/en).
 *
 * KI-008 closure invariant — the negotiation-service still runs the
 * POST-LLM policy check (`checkPolicy({ actor: 'ai' })`). Even if a
 * prompt-injected LLM proposes a sub-floor offer, the service rejects
 * it. We do not loosen that gate here.
 *
 * This module is provider-agnostic at the type-system level: it
 * accepts a `NegotiationLlmClient` interface that mirrors the
 * Anthropic Messages SDK shape (`messages.create`) so any callable
 * can be injected (the api-gateway adapter binds the real Anthropic
 * SDK; tests inject a hand-rolled stub). We deliberately keep the
 * `@anthropic-ai/sdk` import OUT of this package — domain-services
 * does not need the SDK; the wire is in the calling composition root.
 *
 * Per CLAUDE.md:
 *   - Bilingual sw/en is required for user-visible rationale.
 *   - Pino logger only — caller injects.
 *   - Evidence-required wrapper — output without a non-empty
 *     `rationale` is rejected and the heuristic is used as fallback.
 */

import type {
  AiCounterGenerator,
  AiCounterRequest,
  AiCounterResult,
} from './negotiation-service.js';

// ---------------------------------------------------------------------------
// Provider-agnostic LLM types (mirror Anthropic Messages API shape)
// ---------------------------------------------------------------------------

export interface NegotiationLlmCacheControl {
  readonly type: 'ephemeral';
}

const EPHEMERAL_CACHE: NegotiationLlmCacheControl = Object.freeze({
  type: 'ephemeral',
});

export interface NegotiationLlmTextBlock {
  readonly type: 'text';
  readonly text: string;
  readonly cache_control?: NegotiationLlmCacheControl;
}

export interface NegotiationLlmRequest {
  readonly model: string;
  readonly max_tokens: number;
  readonly temperature?: number;
  readonly system?: string | ReadonlyArray<NegotiationLlmTextBlock>;
  readonly messages: ReadonlyArray<{
    readonly role: 'user' | 'assistant';
    readonly content: string;
  }>;
}

export interface NegotiationLlmResponse {
  readonly content: ReadonlyArray<{ readonly type: string; readonly text?: string }>;
  readonly usage?: {
    readonly input_tokens?: number;
    readonly output_tokens?: number;
    readonly cache_read_input_tokens?: number;
    readonly cache_creation_input_tokens?: number;
  };
}

export interface NegotiationLlmClient {
  readonly model: string;
  readonly messages: {
    create(
      req: NegotiationLlmRequest,
    ): Promise<NegotiationLlmResponse>;
  };
}

// ---------------------------------------------------------------------------
// Logger surface (subset of Pino so the package doesn't need pino as a dep)
// ---------------------------------------------------------------------------

export interface NegotiationLogger {
  warn(meta: Record<string, unknown>, msg?: string): void;
  warn(msg: string): void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface CreateLlmCounterGeneratorOptions {
  readonly client: NegotiationLlmClient | null;
  readonly heuristic: AiCounterGenerator;
  readonly logger?: NegotiationLogger | undefined;
  readonly modelOverride?: string | undefined;
  /** Defaults to `claude-haiku-4-5-20251001` — cheap, latency-tight. */
  readonly defaultModel?: string;
}

const SYSTEM_PROMPT = [
  'You are Borjie, a price-negotiation copilot for Tanzanian',
  '(and pan-African) artisanal-to-mid-tier mining and mineral marketplaces.',
  'You propose a SINGLE counter offer for the seller, expressed as an integer',
  'in the policy currency minor units.',
  '',
  'Hard rules (do not break):',
  '- Output JSON ONLY:',
  '  { "offer": <integer>, "rationale": <string>, "concessions": [<string>, ...] }',
  '- `offer` MUST satisfy: lowerBound <= offer <= listPrice. NEVER below lowerBound.',
  '- `rationale` MUST be bilingual: include an "EN:" English sentence AND a "SW:" Swahili sentence.',
  '- `concessions` is a short list of optional concession descriptions; can be empty.',
  '- Match the tone in the supplied toneGuide ("firm" | "warm" | "flexible").',
  '- No marketing copy. No emojis.',
  '- The downstream system enforces the floorPrice AGAIN after you answer. Stay above lowerBound to avoid an',
  '  escalation that wastes the user\'s time.',
].join('\n');

/**
 * Build a `AiCounterGenerator` that calls the supplied LLM client
 * with prompt caching and falls back to the deterministic heuristic
 * on any error or evidence-empty output.
 *
 * Pass `client: null` to short-circuit straight to the heuristic
 * (covers the no-`ANTHROPIC_API_KEY` mode).
 */
export function createLlmCounterGenerator(
  options: CreateLlmCounterGeneratorOptions,
): AiCounterGenerator {
  const heuristic = options.heuristic;
  const client = options.client;
  const logger = options.logger;
  const model =
    options.modelOverride
    ?? options.defaultModel
    ?? client?.model
    ?? 'claude-haiku-4-5-20251001';

  return async (req: AiCounterRequest): Promise<AiCounterResult> => {
    if (!client) {
      return heuristic(req);
    }
    try {
      const llmOut = await callLlm(client, model, req);
      if (!llmOut.rationale || llmOut.rationale.trim().length === 0) {
        logger?.warn(
          { path: 'negotiation-counter-r16' },
          'brain LLM output missing rationale — falling back to heuristic',
        );
        return heuristic(req);
      }
      // Belt-and-braces: clamp the offer to the [lowerBound, listPrice]
      // band. The negotiation-service ALSO re-checks policy, but
      // clamping here keeps the offer auditable rather than triggering
      // an unnecessary escalation if the LLM strayed by 1-2 units.
      const clamped = Math.min(
        Math.max(llmOut.offer, req.lowerBound),
        req.policy.listPrice,
      );
      return {
        offer: clamped,
        concessions: [],
        rationale: llmOut.rationale,
        modelTier: model,
      };
    } catch (err) {
      logger?.warn(
        { err, path: 'negotiation-counter-r16' },
        'brain LLM call failed — falling back to heuristic',
      );
      return heuristic(req);
    }
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface LlmCounterRaw {
  readonly offer: number;
  readonly rationale: string;
  readonly concessions?: ReadonlyArray<string>;
}

async function callLlm(
  client: NegotiationLlmClient,
  model: string,
  req: AiCounterRequest,
): Promise<LlmCounterRaw> {
  const userPrompt = buildUserPrompt(req);
  const response = await client.messages.create({
    model,
    max_tokens: 768,
    temperature: 0.3,
    // System prompt as a single ephemeral cache_control block — see
    // Anthropic prompt-caching docs. Across multiple turns in a
    // session the system block is identical, so this is the
    // highest-ROI breakpoint.
    system: [
      {
        type: 'text',
        text: SYSTEM_PROMPT,
        cache_control: EPHEMERAL_CACHE,
      },
    ],
    messages: [{ role: 'user', content: userPrompt }],
  });
  const text = extractText(response);
  const candidate = stripFences(text).trim();
  if (!candidate) {
    throw new Error(
      'Negotiation LLM returned empty content (no JSON to parse)',
    );
  }
  const parsed = JSON.parse(candidate) as unknown;
  if (!isLlmCounterRaw(parsed)) {
    throw new Error(
      'Negotiation LLM response did not match the expected JSON shape',
    );
  }
  return parsed;
}

function buildUserPrompt(req: AiCounterRequest): string {
  const lastProspectOffer =
    req.history
      .slice()
      .reverse()
      .find((t) => t.actor !== 'ai')?.offer ?? req.policy.listPrice;
  return JSON.stringify(
    {
      domain: req.negotiation.domain,
      currency: req.policy.currency,
      listPrice: req.policy.listPrice,
      lowerBound: req.lowerBound,
      maxDiscountPct: req.policy.maxDiscountPct,
      toneGuide: req.policy.toneGuide,
      lastProspectOffer,
      roundCount: req.negotiation.roundCount,
      historyLength: req.history.length,
    },
    null,
    2,
  );
}

function extractText(response: NegotiationLlmResponse): string {
  if (!Array.isArray(response.content)) return '';
  return response.content
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('');
}

function stripFences(raw: string): string {
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  return fenceMatch ? (fenceMatch[1] ?? '') : raw;
}

function isLlmCounterRaw(value: unknown): value is LlmCounterRaw {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (typeof v['offer'] !== 'number' || !Number.isFinite(v['offer'])) {
    return false;
  }
  if (typeof v['rationale'] !== 'string') return false;
  if (v['concessions'] !== undefined && !Array.isArray(v['concessions'])) {
    return false;
  }
  return true;
}
