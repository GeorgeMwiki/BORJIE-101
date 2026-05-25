/**
 * AOP — Agent Operating Procedure.
 *
 * The Decagon pattern (per `.audit/litfin-sota-2026-05-23/09-closed-loop-
 * company-os.md`): an AOP is a versioned, NL-anchored spec that *compiles*
 * to structured agent logic. The closed loop is:
 *
 *   AOP Copilot drafts a new version
 *     ↓
 *   Regression suite replays historical transcripts against it
 *     ↓
 *   Canary stages roll new traffic into it gradually
 *     ↓
 *   SLO monitor demotes the version on quality drift
 *     ↓
 *   Production traces feed AOP Copilot the next draft
 *
 * This file declares the *data shape* only — Zod schemas + types. The
 * registry, runner, and canary bridge live in sibling files.
 *
 * Versioning model:
 *   - `id`        — stable AOP identity, e.g. 'maintenance-triage-v1'.
 *   - `version`   — monotonically increasing string (caller chooses
 *                   semver, sha, or yyyymmdd-N); the registry treats it
 *                   as opaque. Uniqueness is enforced per (id, version).
 *
 * Anti-mutation guarantees:
 *   - All array / record fields are `readonly`.
 *   - Tools are referenced by name only — the runner resolves them
 *     against an injected ToolRegistry, not the spec itself, so old
 *     spec versions don't pin live tool implementations.
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────
// AOPSpec
// ─────────────────────────────────────────────────────────────────────

/**
 * Minimal model descriptor. Kept loose because BORJIE may swap
 * provider names (anthropic | openai | bedrock) without bumping the
 * AOP schema. The runner adapter validates `provider` at wire time.
 */
export const AopModelDescriptorSchema = z
  .object({
    provider: z.string().min(1),
    name: z.string().min(1),
    temperature: z.number().min(0).max(2).optional(),
    maxOutputTokens: z.number().int().positive().optional(),
  })
  .strict()
  .readonly();

export type AopModelDescriptor = z.infer<typeof AopModelDescriptorSchema>;

/**
 * An AOP version. Frozen — once registered for a given (id, version) it
 * cannot be replaced. New behaviour requires a new `version` string.
 */
export const AOPSpecSchema = z
  .object({
    id: z.string().min(1),
    version: z.string().min(1),
    /**
     * The Natural-Language Operating Procedure itself. This is the
     * system prompt the LLM runs under; Decagon-style AOP-Copilot
     * mutates *this* across versions, never the runner.
     */
    systemPrompt: z.string().min(1),
    /** Tool *names* — runtime registry is injected separately. */
    tools: z.array(z.string().min(1)).readonly(),
    model: AopModelDescriptorSchema,
    /**
     * The RegressionSet that gates promotion. Each new version is
     * replayed against this set before any canary traffic flows.
     */
    regressionSetId: z.string().min(1),
    /**
     * Team / persona accountable for this AOP. Free-form so platform
     * and tenant scopes can both author AOPs without a schema change.
     */
    ownedBy: z.string().min(1),
    /** ISO-8601 instant — when the spec entered the registry. */
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .readonly();

export type AOPSpec = z.infer<typeof AOPSpecSchema>;

// ─────────────────────────────────────────────────────────────────────
// RegressionSet
// ─────────────────────────────────────────────────────────────────────

/**
 * One historical transcript replayed against a new AOP version. The
 * `expectedSignals` array lists pass-criteria — substring or rubric ids
 * the runner must produce. Empty `expectedSignals` is allowed but
 * means the run is informational only (no pass/fail contribution).
 */
export const RegressionTranscriptSchema = z
  .object({
    id: z.string().min(1),
    /** The original user message that started the conversation. */
    userMessage: z.string().min(1),
    /**
     * The known-good final answer text from the historical run. The
     * regression-runner compares the candidate output against this via
     * substring containment + optional rubric (rubric is wired by the
     * runner host — out of scope for the spec).
     */
    expectedAnswerSubstring: z.string().optional(),
    /**
     * Free-form signal tokens the candidate output must contain. E.g.
     * `['cited:lease-123', 'tool:lookupArrears']`. Empty array = no
     * signals required.
     */
    expectedSignals: z.array(z.string().min(1)).readonly(),
    /**
     * Opaque metadata — original timestamp, persona, tenant fingerprint.
     * Never inspected by the registry; surfaced in regression reports.
     */
    metadata: z.record(z.string(), z.unknown()).readonly().optional(),
  })
  .strict()
  .readonly();

export type RegressionTranscript = z.infer<typeof RegressionTranscriptSchema>;

/**
 * Bundle of regression transcripts gating one or more AOPs. Multiple
 * AOPs MAY share a regression set (common pattern: a tenant overrides
 * the platform AOP but reuses the platform regression suite).
 */
export const RegressionSetSchema = z
  .object({
    id: z.string().min(1),
    transcripts: z.array(RegressionTranscriptSchema).readonly(),
  })
  .strict()
  .readonly();

export type RegressionSet = z.infer<typeof RegressionSetSchema>;

// ─────────────────────────────────────────────────────────────────────
// Parse helpers — throw on invalid input, return frozen instance.
// ─────────────────────────────────────────────────────────────────────

export function parseAOPSpec(input: unknown): AOPSpec {
  return AOPSpecSchema.parse(input);
}

export function parseRegressionSet(input: unknown): RegressionSet {
  return RegressionSetSchema.parse(input);
}
