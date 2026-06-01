'use client';

/**
 * Home-chat micro-action bridge.
 *
 * The owner cockpit's inline-first chat emits ACTION-bearing blocks
 * (micro_action_card, confirmation_card, …). Tapping one used to be
 * downgraded to a plain `__inline_action:<verb>` text message the brain
 * merely saw as a string. This module is the real execution path: it
 * POSTs the structured `{ verb, params, rationale? }` to the gateway's
 * action-bridge so SAFE verbs (set_reminder, snooze_reminder, …)
 * actually run server-side.
 *
 * Two endpoints, identical envelope:
 *   POST /api/v1/owner/chat/micro-action  body { verb, params, rationale? }
 *   POST /api/v1/owner/chat/confirm-action body { verb, params }
 *     → { executed, authorized, reason?, result? }   (after apiRequest
 *        unwraps the gateway's `{ success, data }` wrapper)
 *
 * Both go through the shared `apiRequest` client (forwards the Supabase
 * bearer + session cookie, unwraps `{ success, data }`). The response is
 * zod-parsed here (defence in depth) so a wire-format drift surfaces as
 * a clean error the caller can fall back from — never a runtime crash
 * inside the chat bubble.
 *
 * Graceful by construction: an unknown / unauthorized verb returns
 * `{ executed: false, authorized?, reason }`. The caller renders that as
 * a "needs confirmation" / declined note and may fall back to the text
 * suggestion so the brain can still respond. No path throws to the UI
 * except a genuine network/parse failure, which the caller catches.
 */

import { z } from 'zod';
import { apiRequest } from '@/lib/api-client';

/** Params object forwarded verbatim to the matching brain tool. */
export type MicroActionParams = Readonly<Record<string, unknown>>;

export interface MicroActionRequest {
  readonly verb: string;
  readonly params: MicroActionParams;
  readonly rationale?: string;
}

export interface ConfirmActionRequest {
  readonly verb: string;
  readonly params: MicroActionParams;
}

// The action-bridge response. `executed` and `authorized` are the only
// guaranteed booleans; `reason` explains a decline; `result` is the
// tool's own payload (shape varies by verb) used to render the
// confirmation bubble. Unknown extra keys are ignored by zod's default
// strip mode so the parser never rejects a richer future payload.
const microActionResultSchema = z.object({
  executed: z.boolean(),
  authorized: z.boolean().default(false),
  reason: z.string().optional(),
  result: z.unknown().optional(),
});

export type MicroActionResult = z.infer<typeof microActionResultSchema>;

async function postAction(
  path: string,
  body: MicroActionRequest | ConfirmActionRequest,
): Promise<MicroActionResult> {
  try {
    const raw = await apiRequest<unknown>(path, { method: 'POST', body });
    return microActionResultSchema.parse(raw);
  } catch (error) {
    // A 401/403/5xx, a network drop, or a wire-format drift. Surface a
    // graceful unauthorized/undecided result so the chat can fall back
    // to the text suggestion instead of crashing the bubble.
    const reason = error instanceof Error ? error.message : 'request failed';
    return { executed: false, authorized: false, reason };
  }
}

/**
 * Execute a one-tap / submit micro-action. SAFE verbs run immediately;
 * unknown/unauthorized verbs resolve to `{ executed:false, … }` rather
 * than throwing, so the caller can degrade gracefully.
 */
export function dispatchMicroAction(
  req: MicroActionRequest,
): Promise<MicroActionResult> {
  return postAction('/api/v1/owner/chat/micro-action', req);
}

/**
 * Execute a confirmation-card decision. Same envelope as
 * {@link dispatchMicroAction}; the verb is the card's `actionId` and the
 * params are its forwarded payload.
 */
export function confirmAction(
  req: ConfirmActionRequest,
): Promise<MicroActionResult> {
  return postAction('/api/v1/owner/chat/confirm-action', req);
}
