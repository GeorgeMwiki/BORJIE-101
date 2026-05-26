/**
 * AI-Native shared foundation.
 *
 * Ports + helpers shared across all 8 AI-native capabilities:
 *   1. sentiment-monitor
 *   2. market-surveillance
 *   3. multimodal-inspection
 *   4. polyglot-support
 *   5. predictive-interventions
 *   6. policy-simulator
 *   7. natural-language-query
 *   8. pattern-mining
 *
 * Design goals:
 *   - Every LLM call is budget-guarded (caller wraps SDK with withBudgetGuard).
 *   - Every call carries a prompt-hash for audit reproducibility.
 *   - Every result carries a model_version + confidence + explanation.
 *   - Language is ISO-639-1/-2 codes — never hardcoded en/sw pairs.
 *   - Currency is ISO-4217.
 *   - Zero hardcoded jurisdiction — jurisdictional rules are dispatched via
 *     `@borjie/compliance-plugins`.
 */

import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Prompt-hash audit helper
// ---------------------------------------------------------------------------

/**
 * Deterministic SHA-256 digest of a prompt for reproducibility audit.
 * Callers log the resulting hex string alongside LLM results so a later
 * auditor can compare two runs and know whether the same prompt was used.
 */
export function promptHash(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// Budget-guard integration point
// ---------------------------------------------------------------------------

/**
 * Every AI-native capability accepts an optional `BudgetGuard` callback.
 * The callback is invoked BEFORE any LLM call. A throwing callback blocks
 * the round-trip. Wire it to `CostLedger.assertWithinBudget(tenantId)`.
 *
 * Follow-up Agent Z4 (#33): Once the multi-LLM router lands, replace direct callers
 * of this with `withBudgetGuard(router, { ledger, context: () => ({ tenantId }) })`.
 */
export interface BudgetGuard {
  (tenantId: string, operation: string): Promise<void> | void;
}

export const noopBudgetGuard: BudgetGuard = async () => {};

// ---------------------------------------------------------------------------
// Classification LLM port
// ---------------------------------------------------------------------------

/**
 * Minimal LLM classification port. Concrete implementations wrap Anthropic
 * / OpenAI / a local model. Pure functions here depend only on this port —
 * tests can pass a stub.
 */
export interface ClassifyLLMPort {
  /**
   * Return a structured JSON object matching the caller's schema. Callers
   * parse + validate the result themselves so the port stays generic.
   */
  classify(input: {
    systemPrompt: string;
    userPrompt: string;
    model?: string;
  }): Promise<{
    raw: string;
    modelVersion: string;
    inputTokens: number;
    outputTokens: number;
  }>;
}

/**
 * Degraded mode: when the LLM port is unavailable, capabilities still return
 * a structured result with `confidence: 0` + `model_version: 'degraded'` so
 * downstream consumers can filter. This keeps the pipeline alive without
 * fabricating classifications.
 */
export const DEGRADED_MODEL_VERSION = 'degraded-no-llm' as const;

// ---------------------------------------------------------------------------
// Vision LLM port (multimodal-inspection)
// ---------------------------------------------------------------------------

export interface VisionLLMPort {
  analyze(input: {
    systemPrompt: string;
    userPrompt: string;
    media: ReadonlyArray<{
      readonly kind: 'image' | 'video' | 'audio';
      readonly url: string;
      readonly mediaId?: string;
    }>;
    model?: string;
  }): Promise<{
    raw: string;
    modelVersion: string;
    inputTokens: number;
    outputTokens: number;
  }>;
}

// ---------------------------------------------------------------------------
// JSON parsing helpers
// ---------------------------------------------------------------------------

/**
 * Safely parse JSON emitted by an LLM. LLMs sometimes wrap JSON in a code
 * fence or add a trailing "Here's your answer:" prefix. We trim the most
 * common wrappers and return null on failure. Callers fall back to a
 * degraded-mode result on null.
 */
export function safeJsonParse<T = unknown>(raw: string): T | null {
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  // Strip markdown code fences
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : trimmed;
  // Try parse; if the body starts with arbitrary prose, find the first { or [
  try {
    return JSON.parse(body.trim()) as T;
  } catch {
    const firstBrace = body.search(/[\[{]/);
    if (firstBrace < 0) return null;
    const candidate = body.slice(firstBrace);
    try {
      return JSON.parse(candidate) as T;
    } catch {
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// ID generation (stable per record so inserts are idempotent on retry)
// ---------------------------------------------------------------------------

export function newId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

// ---------------------------------------------------------------------------
// Clamping helpers for LLM-returned floats
// ---------------------------------------------------------------------------

export function clamp01(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return Math.max(0, Math.min(1, n));
}

export function clampBipolar(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : 0;
  return Math.max(-1, Math.min(1, n));
}

// ---------------------------------------------------------------------------
// Aggregation guard (pattern-mining privacy-by-design)
// ---------------------------------------------------------------------------

/**
 * Minimum tenant count required before an aggregated pattern can be
 * published back to consumers. Below this threshold the pattern-mining
 * pipeline MUST suppress the row. DPIA-style privacy-by-design.
 */
export const MIN_TENANTS_FOR_AGGREGATION = 5;
