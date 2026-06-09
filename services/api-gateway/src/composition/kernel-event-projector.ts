/**
 * Kernel/agent-event egress PROJECTOR — the single client-safe chokepoint
 * (CLOSE-G structural backstop).
 *
 * Every kernel / agent SSE / WS serializer in the gateway emits a stream of
 * raw internal events — `plan | thought | reflection | reasoning | tool_call |
 * tool_result | text | citation | artifact | error | …`. Streamed verbatim,
 * those frames leak the brain's INTERNAL MECHANICS to a client:
 *
 *   - model REASONING (plan / thought / reflection / extended-thinking / CoT) —
 *     the model's private scratch-pad, NEVER for a client;
 *   - tool / agent / provider / model NAMES + tool ARGS — exposes the brain's
 *     tool surface + can carry prompt fragments / IP;
 *   - handoff objectives, persona / internal / provider-prefixed ids;
 *   - RAW upstream errors (provider / model / internal-id detail).
 *
 * `ai-chat.router.ts` solved this for the `StreamTurnEvent` stream with
 * `projectChatStreamEvent`. This module GENERALISES that pattern into ONE
 * reusable projector so EVERY kernel/agent serializer can route its events
 * through a single chokepoint. A NEW serializer that adopts `projectKernelEvent`
 * is safe BY CONSTRUCTION — it physically cannot emit a reasoning frame, a raw
 * tool name, or an un-egress-filtered prose leaf, because the projector drops /
 * coarsens / filters them before they ever reach the wire.
 *
 * The projection rules (the IP-egress invariant, made structural):
 *   - reasoning class (`plan` / `thought` / `reflection` / `reasoning` /
 *     `thinking` / `thought_delta` / `scratchpad` / `critique` / `debate`) →
 *     DROPPED ENTIRELY (returns `null`). Model CoT never reaches a client.
 *   - `tool_call` / `tool_result` → COARSENED to a generic `action` label. No
 *     tool name, no args (args can carry prompts / IP); `tool_result` keeps a
 *     boolean ok flag only.
 *   - `text` / `citation` prose leaves → run through `getEgressFilter().guardFinal`
 *     (FAIL-CLOSED). A thrown filter yields the generic `[redacted]` placeholder,
 *     never the raw text.
 *   - `error` → a GENERIC single-language-neutral banner. The raw cause is
 *     logged server-side (pino) by the CALLER; the projector never forwards it.
 *   - `done` / lifecycle → kept, stripped of any persona / agent / model id.
 *   - handoff / unknown mechanic frames → DROPPED.
 *
 * This is a BACKSTOP, not the sole guarantee. The blessed `getEgressFilter`
 * (text firewall) + `getArtifactEgressMembrane` (structured artifacts) remain
 * the per-leaf strips; this projector decides WHICH frames cross the wire and
 * routes the prose leaves through the text firewall. The two layers compose.
 *
 * No `console.*` (Pino shim only — the egress filter owns its sink). No
 * `process.env` read here (the kill-switch is read once inside the egress
 * filter singleton). Immutable: every return is a frozen new object.
 *
 * @module services/api-gateway/src/composition/kernel-event-projector
 */

import { getEgressFilter } from './egress-filter-wiring.js';
import type { PinoLikeLogger } from '../utils/pino-shim.js';
import { createPinoLikeLogger } from '../utils/pino-shim.js';

const logger: PinoLikeLogger = createPinoLikeLogger('kernel-event-projector');

/**
 * IP-EGRESS — the single coarse, provider-agnostic label the client-facing tool
 * frames carry. The raw internal tool verb is an IP leak (it exposes the brain's
 * tool surface). Mirrors `ai-chat.router.ts` + `brain-voice.hono.ts`
 * `COARSE_TOOL_CALL_LABEL`.
 */
export const COARSE_KERNEL_TOOL_LABEL = 'action' as const;

/** Generic egress fail-closed placeholder for model-authored text. */
const EGRESS_FAIL_CLOSED = '[redacted]';

/**
 * Generic, single-language-neutral client error banner. The raw kernel / agent
 * / provider error string can leak provider / model / internal-id detail, so the
 * projector NEVER forwards it — the caller logs the raw cause server-side.
 */
export const GENERIC_KERNEL_ERROR_MESSAGE =
  'The assistant is temporarily unavailable. Please try again.';

/**
 * The reasoning-class event kinds DROPPED entirely on egress (model CoT —
 * never to a client). Covers the AgentEvent (`plan` / `thought`), the kernel
 * stream (`thought_delta` / `thinking`), and the broader cognition vocabulary
 * (`reflection` / `reasoning` / `scratchpad` / `critique` / `debate`) so a new
 * serializer that emits any reasoning frame is dropped by construction.
 */
const REASONING_KINDS: ReadonlyArray<string> = Object.freeze([
  'plan',
  'thought',
  'thought_delta',
  'thinking',
  'reflection',
  'reasoning',
  'reasoning_trace',
  'scratchpad',
  'critique',
  'debate',
  'cognition',
]);

/** The tool-mechanic event kinds COARSENED to a generic label on egress. */
const TOOL_KINDS: ReadonlyArray<string> = Object.freeze([
  'tool_call',
  'tool_result',
]);

/** Frames that are pure agent-to-agent mechanics — DROPPED entirely. */
const HANDOFF_KINDS: ReadonlyArray<string> = Object.freeze(['handoff']);

/**
 * A projected, client-safe frame. `event` is the SSE event name (or WS frame
 * kind) the caller serialises; `data` is the client-safe payload. A projector
 * that returns `null` means the frame is DROPPED (reasoning / handoff / unknown
 * mechanic) and the caller must emit nothing for it.
 */
export interface ProjectedKernelFrame {
  readonly event: string;
  readonly data: Record<string, unknown>;
}

/** A minimal structural view of a raw kernel/agent event (kind-discriminated). */
type RawKernelEvent = Record<string, unknown> & { readonly kind?: unknown };

/**
 * Guard a model-authored text leaf through the FAIL-CLOSED egress filter. A
 * thrown filter (or construction fault) yields the generic placeholder, never
 * the raw text. Empty / non-string spans pass through unchanged.
 */
function guardText(text: unknown, tenantId: string): string {
  if (typeof text !== 'string' || text.length === 0) {
    return typeof text === 'string' ? text : '';
  }
  try {
    return getEgressFilter().guardFinal(text, tenantId).text;
  } catch (err) {
    logger.error(
      {
        wiring: 'kernel-event-projector',
        tenantId,
        err: err instanceof Error ? err.message : String(err),
      },
      'kernel-event-projector: egress guard threw — failing closed',
    );
    return EGRESS_FAIL_CLOSED;
  }
}

/**
 * Read the discriminating `kind` of a raw kernel/agent event. Returns '' when
 * the event has no string kind (an unknown shape is treated as a mechanic frame
 * and dropped by the caller).
 */
function kindOf(evt: RawKernelEvent): string {
  return typeof evt.kind === 'string' ? evt.kind : '';
}

/**
 * Project ONE raw kernel / agent event to its client-safe frame. Returns `null`
 * for any frame the client must never see (reasoning / handoff / unknown
 * mechanic). The projection is the IP-egress invariant made structural:
 *
 *   - reasoning class           → DROP (null) — model CoT.
 *   - tool_call / tool_result   → COARSE `action` label; no name / args.
 *   - text                      → prose through the FAIL-CLOSED egress filter.
 *   - citation                  → the label / target id ONLY, prose-guarded; the
 *                                 full citation object (which may carry model
 *                                 reasoning in a `rationale`) is NOT forwarded.
 *   - error                     → GENERIC banner (raw cause logged by caller).
 *   - done / lifecycle          → kept, stripped of persona / agent / model id.
 *   - handoff / unknown         → DROP (null).
 *
 * `tenantId` scopes the egress filter. Pure — returns a NEW frozen frame.
 */
export function projectKernelEvent(
  evt: RawKernelEvent,
  tenantId: string,
): ProjectedKernelFrame | null {
  const kind = kindOf(evt);
  if (kind.length === 0) return null; // unknown shape → drop (mechanic)

  // 1. Reasoning class — DROP entirely (model chain-of-thought).
  if (REASONING_KINDS.includes(kind)) return null;

  // 2. Handoff — agent-to-agent mechanics — DROP.
  if (HANDOFF_KINDS.includes(kind)) return null;

  // 3. Tool frames — coarsen to a generic label; no name, no args.
  if (TOOL_KINDS.includes(kind)) {
    if (kind === 'tool_result') {
      // Surface a boolean ok flag only (drives a generic "done/failed"
      // affordance) — derive it from common result shapes without leaking.
      const outcome = (evt as { outcome?: unknown }).outcome;
      const ok =
        typeof (evt as { ok?: unknown }).ok === 'boolean'
          ? ((evt as { ok?: boolean }).ok as boolean)
          : outcome && typeof outcome === 'object'
            ? (outcome as { kind?: unknown }).kind === 'ok'
            : true;
      return Object.freeze({
        event: 'tool_result',
        data: { kind: 'tool_result', name: COARSE_KERNEL_TOOL_LABEL, ok },
      });
    }
    return Object.freeze({
      event: 'tool_call',
      data: { kind: 'tool_call', name: COARSE_KERNEL_TOOL_LABEL },
    });
  }

  // 4. Text prose leaf — through the FAIL-CLOSED egress filter.
  if (kind === 'text') {
    const delta =
      typeof (evt as { delta?: unknown }).delta === 'string'
        ? (evt as { delta?: string }).delta
        : typeof (evt as { text?: unknown }).text === 'string'
          ? (evt as { text?: string }).text
          : '';
    return Object.freeze({
      event: 'text',
      data: { kind: 'text', delta: guardText(delta, tenantId) },
    });
  }

  // 5. Citation — emit the render label + target id ONLY, prose-guarded. The
  //    full citation object is NOT forwarded (it can carry model reasoning).
  if (kind === 'citation') {
    const citation = (evt as { citation?: unknown }).citation;
    const cObj = (citation && typeof citation === 'object'
      ? citation
      : {}) as Record<string, unknown>;
    const data: Record<string, unknown> = { kind: 'citation' };
    if (typeof cObj.id === 'string') data.id = cObj.id;
    if (typeof cObj.label === 'string') {
      data.label = guardText(cObj.label, tenantId);
    }
    if (typeof cObj.confidence === 'number') data.confidence = cObj.confidence;
    return Object.freeze({ event: 'citation', data });
  }

  // 6. Error — GENERIC banner; the raw cause is logged server-side by the
  //    caller (the projector never forwards a provider / model / id detail).
  if (kind === 'error') {
    const retryable =
      typeof (evt as { retryable?: unknown }).retryable === 'boolean'
        ? ((evt as { retryable?: boolean }).retryable as boolean)
        : false;
    return Object.freeze({
      event: 'error',
      data: {
        kind: 'error',
        code: 'INTERNAL',
        message: GENERIC_KERNEL_ERROR_MESSAGE,
        retryable,
      },
    });
  }

  // 7. Done / lifecycle — keep the render-safe scalars, STRIP any persona /
  //    agent / model id (provenance.modelId / sensorId / personaId are mechanic).
  if (kind === 'done') {
    const data: Record<string, unknown> = { kind: 'done' };
    if (typeof (evt as { turnId?: unknown }).turnId === 'string') {
      data.turnId = (evt as { turnId?: string }).turnId;
    }
    if (typeof (evt as { totalMs?: unknown }).totalMs === 'number') {
      data.totalMs = (evt as { totalMs?: number }).totalMs;
    }
    return Object.freeze({ event: 'done', data });
  }

  // 8. Artifact — NOT projected here. The structured-artifact path has its own
  //    blessed membrane (`getArtifactEgressMembrane`); a serializer that emits
  //    artifacts must route them through THAT, not coarsen them to text. Drop
  //    here so a serializer cannot accidentally emit a raw artifact via the
  //    text projector.
  if (kind === 'artifact') return null;

  // 9. Anything else — an unknown/mechanic frame — DROP by construction. A new
  //    event kind is safe by default (it is never emitted) until the projector
  //    is taught how to render it safely.
  return null;
}

/**
 * Guard a STREAMING model-prose delta through the FAIL-CLOSED egress filter's
 * fast per-frame path (`guardStream` — no block persistence on the token
 * critical path). A thrown filter yields the generic placeholder, never the raw
 * delta. Empty / non-string spans pass through unchanged.
 */
function guardStreamText(text: unknown, tenantId: string): string {
  if (typeof text !== 'string' || text.length === 0) {
    return typeof text === 'string' ? text : '';
  }
  try {
    return getEgressFilter().guardStream(text, tenantId).text;
  } catch (err) {
    logger.error(
      {
        wiring: 'kernel-event-projector',
        tenantId,
        err: err instanceof Error ? err.message : String(err),
      },
      'guardKernelStream: egress guard threw — failing closed',
    );
    return EGRESS_FAIL_CLOSED;
  }
}

/**
 * STREAMING kernel-event egress chokepoint (CLOSE-G). Wrap a raw
 * `kernel.thinkStream(...)` iterator so EVERY consuming serializer — the jarvis
 * `/stream` SSE surface AND the admin AG-UI pump — sees an egress-SAFE event
 * stream by construction:
 *
 *   - `thought_delta` (model chain-of-thought) → DROPPED. The model's private
 *     scratch-pad NEVER reaches a client (CLAUDE.md IP-egress invariant). The
 *     kernel yields thought deltas VERBATIM before its policy gate runs, and the
 *     redaction only lands in the final non-streaming decision — so the stream
 *     consumer would otherwise see raw CoT (kernel.ts: "the streaming consumer
 *     has already seen raw deltas"). This wrapper closes that gap at the gateway.
 *   - `text_delta` (model prose) → run through the FAIL-CLOSED streaming egress
 *     filter (persona / canary / secret / JWT / cross-tenant strips; fail-closed
 *     to `[redacted]`). The kernel's per-delta text is raw sensor output.
 *   - `turn_start` / `gate_verdict` / `confidence` / `done` → structural frames
 *     carrying no model prose; passed through unchanged (the consumer projects
 *     only their safe scalar fields — thoughtId / kind / persona ids / verdict).
 *
 * The `KernelStreamEvent` union has NO `tool_call` frame (tool calls are
 * consumed inside the kernel, never re-yielded to a stream consumer), so there
 * is no tool surface to coarsen here. This is the streaming sibling of
 * `projectKernelEvent` (which projects the per-frame AgentEvent shape).
 *
 * Generic over the event shape so it composes with BOTH the kernel's
 * `AsyncIterable<KernelStreamEvent>` and the AG-UI pump's structural
 * `KernelLikeEvent` without importing a concrete kernel type. Pure: yields NEW
 * frozen frames for the rewritten `text_delta`, passes others through as-is.
 */
export async function* guardKernelStream<T extends { readonly kind: string }>(
  stream: AsyncIterable<T>,
  tenantId: string,
): AsyncGenerator<T> {
  for await (const ev of stream) {
    // Model chain-of-thought — DROP entirely (never to a client).
    if (ev.kind === 'thought_delta') continue;
    // Model prose — through the FAIL-CLOSED streaming egress filter.
    if (ev.kind === 'text_delta') {
      const raw = (ev as { text?: unknown }).text;
      yield Object.freeze({
        ...ev,
        text: guardStreamText(raw, tenantId),
      }) as T;
      continue;
    }
    // Structural frame (turn_start / gate_verdict / confidence / done) — no
    // model prose; pass through (the consumer emits only safe scalar fields).
    yield ev;
  }
}

/** Test seam — the coarse tool label, exported for assertion. */
export const __KERNEL_PROJECTOR_TEST_LABELS = Object.freeze({
  tool: COARSE_KERNEL_TOOL_LABEL,
  error: GENERIC_KERNEL_ERROR_MESSAGE,
  redacted: EGRESS_FAIL_CLOSED,
});
