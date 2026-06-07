/**
 * Brain-port adapter — binds the gateway's budget-guarded Anthropic client to
 * the `Brain` port `@borjie/progressive-intelligence` expects.
 *
 * The progressive-intelligence subsystems (live-coaching, streaming inference)
 * accept an abstract `Brain { stream(req): AsyncIterable<BrainChunk> }` rather
 * than importing a concrete LLM client, so they stay pure + testable. This
 * adapter is the production binding: it wraps the SAME per-tenant
 * budget-guarded Anthropic client every other gateway capability uses
 * (`buildBudgetGuardedAnthropicClient`, via the shared `callGuardedAnthropic`
 * helper), so coaching shares the tenant budget guard, model selection, and
 * usage accounting — no separate API key, no `process.env` read here.
 *
 * Streaming shape: the guarded client exposes a single non-streaming
 * `messages.create` round-trip (the registry wraps `messages.create`, not the
 * SSE `messages.stream`). Live coaching deliberately consumes a STABLE bundle
 * (see live-coaching/coach.ts — "we deliberately do NOT stream coaching
 * hints"), so a one-shot adapter that yields the full completion as a single
 * token chunk then `done` is the correct, honest binding: the coach gets the
 * whole JSON array at once. The adapter is generic enough for any
 * bundle-consuming progressive subsystem; a true token-streaming binding would
 * require the registry to also expose `messages.stream` (noted in the report).
 *
 * Errors degrade in-band: an SDK / budget throw becomes a single `error` chunk
 * (never a thrown exception across the async-iterable boundary), which the
 * coach maps to "heuristics-only" — exactly its documented fallback.
 *
 * No `console.log` — failures surface as `error` chunks; the caller decides.
 */

import {
  callGuardedAnthropic,
  type GuardedAnthropicFactory,
} from '../ai-native/llm-client.js';
import type {
  Brain,
  BrainChunk,
  BrainRequest,
} from '@borjie/progressive-intelligence';

const DEFAULT_MAX_TOKENS = 1024;

export interface AnthropicBrainPortArgs {
  /** Per-tenant budget-guarded client factory (registry's). */
  readonly buildClient: GuardedAnthropicFactory;
  readonly tenantId: string;
  /** Usage / budget tag, e.g. 'progressive.coaching'. */
  readonly operation: string;
}

/**
 * Build a `Brain` bound to a tenant's budget-guarded Anthropic client. Returns
 * a one-shot streaming adapter suitable for bundle-consuming subsystems
 * (live-coaching). Caller owns the tenant scoping.
 */
export function createAnthropicBrainPort(args: AnthropicBrainPortArgs): Brain {
  return {
    stream(request: BrainRequest): AsyncIterable<BrainChunk> {
      return oneShotStream(args, request);
    },
  };
}

async function* oneShotStream(
  args: AnthropicBrainPortArgs,
  request: BrainRequest,
): AsyncGenerator<BrainChunk, void, unknown> {
  let result;
  try {
    result = await callGuardedAnthropic(args.buildClient, {
      tenantId: args.tenantId,
      operation: args.operation,
      systemPrompt: request.system ?? '',
      userPrompt: request.prompt,
      maxTokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      ...(request.temperature !== undefined
        ? { temperature: request.temperature }
        : {}),
    });
  } catch (err) {
    yield {
      kind: 'error',
      message: err instanceof Error ? err.message : String(err),
    };
    return;
  }

  if (result.text.length > 0) {
    yield { kind: 'token', text: result.text };
  }
  yield {
    kind: 'done',
    meta: {
      modelVersion: result.modelVersion,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    },
  };
}
