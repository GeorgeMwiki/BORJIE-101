'use client';

/**
 * inline-action-map — pure translator from an inline-block `onAction`
 * event to the action-bridge dispatch target.
 *
 * The inline-block components (micro_action_card, confirmation_card,
 * data_capture_card, file_request_card) each fire `onAction` with their
 * OWN `{ action, payload }` shape. This module narrows those shapes into
 * the canonical `{ verb, params }` the gateway action-bridge expects —
 * or returns `null` when the event carries no executable verb (e.g. a
 * file upload, a cancel, or an empty action), in which case the caller
 * keeps the legacy text-suggestion fallback.
 *
 * Tab-spawn (`spawn_tab`) and level-select (`level_select`) are NOT
 * handled here — the caller routes those to `onSpawnTab` / `onSuggestion`
 * exactly as before. Keeping this module side-effect-free makes the
 * verb/params wiring unit-testable in isolation.
 */

/** A resolved dispatch target plus which endpoint to hit. */
export interface InlineActionDispatch {
  /** `micro-action` → dispatchMicroAction · `confirm` → confirmAction. */
  readonly channel: 'micro-action' | 'confirm';
  readonly verb: string;
  readonly params: Readonly<Record<string, unknown>>;
}

/** The raw event shape every inline block hands to `onAction`. */
export interface RawInlineActionEvent {
  readonly action: string;
  readonly payload: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Verbs the FE must never route to the action endpoint as a verb. */
const NON_VERB_ACTIONS: ReadonlySet<string> = new Set([
  'spawn_tab',
  'level_select',
  'upload',
  'secondary',
]);

/**
 * confirmation_card.primary → confirm-action. The verb is the card's
 * `actionId`; params are its forwarded payload. Returns `null` when no
 * stable `actionId` was emitted (nothing executable to confirm).
 */
function mapConfirmation(
  payload: Record<string, unknown>,
): InlineActionDispatch | null {
  const verb = typeof payload.actionId === 'string' ? payload.actionId : '';
  if (verb.length === 0) return null;
  const forwarded = isRecord(payload.forwarded) ? payload.forwarded : {};
  return { channel: 'confirm', verb, params: forwarded };
}

/**
 * data_capture_card submit → micro-action. The form fires
 * `{ action: submitAction, payload: { purpose, captured } }`; we flatten
 * the captured fields up alongside `purpose` so a verb like
 * `set_reminder` receives `title` / `dueInDays` directly.
 */
function mapDataCapture(
  action: string,
  payload: Record<string, unknown>,
): InlineActionDispatch | null {
  if (action.length === 0) return null;
  const captured = isRecord(payload.captured) ? payload.captured : {};
  const purpose =
    typeof payload.purpose === 'string' ? { purpose: payload.purpose } : {};
  return {
    channel: 'micro-action',
    verb: action,
    params: { ...purpose, ...captured },
  };
}

/**
 * Narrow one inline-block `onAction` event into a dispatch target.
 *
 * - `micro_action_card`  → `{ action: verb, payload: params }`
 * - `confirmation_card`  → primary only, via `actionId` + `forwarded`
 * - `data_capture_card`  → `submitAction` + flattened captured fields
 * - everything else (upload / spawn_tab / level_select / cancel / empty)
 *   → `null` (caller keeps the text-suggestion fallback)
 */
export function mapInlineActionToDispatch(
  event: RawInlineActionEvent,
): InlineActionDispatch | null {
  const action = typeof event.action === 'string' ? event.action : '';
  if (action.length === 0 || NON_VERB_ACTIONS.has(action)) return null;

  const payload = isRecord(event.payload) ? event.payload : {};

  // confirmation_card emits its decision kind as the `action` and carries
  // the real verb in `payload.actionId`.
  if (action === 'primary') return mapConfirmation(payload);

  // data_capture_card wraps the typed fields under `payload.captured`.
  if (isRecord(payload) && 'captured' in payload) {
    return mapDataCapture(action, payload);
  }

  // micro_action_card (and any block that already emits a flat verb +
  // params payload) → dispatch verbatim.
  return { channel: 'micro-action', verb: action, params: payload };
}
