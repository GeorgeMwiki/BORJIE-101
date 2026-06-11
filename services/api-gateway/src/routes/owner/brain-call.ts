/**
 * Shared single-shot brain caller for the owner cockpit BFF routes.
 *
 * Wraps the same Anthropic → OpenAI → DeepSeek ladder that
 * `services/api-gateway/src/routes/public-chat.hono.ts` uses for SSE
 * streams, but exposes a one-shot `callBrainOnce()` so synchronous
 * routes (docs/explain, docs/qa, forms/draft, brief/advisor) can issue a
 * single completion without re-implementing the ladder every time.
 *
 * Failure mode: throws if no provider key is configured AND if every
 * configured provider errors. Callers map that to a 502 / 503. We
 * never return a mocked or canned string — empty content surfaces as a
 * real "all_providers_returned_empty" error.
 *
 * No imports from any module that reads process.env outside bootstrap;
 * the keys are read here lazily and cached so this module stays a leaf.
 */

import {
  AnthropicAdapter,
  OpenAIAdapter,
} from '@borjie/brain-llm-router/universal-client';
import type {
  BrainLLMClient,
  BrainLLMRequest,
  BrainLLMResponse,
  ContentBlock,
} from '@borjie/brain-llm-router';
// LANE B5 — route the live one-shot brain turn through the admin-set
// control-plane config at the universal-client seam. `applyConfigRouting`
// reorders + re-ids the live provider entries to the admin's core + ordered
// fallbacks + per-use-case routing when an admin config exists, and fail-safes
// to the live order otherwise. IP-EGRESS: model ids never leave the server.
import {
  applyConfigRouting,
  type LiveProviderEntry,
  type SeamProviderFamily,
} from '@borjie/brain-llm-router';
import { createLogger } from '../../utils/logger';
// INPUT CONTAINMENT (CLOSE-G chokepoint) — `callBrainOnce` is the SHARED
// one-shot brain seam many owner-cockpit / research / worker routes use. This
// is the structural place to ENFORCE the blessed ingress prompt-injection /
// jailbreak guard: when a caller declares the raw free-text `userText` portion
// of its prompt, the guard runs HERE before any provider sees it, and a
// CRITICAL hit throws `IngressRefusedError` (the caller maps it to a refusal).
// Callers that pass a `preGuarded` flag assert the guard already ran one layer
// up (the route seam) and are not double-guarded. Fail-OPEN-but-logged.
import {
  applyIngressGuard,
  INGRESS_GUARD_REFUSAL_TEXTS,
  type IngressGuardLang,
} from '../../composition/ingress-guard-apply.js';

const moduleLogger = createLogger('owner-brain-call');

/**
 * Thrown by `callBrainOnce` when the ENFORCED ingress chokepoint refuses the
 * free-text `userText` portion (CRITICAL prompt-injection / jailbreak). Carries
 * the single-language refusal copy so a route can surface it verbatim. Callers
 * map this to a 403 INPUT_GUARD_REFUSED — it is NOT a provider failure.
 */
export class IngressRefusedError extends Error {
  readonly code = 'INPUT_GUARD_REFUSED' as const;
  readonly refusalMessage: string;
  constructor(refusalMessage: string) {
    super('input_guard_refused');
    this.name = 'IngressRefusedError';
    this.refusalMessage = refusalMessage;
  }
}

/** DeepSeek is OpenAI-shape; reuse the OpenAI adapter with a base URL. */
class DeepSeekAdapter implements BrainLLMClient {
  public readonly provider = 'openai' as const;
  private readonly inner: OpenAIAdapter;
  constructor(config: { apiKey: string }) {
    this.inner = new OpenAIAdapter({
      apiKey: config.apiKey,
      baseUrl: 'https://api.deepseek.com',
    });
  }
  async invoke(req: BrainLLMRequest): Promise<BrainLLMResponse> {
    return this.inner.invoke(req);
  }
}

interface Providers {
  readonly anthropic: AnthropicAdapter | null;
  readonly openai: OpenAIAdapter | null;
  readonly deepseek: DeepSeekAdapter | null;
}

let providersCache: Providers | null = null;
function providers(): Providers {
  if (providersCache) return providersCache;
  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  const deepseekKey = process.env.DEEPSEEK_API_KEY?.trim();
  providersCache = {
    anthropic: anthropicKey ? new AnthropicAdapter({ apiKey: anthropicKey }) : null,
    openai: openaiKey ? new OpenAIAdapter({ apiKey: openaiKey }) : null,
    deepseek: deepseekKey ? new DeepSeekAdapter({ apiKey: deepseekKey }) : null,
  };
  return providersCache;
}

function extractText(response: BrainLLMResponse): string {
  const parts: string[] = [];
  for (const block of response.content as readonly ContentBlock[]) {
    if (block.type === 'text' && typeof block.text === 'string') {
      parts.push(block.text);
    }
  }
  return parts.join('').trim();
}

export interface BrainOnceInput {
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly maxTokens?: number;
  /**
   * Tenant id for control-plane config scope resolution. When supplied, the
   * admin-set core model + ordered fallbacks (+ per-use-case routing) for this
   * tenant (or the global default) steer which provider answers first. Omit to
   * keep the default Anthropic → OpenAI → DeepSeek order (today's behaviour).
   */
  readonly tenantId?: string;
  /** Per-use-case routing key (intent / surface) for the config resolver. */
  readonly useCase?: string;
  /**
   * The RAW user free-text portion of this turn (the owner's question / scenario
   * / message), BEFORE it was folded into `userPrompt`. When supplied, the
   * ENFORCED ingress chokepoint runs the blessed prompt-injection / jailbreak
   * guard over it here: a CRITICAL hit throws `IngressRefusedError`; a lower
   * severity is tolerated (the route already redacted the span it folded in).
   * Omit ONLY when the prompt carries NO raw user text (machine-built summaries,
   * research synthesis over corpus excerpts) OR when `preGuarded` is set.
   */
  readonly userText?: string;
  /** Locale for the single-language refusal copy. EN default; SW toggles. */
  readonly lang?: IngressGuardLang;
  /** User id scoping the BP-5 ingress audit row (null for anonymous surfaces). */
  readonly userId?: string | null;
  /**
   * Assert the caller ALREADY ran `applyIngressGuard` over the free-text portion
   * one layer up (the route seam). When true the chokepoint does NOT re-guard
   * (avoids double-guarding + double BP-5 audit rows). The structural invariant
   * is preserved: EITHER `userText` is guarded here OR `preGuarded` asserts it
   * ran at the route — a caller passing neither over a raw-user-text prompt is a
   * documented gap the coverage tripwire flags.
   */
  readonly preGuarded?: boolean;
}

export interface BrainOnceResult {
  readonly text: string;
  readonly provider: string;
  readonly latencyMs: number;
}

/**
 * Try every configured provider in order. The first non-empty,
 * non-throwing reply wins. Throws when none of them work.
 */
export async function callBrainOnce(input: BrainOnceInput): Promise<BrainOnceResult> {
  // INPUT CONTAINMENT (CLOSE-G chokepoint) — when the caller declares the raw
  // free-text `userText` portion AND has not asserted `preGuarded`, run the
  // blessed ingress guard HERE before any provider sees the prompt. CRITICAL
  // prompt-injection / jailbreak → throw `IngressRefusedError` (the caller maps
  // it to a 403). Lower severities are tolerated: the prompt was assembled by
  // the route, which redacted the span it folded in. Fail-OPEN-but-logged
  // (the underlying guard never throws; this only refuses on a genuine CRITICAL).
  if (
    !input.preGuarded &&
    typeof input.userText === 'string' &&
    input.userText.length > 0
  ) {
    const ingress = await applyIngressGuard({
      userText: input.userText,
      tenantId: input.tenantId ?? 'global',
      userId: input.userId ?? null,
      lang: input.lang ?? 'en',
    });
    if (ingress.refused) {
      moduleLogger.warn('owner-brain-call: ingress chokepoint refused the turn', {
        tenantId: input.tenantId ?? 'global',
        reasons: ingress.reasons,
      });
      throw new IngressRefusedError(
        ingress.refusalMessage || INGRESS_GUARD_REFUSAL_TEXTS[input.lang ?? 'en'],
      );
    }
  }

  const p = providers();
  const anthropicModel =
    process.env.BORJIE_OWNER_ANTHROPIC_MODEL?.trim() || 'claude-sonnet-4-6';
  const openaiModel =
    process.env.BORJIE_OWNER_OPENAI_MODEL?.trim() || 'gpt-4o-2024-11-20';
  const deepseekModel =
    process.env.BORJIE_OWNER_DEEPSEEK_MODEL?.trim() || 'deepseek-chat';

  type LadderEntry = {
    name: string;
    model: string;
    client: BrainLLMClient;
    family: SeamProviderFamily;
  };
  const candidates: ReadonlyArray<LadderEntry | null> = [
    p.anthropic ? { name: 'anthropic', model: anthropicModel, client: p.anthropic as BrainLLMClient, family: 'anthropic' } : null,
    p.openai ? { name: 'openai', model: openaiModel, client: p.openai as BrainLLMClient, family: 'openai' } : null,
    p.deepseek ? { name: 'deepseek', model: deepseekModel, client: p.deepseek as BrainLLMClient, family: 'deepseek' } : null,
  ];
  const baseLadder: ReadonlyArray<LadderEntry> = candidates.filter(
    (x): x is LadderEntry => x !== null,
  );

  if (baseLadder.length === 0) {
    throw new Error(
      'no brain provider configured (set ANTHROPIC_API_KEY, OPENAI_API_KEY, or DEEPSEEK_API_KEY)',
    );
  }

  // LANE B5 — apply the admin control-plane routing config at the seam. When a
  // tenant is supplied AND an admin config exists, this reorders the live
  // providers to the admin's core + ordered fallbacks and binds the admin's
  // chosen raw model id per provider family (+ per-use-case override). Fail-
  // safe: with no tenant, no config, or the kill-switch off, the live order is
  // returned unchanged. Model ids stay server-side (IP-egress invariant).
  const live: ReadonlyArray<LiveProviderEntry<LadderEntry>> = baseLadder.map(
    (e) => ({ model: e.model, providerFamily: e.family, entry: e }),
  );
  const applied = applyConfigRouting({
    task: 'chat',
    tenantId: input.tenantId ?? 'global',
    ...(input.useCase !== undefined ? { useCase: input.useCase } : {}),
    live,
  });
  // The seam returns the original LadderEntry plus the (possibly-overridden)
  // raw model id to send — re-bind the id onto the entry for the loop below.
  const ladder: ReadonlyArray<LadderEntry> = applied.ladder.map((x) => ({
    ...x.entry,
    model: x.model,
  }));

  const maxTokens = input.maxTokens ?? 600;
  const messages = [
    {
      role: 'user' as const,
      content: [{ type: 'text' as const, text: input.userPrompt }],
    },
  ];
  const errors: string[] = [];

  for (const entry of ladder) {
    const t0 = Date.now();
    try {
      const isAnthropicOpus47Plus =
        entry.model.startsWith('claude-opus-4-7') ||
        entry.model.startsWith('claude-opus-4-8') ||
        entry.model.startsWith('claude-opus-5');
      const request: BrainLLMRequest = {
        model: entry.model,
        messages,
        system: input.systemPrompt,
        maxTokens,
        ...(isAnthropicOpus47Plus ? {} : { temperature: 0.4 }),
      };
      const response = await entry.client.invoke(request);
      const text = extractText(response);
      if (text.length === 0) {
        errors.push(`${entry.name}:empty`);
        continue;
      }
      return {
        text,
        provider: entry.name,
        latencyMs: Date.now() - t0,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${entry.name}:${msg.slice(0, 120)}`);
      moduleLogger.warn('owner-brain-call: provider failed', {
        provider: entry.name,
        model: entry.model,
        latencyMs: Date.now() - t0,
        error: msg.slice(0, 600),
      });
    }
  }

  throw new Error(`all_providers_failed: ${errors.join(' | ')}`);
}
