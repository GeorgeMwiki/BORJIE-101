/**
 * Chat artifact adapter for the ag-ui generative-UI registry.
 *
 * iter-50-final wave-c wire — bridges the smartboard chat-artifact stream
 * parser (which emits free-form `<artifact>` text bodies) to the typed
 * `AgUiUiPart` registry. Validates an incoming artifact body against the
 * canonical `PART_SCHEMAS` (Zod) and, when the body is a valid typed
 * payload, returns it so the consumer (chat-artifact composer + blackboard
 * panel) can dispatch through `GENUI_REGISTRY` instead of the legacy
 * AI2D / narrative-scene path.
 *
 * Gradual-migration contract:
 *   - validation runs ALWAYS (Option B behaviour, even when the feature
 *     flag is off) so observability can see typed payloads landing
 *     without changing the render path.
 *   - dispatch via `GENUI_REGISTRY` runs ONLY when
 *     `BORJIE_USE_AG_UI_REGISTRY=true` (Option A behaviour).
 *   - any kind not in `GENUI_REGISTRY` falls back to the legacy renderer
 *     so no regression for in-flight conversations.
 *
 * The adapter is INTENTIONALLY pure (no React, no DOM, no I/O) so it can
 * run server-side inside the SSE proxy at `/api/borjie-ai/blackboard/stream`
 * AND client-side inside `useChatBlackboardStream`.
 *
 * @module features/generative-ui/ag-ui/chat-artifact-adapter
 */

import { PART_SCHEMAS, type PartKind } from "./schemas";
import type { AgUiUiPart } from "./types";

// ============================================================================
// Feature flag
// ============================================================================

/**
 * iter-50-final wave-c wire — env-driven gate for the new GENUI_REGISTRY
 * dispatch path. Defaults to OFF so deploys can land the wiring without
 * changing behaviour for borrowers. Flip to `"true"` to opt a tier or a
 * canary slice into the new renderer.
 *
 * Reads `process.env` lazily so a test can `vi.stubEnv()` between cases
 * without a module reload.
 */
export function isAgUiRegistryEnabled(): boolean {
  const raw = process.env.BORJIE_USE_AG_UI_REGISTRY;
  if (typeof raw !== "string") return false;
  const trimmed = raw.trim().toLowerCase();
  return trimmed === "true" || trimmed === "1" || trimmed === "yes";
}

// ============================================================================
// Schema validation
// ============================================================================

/** Result of validating an artifact body against the ag-ui registry. */
export interface AgUiValidationResult {
  /** True when the body parses + validates as a known AgUiUiPart. */
  readonly ok: boolean;
  /** The validated payload, present iff `ok` is true. */
  readonly part?: AgUiUiPart;
  /** Short human-readable failure reason when `ok` is false. */
  readonly reason?: string;
}

/**
 * Try to interpret a chat-artifact body as a typed `AgUiUiPart`.
 *
 * Steps:
 *   1. JSON-parse the body. Anything non-JSON returns `ok:false`.
 *   2. Pull the `kind` discriminator. Reject when missing / not a string.
 *   3. Look up the matching Zod schema in `PART_SCHEMAS`. Reject when
 *      the kind is unknown to this client build.
 *   4. Run `schema.safeParse(...)`. On failure, return the first issue's
 *      path + message so callers can surface "why" in safety logs.
 *
 * NEVER throws. The caller is the SSE pipeline — a thrown error would
 * tear down the chat stream for an entire session.
 */
export function tryComposeAgUiPart(rawContent: string): AgUiValidationResult {
  if (typeof rawContent !== "string" || rawContent.length === 0) {
    return { ok: false, reason: "empty-body" };
  }
  // Trim so leading whitespace from the LLM's emit doesn't break the
  // JSON.parse contract.
  const trimmed = rawContent.trim();
  // Cheap shape guard — a valid AgUiUiPart is always a JSON object.
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return { ok: false, reason: "not-json-object" };
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic external data shape; narrowing handled at call sites
  let parsed: any;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return { ok: false, reason: "json-parse-failed" };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: "not-json-object" };
  }
  const kindRaw = (parsed as { kind?: unknown }).kind;
  if (typeof kindRaw !== "string" || kindRaw.length === 0) {
    return { ok: false, reason: "missing-kind" };
  }
  const schema = (PART_SCHEMAS as Record<string, unknown>)[kindRaw] as
    | (typeof PART_SCHEMAS)[PartKind]
    | undefined;
  if (!schema) {
    return { ok: false, reason: `unknown-kind:${kindRaw}` };
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    const first = result.error.issues[0];
    const path = Array.isArray(first?.path) ? first.path.join(".") : "$";
    return {
      ok: false,
      reason: `schema-${path || "$"}:${first?.message ?? "invalid"}`,
    };
  }
  return { ok: true, part: result.data as AgUiUiPart };
}

/**
 * Same as `tryComposeAgUiPart` but throws on failure with a helpful
 * message. Use ONLY in code paths where validation already succeeded
 * once upstream and the second check is a defense-in-depth re-validation.
 */
export function composeAgUiPartOrThrow(rawContent: string): AgUiUiPart {
  const r = tryComposeAgUiPart(rawContent);
  if (!r.ok || !r.part) {
    throw new Error(
      `compose AgUiUiPart failed: ${r.reason ?? "unknown reason"}`,
    );
  }
  return r.part;
}
