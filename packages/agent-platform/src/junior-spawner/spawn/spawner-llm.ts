/**
 * LLM-driven junior authoring (Wave 18V-DYNAMIC).
 *
 * Routes through `@borjie/brain-llm-router`'s cost-cascade — Opus for
 * the heavyweight first draft (extended thinking 32k tokens), Sonnet
 * for revisions. Spec §6.
 *
 * IMPORTANT: this module exposes the LLM call BEHIND a function
 * interface so tests can stub it. We do NOT import brain-llm-router
 * directly here — the production binding lives in the composition
 * root (the future junior-evolution-worker or persona-runtime
 * service); this module is the pure orchestration shell.
 */

import { validateSpawnedJuniorPayload } from './payload-validator.js';
import type {
  JuniorSpawnRequest,
  SpawnedJuniorAuthorPayload,
} from '../types.js';

// ─────────────────────────────────────────────────────────────────────
// Cost budget (spec §6)
// ─────────────────────────────────────────────────────────────────────

export const SPAWN_COST_BUDGET_USD = 0.5;
export const SPAWN_LATENCY_BUDGET_MS = 90_000;
export const EXTENDED_THINKING_TOKENS = 32_000;

// ─────────────────────────────────────────────────────────────────────
// Brain client interface — bound by composition root
// ─────────────────────────────────────────────────────────────────────

/**
 * Minimum surface the spawner needs from `brain-llm-router`. The
 * composition root binds this to a real `brainCall` invocation.
 */
export interface BrainCallResult {
  readonly response_text: string;
  readonly cost_usd: number;
  readonly latency_ms: number;
}

export interface BrainCallFn {
  (input: BrainCallInput): Promise<BrainCallResult>;
}

export interface BrainCallInput {
  readonly tenant_id: string;
  readonly task: 'junior-spawn';
  readonly prompt: string;
  readonly extended_thinking_tokens: number;
  readonly cost_cap_usd: number;
  readonly latency_cap_ms: number;
}

// ─────────────────────────────────────────────────────────────────────
// Outcome shape
// ─────────────────────────────────────────────────────────────────────

export type SpawnOutcome =
  | { readonly ok: true; readonly payload: SpawnedJuniorAuthorPayload; readonly cost_usd: number; readonly latency_ms: number }
  | { readonly ok: false; readonly errors: ReadonlyArray<string> };

// ─────────────────────────────────────────────────────────────────────
// Prompt builder
// ─────────────────────────────────────────────────────────────────────

/**
 * Build the LLM prompt. Includes the seed list + recent spawned
 * list so the LLM does not duplicate existing specialisations.
 * Pure function — easy to snapshot-test.
 */
export function buildSpawnPrompt(
  request: JuniorSpawnRequest,
  existing_specialisations: ReadonlyArray<string>,
): string {
  const dedupe_list =
    existing_specialisations.length === 0
      ? '(no existing specialisations)'
      : existing_specialisations.map((s) => `- ${s}`).join('\n');

  return [
    `You are authoring a new "junior" specialist persona for Borjie.`,
    `The user-facing display name MUST be "Mr. Mwikila" — never propose another name.`,
    `Your output is a JSON object matching SpawnedJuniorAuthorPayload.`,
    ``,
    `User intent: ${request.intent_natural_language}`,
    `Audience: ${request.active_scope.audience}`,
    `Tenant: ${request.tenant_id}`,
    ``,
    `Existing specialisations (do not duplicate):`,
    dedupe_list,
    ``,
    `Required fields:`,
    `  - proposed_agent_id (kebab-case English)`,
    `  - proposed_specialisation (short label)`,
    `  - proposed_subtitle (must start with "Borjie's AI")`,
    `  - proposed_scope (JuniorScope)`,
    `  - proposed_modes (3-5 modes)`,
    `  - proposed_escalation_policy`,
    `  - proposed_audiences`,
    `  - proposed_authority_tier_max (0, 1, or 2)`,
    `  - llm_reasoning (your reasoning trace)`,
  ].join('\n');
}

// ─────────────────────────────────────────────────────────────────────
// Orchestrator
// ─────────────────────────────────────────────────────────────────────

/**
 * Run the spawn pipeline:
 *   1. Build prompt
 *   2. Call the brain client with cost + latency caps
 *   3. Parse + validate the response
 *   4. Return a discriminated outcome
 *
 * The pipeline aborts early on validator failure; the caller falls
 * back to an escalation rather than persisting a malformed payload.
 */
export async function runSpawnLlmCall(
  request: JuniorSpawnRequest,
  existing_specialisations: ReadonlyArray<string>,
  brain_call: BrainCallFn,
): Promise<SpawnOutcome> {
  const prompt = buildSpawnPrompt(request, existing_specialisations);

  let raw: BrainCallResult;
  try {
    raw = await brain_call({
      tenant_id: request.tenant_id,
      task: 'junior-spawn',
      prompt,
      extended_thinking_tokens: EXTENDED_THINKING_TOKENS,
      cost_cap_usd: SPAWN_COST_BUDGET_USD,
      latency_cap_ms: SPAWN_LATENCY_BUDGET_MS,
    });
  } catch (error) {
    return {
      ok: false,
      errors: [
        `brain-call failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ],
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.response_text);
  } catch (error) {
    return {
      ok: false,
      errors: [
        `failed to parse LLM JSON: ${
          error instanceof Error ? error.message : String(error)
        }`,
      ],
    };
  }

  const validation = validateSpawnedJuniorPayload(parsed);
  if (!validation.ok) {
    return { ok: false, errors: validation.errors };
  }

  return {
    ok: true,
    payload: validation.payload,
    cost_usd: raw.cost_usd,
    latency_ms: raw.latency_ms,
  };
}
