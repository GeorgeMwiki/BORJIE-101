/**
 * @file Host-action dispatch helpers (H12 contract).
 *
 * Many AG-UI primitives carry LLM-emitted action payloads inside their
 * schemas:
 *
 *   - signature-pad     `onSubmitAction: { kind: 'tool', payload }`
 *   - notification-toast `actionPayload: Record<string, unknown>`
 *   - tree              `onClickAction: { kind, payload }`
 *   - prompt-suggestions `suggestions[].prompt + .kind`
 *   - chat-embed        per-message payloads
 *   - slider-input      `onChangeAction: { kind, payload }`
 *
 * These payloads are FIRED INTO HOST EVENT LISTENERS via CustomEvents:
 *   - `genui:signature-submit`
 *   - `genui:notification-toast-action`
 *   - `genui:tree-action`
 *   - `genui:prompt-suggestion`
 *   - `genui:chat-embed-message`
 *   - `genui:slider-change`
 *
 * If the host wires "kind === 'tool' → dispatch tool by name in payload"
 * naively, an LLM can fire ANY tool by emitting any of these primitives.
 * The substrate cannot enforce host-side allowlisting at runtime —
 * but it can ship a HELPER that the host MUST use, with allowlist baked
 * in. That helper lives here.
 *
 * Host portals SHOULD:
 *   1. Define a strict allowlist of tool names that genui-emitted
 *      events are permitted to call.
 *   2. Wrap their `window.addEventListener` calls with
 *      `createGenUiActionDispatcher` which compares `payload.tool` (or
 *      similar field) against the allowlist before invoking.
 *   3. Treat ANY action that fails allowlist as a hostile event —
 *      log + drop, do not invoke.
 *
 * The host portal is the AUTHORITATIVE security boundary; this helper
 * makes the boundary cheap and obvious to implement.
 */

/**
 * The seven LLM-driven action CustomEvent names emitted by the genui
 * primitives. Listed here so the host can subscribe to all of them
 * uniformly via `GENUI_ACTION_EVENTS`.
 */
export const GENUI_ACTION_EVENTS = [
  'genui:signature-submit',
  'genui:notification-toast-action',
  'genui:tree-action',
  'genui:prompt-suggestion',
  'genui:chat-embed-message',
  'genui:slider-change',
  'genui:unknown-kind',
] as const;

export type GenUiActionEventName = (typeof GENUI_ACTION_EVENTS)[number];

/**
 * The shape of an LLM-emitted action payload. The brain MAY emit any
 * `kind`, but the host MUST gate on a known set.
 */
export interface GenUiActionPayload {
  readonly kind: string;
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface GenUiActionDispatcherOptions {
  /**
   * Allowlist of tool names the host permits LLM-emitted events to
   * invoke. The dispatcher rejects any action whose `payload.tool`
   * (or analogous identifier) is not in this set.
   *
   * Empty set = "no LLM-driven tools are permitted" (the safest default
   * for environments where the host wants to inspect every action
   * manually).
   */
  readonly allowedTools: ReadonlySet<string>;

  /**
   * Allowlist of `action.kind` values. Defaults to:
   *   `['message', 'tool', 'navigate', 'submit']`
   * (the union of every primitive's currently-emitted kinds).
   */
  readonly allowedKinds?: ReadonlySet<string>;

  /**
   * Called when an action is rejected. The host can route this to its
   * telemetry pipeline. Defaults to a no-op.
   */
  readonly onReject?: (reason: string, detail: unknown) => void;

  /**
   * Called when an action passes the allowlist. The host invokes the
   * actual tool / navigates / etc. here. The dispatcher does NOT do
   * any side-effects — that's the host's job.
   */
  readonly onAllow: (action: GenUiActionPayload, detail: unknown) => void;
}

const DEFAULT_ALLOWED_KINDS: ReadonlySet<string> = new Set([
  'message',
  'tool',
  'navigate',
  'submit',
]);

/**
 * Build a `(event: Event) => void` handler that the host registers on
 * EVERY `genui:*` event. The handler:
 *
 *   1. Reads `event.detail` as the LLM-emitted action.
 *   2. Validates the `kind` is in `allowedKinds`.
 *   3. If `kind === 'tool'`, validates `payload.tool` is in `allowedTools`.
 *   4. If allow: calls `onAllow`. If reject: calls `onReject`.
 *
 * Example wiring inside the host:
 *
 * ```ts
 * const dispatch = createGenUiActionDispatcher({
 *   allowedTools: new Set([
 *     'tenant.send_reminder',
 *     'lease.draft_renewal',
 *   ]),
 *   onAllow: (action) => fireTool(action.payload.tool, action.payload),
 *   onReject: (reason, detail) => telemetry.record('genui.action.rejected', { reason, detail }),
 * });
 *
 * for (const evt of GENUI_ACTION_EVENTS) {
 *   window.addEventListener(evt, dispatch);
 * }
 * ```
 */
export function createGenUiActionDispatcher(
  options: GenUiActionDispatcherOptions,
): (event: Event) => void {
  const allowedKinds = options.allowedKinds ?? DEFAULT_ALLOWED_KINDS;
  const onReject =
    options.onReject ?? (() => { /* no-op */ });

  return function dispatch(event: Event): void {
    const detail = (event as CustomEvent).detail;
    if (!isActionPayload(detail)) {
      onReject('detail is not a {kind, payload} object', detail);
      return;
    }
    const action = detail;

    if (!allowedKinds.has(action.kind)) {
      onReject(`action.kind "${action.kind}" is not in allowedKinds`, detail);
      return;
    }

    if (action.kind === 'tool') {
      const toolName = readToolName(action.payload);
      if (typeof toolName !== 'string') {
        onReject('tool action without `tool` field in payload', detail);
        return;
      }
      if (!options.allowedTools.has(toolName)) {
        onReject(
          `tool "${toolName}" is not in the host allowlist`,
          detail,
        );
        return;
      }
    }

    options.onAllow(action, detail);
  };
}

function isActionPayload(v: unknown): v is GenUiActionPayload {
  if (v === null || typeof v !== 'object') return false;
  const obj = v as Record<string, unknown>;
  return (
    typeof obj.kind === 'string' &&
    typeof obj.payload === 'object' &&
    obj.payload !== null
  );
}

function readToolName(payload: Readonly<Record<string, unknown>>): unknown {
  // Most primitives use `payload.tool`. Some emit `payload.toolId` or
  // `payload.name`. We check the three common spellings and let the host
  // surface anything else via `onReject`.
  return payload.tool ?? payload.toolId ?? payload.name;
}
