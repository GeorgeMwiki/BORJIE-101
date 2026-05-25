/**
 * AG-UI Protocol — typed event surface emitted by the Borjie
 * brain-↔UI wire.
 *
 * Source of truth: https://www.copilotkit.ai/ag-ui (CopilotKit /
 * ag-ui-protocol). This module deliberately implements the
 * minimal-but-correct subset Borjie needs today rather than
 * pulling `@ag-ui/core` — the spec is small and shipping the types
 * in-tree avoids a third-party dep that is still pre-1.0 and not
 * published under a stable name we can rely on yet.
 *
 * Event ordering contract (a single RUN):
 *   1. RUN_STARTED                              (exactly once)
 *   2. zero-or-more interleaved:
 *        TEXT_MESSAGE_START → CONTENT* → END   (one per message)
 *        TOOL_CALL_START    → ARGS*    → END   (per call)
 *        TOOL_RESULT                           (per call, after END)
 *        STATE_DELTA | STATE_SNAPSHOT
 *   3. RUN_FINISHED OR RUN_ERROR                (exactly one terminal)
 *
 * All identifiers (runId, messageId, toolCallId) MUST be UUIDv7 so
 * they sort lexicographically by creation time — this is the join key
 * the audit-trail and parity dashboards depend on.
 *
 * AG-UI UI parts (`AgUiUiPart`) are the contract that C3's generative
 * UI primitives consume — adding a new kind here requires a matching
 * client renderer.
 */

// ─────────────────────────────────────────────────────────────────────
// JSON-Patch (RFC 6902) — minimal shape used by STATE_DELTA. Kept in
// AG-UI scope so the type tree is self-contained.
// ─────────────────────────────────────────────────────────────────────

export type JsonPatchOp = 'add' | 'remove' | 'replace' | 'move' | 'copy' | 'test';

export interface JsonPatch {
  readonly op: JsonPatchOp;
  readonly path: string;
  readonly value?: unknown;
  readonly from?: string;
}

// ─────────────────────────────────────────────────────────────────────
// Generative-UI primitives — the typed contract C3 implements client-
// side. Server-side our job is to construct these (never raw JSX) and
// hand them to TOOL_RESULT.uiPart.
// ─────────────────────────────────────────────────────────────────────

export interface ColumnDef {
  readonly key: string;
  readonly header: string;
  readonly kind?: 'string' | 'number' | 'currency' | 'percent' | 'date' | 'badge';
  readonly width?: number;
}

export interface KpiTile {
  readonly id: string;
  readonly label: string;
  readonly value: string | number;
  readonly delta?: { readonly value: number; readonly direction: 'up' | 'down' | 'flat' };
  readonly tone?: 'neutral' | 'positive' | 'warning' | 'critical';
}

/**
 * Subset of JSON-Schema we expose to the form-engine — we accept any
 * valid JSON-Schema object so callers can pass the output of
 * `zod-to-json-schema` directly.
 */
export type JsonSchema = Record<string, unknown>;

export interface WorkflowStep {
  readonly id: string;
  readonly label: string;
  readonly status: 'pending' | 'in-progress' | 'complete' | 'error' | 'skipped';
}

export interface TimelineEvent {
  readonly id: string;
  readonly at: string;
  readonly title: string;
  readonly detail?: string;
  readonly tone?: 'info' | 'warn' | 'critical' | 'success';
}

export interface MapMarker {
  readonly id: string;
  readonly lat: number;
  readonly lng: number;
  readonly label?: string;
  readonly tone?: 'info' | 'warn' | 'critical' | 'success';
}

export interface CalendarEvent {
  readonly id: string;
  readonly start: string;
  readonly end?: string;
  readonly title: string;
  readonly category?: string;
}

export type AgUiUiPart =
  | { readonly kind: 'chart-vega'; readonly spec: unknown; readonly data: ReadonlyArray<unknown> }
  | { readonly kind: 'data-table'; readonly columns: ReadonlyArray<ColumnDef>; readonly rows: ReadonlyArray<unknown> }
  | { readonly kind: 'kpi-grid'; readonly tiles: ReadonlyArray<KpiTile> }
  | {
      readonly kind: 'prefill-form';
      readonly schema: JsonSchema;
      readonly values: Readonly<Record<string, unknown>>;
      readonly diffMode?: boolean;
    }
  | {
      readonly kind: 'approval';
      readonly action: string;
      readonly payload: unknown;
      readonly checklist: ReadonlyArray<string>;
    }
  | { readonly kind: 'workflow'; readonly steps: ReadonlyArray<WorkflowStep>; readonly currentIndex: number }
  | { readonly kind: 'timeline'; readonly events: ReadonlyArray<TimelineEvent> }
  | { readonly kind: 'map'; readonly markers: ReadonlyArray<MapMarker> }
  | { readonly kind: 'calendar'; readonly events: ReadonlyArray<CalendarEvent> }
  | {
      readonly kind: 'file-preview';
      readonly url: string;
      readonly mimeType: string;
      readonly name: string;
    };

export const AG_UI_UI_PART_KINDS = [
  'chart-vega',
  'data-table',
  'kpi-grid',
  'prefill-form',
  'approval',
  'workflow',
  'timeline',
  'map',
  'calendar',
  'file-preview',
] as const;

export type AgUiUiPartKind = (typeof AG_UI_UI_PART_KINDS)[number];

// ─────────────────────────────────────────────────────────────────────
// AG-UI event union — every event a brain-↔UI run can produce.
// ─────────────────────────────────────────────────────────────────────

export interface AgUiUsage {
  readonly promptTokens: number;
  readonly completionTokens: number;
}

export type AgUiEvent =
  | {
      readonly type: 'RUN_STARTED';
      readonly threadId: string;
      readonly runId: string;
      readonly timestamp: number;
    }
  | { readonly type: 'TEXT_MESSAGE_START'; readonly messageId: string; readonly role: 'assistant' }
  | { readonly type: 'TEXT_MESSAGE_CONTENT'; readonly messageId: string; readonly delta: string }
  | { readonly type: 'TEXT_MESSAGE_END'; readonly messageId: string }
  | { readonly type: 'TOOL_CALL_START'; readonly toolCallId: string; readonly toolName: string }
  | { readonly type: 'TOOL_CALL_ARGS'; readonly toolCallId: string; readonly delta: string }
  | { readonly type: 'TOOL_CALL_END'; readonly toolCallId: string }
  | {
      readonly type: 'TOOL_RESULT';
      readonly toolCallId: string;
      readonly result: unknown;
      readonly uiPart?: AgUiUiPart;
    }
  | { readonly type: 'STATE_DELTA'; readonly patch: ReadonlyArray<JsonPatch> }
  | { readonly type: 'STATE_SNAPSHOT'; readonly state: unknown }
  | { readonly type: 'RUN_FINISHED'; readonly runId: string; readonly usage?: AgUiUsage }
  | { readonly type: 'RUN_ERROR'; readonly runId: string; readonly error: string };

export const AG_UI_EVENT_TYPES = [
  'RUN_STARTED',
  'TEXT_MESSAGE_START',
  'TEXT_MESSAGE_CONTENT',
  'TEXT_MESSAGE_END',
  'TOOL_CALL_START',
  'TOOL_CALL_ARGS',
  'TOOL_CALL_END',
  'TOOL_RESULT',
  'STATE_DELTA',
  'STATE_SNAPSHOT',
  'RUN_FINISHED',
  'RUN_ERROR',
] as const;

export type AgUiEventType = (typeof AG_UI_EVENT_TYPES)[number];

/** Terminal events that close a run. Heartbeat MUST stop after one is emitted. */
export const AG_UI_TERMINAL_EVENT_TYPES = ['RUN_FINISHED', 'RUN_ERROR'] as const;

export type AgUiTerminalEventType = (typeof AG_UI_TERMINAL_EVENT_TYPES)[number];

// ─────────────────────────────────────────────────────────────────────
// Structural validator (cheap, branchless, no runtime deps). The
// emitter calls this on every `emit(...)` so malformed events never
// reach the wire — a defensive layer above the TS compiler so JS
// callers (e.g. test stubs, future Python bridge) cannot poison the
// stream.
// ─────────────────────────────────────────────────────────────────────

export function isAgUiEventType(value: unknown): value is AgUiEventType {
  return (
    typeof value === 'string' &&
    (AG_UI_EVENT_TYPES as ReadonlyArray<string>).includes(value)
  );
}

export function isTerminalAgUiEvent(event: AgUiEvent): boolean {
  return (
    event.type === 'RUN_FINISHED' || event.type === 'RUN_ERROR'
  );
}

/**
 * True iff `event` is well-formed per the AG-UI spec.
 * Returns a (boolean, reason) tuple so the emitter can record the
 * rejection cause to OTel without losing the malformed payload.
 */
export function validateAgUiEvent(
  event: unknown,
): { readonly ok: true } | { readonly ok: false; readonly reason: string } {
  if (event === null || typeof event !== 'object') {
    return { ok: false, reason: 'event-not-object' };
  }
  const obj = event as { type?: unknown };
  if (!isAgUiEventType(obj.type)) {
    return { ok: false, reason: 'unknown-event-type' };
  }
  const e = obj as AgUiEvent;
  switch (e.type) {
    case 'RUN_STARTED':
      if (typeof e.threadId !== 'string' || e.threadId.length === 0) {
        return { ok: false, reason: 'run-started-missing-threadId' };
      }
      if (typeof e.runId !== 'string' || e.runId.length === 0) {
        return { ok: false, reason: 'run-started-missing-runId' };
      }
      if (typeof e.timestamp !== 'number') {
        return { ok: false, reason: 'run-started-missing-timestamp' };
      }
      return { ok: true };
    case 'TEXT_MESSAGE_START':
      if (typeof e.messageId !== 'string' || e.messageId.length === 0) {
        return { ok: false, reason: 'text-start-missing-messageId' };
      }
      if (e.role !== 'assistant') {
        return { ok: false, reason: 'text-start-invalid-role' };
      }
      return { ok: true };
    case 'TEXT_MESSAGE_CONTENT':
      if (typeof e.messageId !== 'string' || typeof e.delta !== 'string') {
        return { ok: false, reason: 'text-content-malformed' };
      }
      return { ok: true };
    case 'TEXT_MESSAGE_END':
      if (typeof e.messageId !== 'string') {
        return { ok: false, reason: 'text-end-missing-messageId' };
      }
      return { ok: true };
    case 'TOOL_CALL_START':
      if (typeof e.toolCallId !== 'string' || e.toolCallId.length === 0) {
        return { ok: false, reason: 'tool-start-missing-toolCallId' };
      }
      if (typeof e.toolName !== 'string' || e.toolName.length === 0) {
        return { ok: false, reason: 'tool-start-missing-toolName' };
      }
      return { ok: true };
    case 'TOOL_CALL_ARGS':
      if (typeof e.toolCallId !== 'string' || typeof e.delta !== 'string') {
        return { ok: false, reason: 'tool-args-malformed' };
      }
      return { ok: true };
    case 'TOOL_CALL_END':
      if (typeof e.toolCallId !== 'string') {
        return { ok: false, reason: 'tool-end-missing-toolCallId' };
      }
      return { ok: true };
    case 'TOOL_RESULT':
      if (typeof e.toolCallId !== 'string') {
        return { ok: false, reason: 'tool-result-missing-toolCallId' };
      }
      return { ok: true };
    case 'STATE_DELTA':
      if (!Array.isArray(e.patch)) {
        return { ok: false, reason: 'state-delta-patch-not-array' };
      }
      return { ok: true };
    case 'STATE_SNAPSHOT':
      return { ok: true };
    case 'RUN_FINISHED':
      if (typeof e.runId !== 'string' || e.runId.length === 0) {
        return { ok: false, reason: 'run-finished-missing-runId' };
      }
      return { ok: true };
    case 'RUN_ERROR':
      if (typeof e.runId !== 'string' || e.runId.length === 0) {
        return { ok: false, reason: 'run-error-missing-runId' };
      }
      if (typeof e.error !== 'string') {
        return { ok: false, reason: 'run-error-missing-error' };
      }
      return { ok: true };
  }
  // Exhaustive default — typescript will already have rejected.
  return { ok: false, reason: 'unhandled-event-shape' };
}
