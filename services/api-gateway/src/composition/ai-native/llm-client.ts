/**
 * Shared Anthropic-LLM helper for the AI-native (Agent PhL) capability
 * adapters: dynamic-pricing, doc-intelligence, legal-drafter.
 *
 * The three PhL feature factories
 * (`createDynamicPriceOptimizer`, `createDocumentIntelligence`,
 * `createLegalDrafter`) each depend on a *typed* LLM port. This module
 * provides the single primitive every port adapter shares: issue one
 * `messages.create` round-trip against the per-tenant budget-guarded
 * Anthropic client the composition root already builds
 * (`buildBudgetGuardedAnthropicClient`), then return the model text plus
 * usage counters.
 *
 * Budget discipline: the per-tenant client is `withBudgetGuard`-wrapped at
 * the registry, so each call here asserts the tenant is within budget
 * BEFORE the HTTP round-trip and records usage AFTER — exactly once. The
 * PhL factories are therefore wired WITHOUT their own `ledger` to avoid
 * double-recording (see `ai-native-wiring.ts`).
 *
 * No `process.env` access — the API key + model live inside the injected
 * client factory, bound at the composition root.
 */

import { safeJsonParse } from '@borjie/ai-copilot/ai-native';

/**
 * Structural shape of the per-tenant budget-guarded Anthropic client the
 * registry exposes via `buildBudgetGuardedAnthropicClient(tenantId, op?)`.
 * Duck-typed so this file never hard-imports `@borjie/ai-copilot/providers`.
 */
export interface GuardedAnthropicLike {
  readonly defaultModel: string;
  readonly sdk: {
    readonly messages: {
      create(request: {
        model: string;
        max_tokens: number;
        temperature?: number;
        system?: string;
        messages: Array<{ role: 'user' | 'assistant'; content: string }>;
      }): Promise<{
        content: Array<{ type: string; text?: string }>;
        usage?: { input_tokens?: number; output_tokens?: number };
      }>;
    };
  };
}

/**
 * Per-tenant client factory the composition root binds — mirrors
 * `buildBudgetGuardedAnthropicClient` from the service registry. `null`
 * when no `ANTHROPIC_API_KEY` is configured (the wiring then degrades the
 * three LLM-backed features to `LLM_NOT_CONFIGURED`).
 */
export type GuardedAnthropicFactory = (
  tenantId: string,
  operation?: string,
) => GuardedAnthropicLike;

export interface LlmCallInput {
  readonly tenantId: string;
  readonly operation: string;
  readonly systemPrompt: string;
  readonly userPrompt: string;
  readonly maxTokens: number;
  readonly temperature?: number;
}

export interface LlmCallResult {
  readonly text: string;
  readonly modelVersion: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/**
 * Issue one budget-guarded Anthropic completion and return the assistant
 * text plus usage. Throws when the SDK throws (including
 * `AiBudgetExceededError` from the guard) — the PhL factory maps the throw
 * onto its `AiNativeResult` envelope.
 */
export async function callGuardedAnthropic(
  buildClient: GuardedAnthropicFactory,
  input: LlmCallInput,
): Promise<LlmCallResult> {
  const client = buildClient(input.tenantId, input.operation);
  const response = await client.sdk.messages.create({
    model: client.defaultModel,
    max_tokens: input.maxTokens,
    ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
    system: input.systemPrompt,
    messages: [{ role: 'user', content: input.userPrompt }],
  });

  return {
    text: extractText(response.content),
    modelVersion: client.defaultModel,
    inputTokens: response.usage?.input_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
  };
}

/**
 * Concatenate every `text` block of an Anthropic content array. Non-text
 * blocks (tool_use, etc.) are skipped — the PhL ports request plain JSON
 * or prose, never tools.
 */
function extractText(
  content: ReadonlyArray<{ type: string; text?: string }>,
): string {
  if (!Array.isArray(content)) return '';
  return content
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text ?? '')
    .join('');
}

/**
 * Parse a JSON object from LLM output, tolerating code fences / prose
 * preambles via the shared `safeJsonParse`. Returns `null` on failure so
 * callers can raise a typed `UPSTREAM_ERROR`.
 */
export function parseLlmJson<T>(raw: string): T | null {
  return safeJsonParse<T>(raw);
}
