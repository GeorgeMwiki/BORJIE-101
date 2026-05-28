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
import { createLogger } from '../../utils/logger';

const moduleLogger = createLogger('owner-brain-call');

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
  const p = providers();
  const anthropicModel =
    process.env.BORJIE_OWNER_ANTHROPIC_MODEL?.trim() || 'claude-sonnet-4-5-20250929';
  const openaiModel =
    process.env.BORJIE_OWNER_OPENAI_MODEL?.trim() || 'gpt-4o-2024-11-20';
  const deepseekModel =
    process.env.BORJIE_OWNER_DEEPSEEK_MODEL?.trim() || 'deepseek-chat';

  type LadderEntry = { name: string; model: string; client: BrainLLMClient };
  const candidates: ReadonlyArray<LadderEntry | null> = [
    p.anthropic ? { name: 'anthropic', model: anthropicModel, client: p.anthropic as BrainLLMClient } : null,
    p.openai ? { name: 'openai', model: openaiModel, client: p.openai as BrainLLMClient } : null,
    p.deepseek ? { name: 'deepseek', model: deepseekModel, client: p.deepseek as BrainLLMClient } : null,
  ];
  const ladder: ReadonlyArray<LadderEntry> = candidates.filter(
    (x): x is LadderEntry => x !== null,
  );

  if (ladder.length === 0) {
    throw new Error(
      'no brain provider configured (set ANTHROPIC_API_KEY, OPENAI_API_KEY, or DEEPSEEK_API_KEY)',
    );
  }

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
