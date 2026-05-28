/**
 * Universal provenance helper.
 *
 * Implements principle 4 of the Chat-as-OS Bidirectional Parity
 * Manifesto (Docs/RESEARCH/CHAT_AS_OS_BIDIRECTIONAL_PARITY_SOTA.md):
 *
 *   Every record carries a `provenance` jsonb column —
 *   `{via, actorId, sessionId, requestedAt, turnId?}`.
 *
 * Two callers consume this helper:
 *
 *   - **Form path.** A Hono route handler that processes an explicit
 *     POST from the UI. `buildFormProvenance(c)` reads
 *     `c.get('auth')` and stamps `via: 'form'`.
 *
 *   - **Chat path.** A brain tool whose handler issues an HTTP POST
 *     to the same route. `buildChatProvenance(actor)` stamps
 *     `via: 'chat'`, plus the chat session + turn IDs so the UI
 *     pill can deep-link back to the originating chat turn.
 *
 *   - **Agent-apply path.** A background worker applying a pending
 *     owner-approved action. `buildAgentApplyProvenance(actor)`.
 *
 *   - **API path.** A third-party programmatic caller.
 *     `buildApiProvenance(actor)`.
 *
 * The returned object is shape-stable across all four callers — it
 * MUST round-trip through `provenanceSchema.parse()` so the JSONB
 * column is well-formed.
 *
 * The route handler never trusts the chat path's stamp blindly: if a
 * POST body carries `provenance.via === 'chat'` the route validates
 * that the request came from a privileged internal client (the brain
 * itself) before forwarding it. See
 * `wrapWithProvenance(request, body, c)` for that gate.
 */

import { z } from 'zod';
import type { Context } from 'hono';
import type { AuthContext } from '../routes/hono-auth';

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const VIA = ['chat', 'form', 'agent_apply', 'api', 'legacy', 'unknown'] as const;
export type ProvenanceVia = (typeof VIA)[number];

export const provenanceSchema = z.object({
  via: z.enum(VIA),
  actorId: z.string().min(1).nullable(),
  sessionId: z.string().min(1).nullable().optional(),
  turnId: z.string().min(1).nullable().optional(),
  requestedAt: z.string().min(1),
});

export type Provenance = z.infer<typeof provenanceSchema>;

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

type Clock = () => string;
const defaultClock: Clock = () => new Date().toISOString();

/**
 * Stamp `via: 'form'` provenance from a Hono request context.
 *
 * Reads the authenticated actor from `c.get('auth')`. Returns
 * `actorId: null` if no auth context is bound — defensive default so
 * unauthenticated public endpoints (e.g. marketing newsletter signup)
 * still produce a well-formed provenance object.
 */
export function buildFormProvenance(
  c: Pick<Context, 'get'>,
  options?: { readonly now?: Clock },
): Provenance {
  const now = options?.now ?? defaultClock;
  const auth = safeGetAuth(c);
  return Object.freeze({
    via: 'form',
    actorId: auth?.userId ?? null,
    requestedAt: now(),
  }) satisfies Provenance;
}

/**
 * Stamp `via: 'chat'` provenance for a brain tool handler.
 *
 * Receives the actor envelope plus optional chat session / turn IDs.
 * The brain orchestrator should always pass `sessionId` so the UI
 * pill can deep-link back to the chat session; `turnId` is the
 * specific turn that produced the tool call.
 */
export function buildChatProvenance(
  actor: {
    readonly actorId: string;
    readonly sessionId?: string | null;
    readonly turnId?: string | null;
  },
  options?: { readonly now?: Clock },
): Provenance {
  const now = options?.now ?? defaultClock;
  return Object.freeze({
    via: 'chat',
    actorId: actor.actorId,
    sessionId: actor.sessionId ?? null,
    turnId: actor.turnId ?? null,
    requestedAt: now(),
  }) satisfies Provenance;
}

/**
 * Stamp `via: 'agent_apply'` provenance for an autonomous worker
 * applying a pending owner-approved action (e.g. fx-feed-cron
 * applying a scheduled hedge).
 */
export function buildAgentApplyProvenance(
  actor: { readonly actorId: string },
  options?: { readonly now?: Clock },
): Provenance {
  const now = options?.now ?? defaultClock;
  return Object.freeze({
    via: 'agent_apply',
    actorId: actor.actorId,
    requestedAt: now(),
  }) satisfies Provenance;
}

/**
 * Stamp `via: 'api'` provenance for a third-party programmatic
 * caller (M2M token or partner integration).
 */
export function buildApiProvenance(
  actor: { readonly actorId: string },
  options?: { readonly now?: Clock },
): Provenance {
  const now = options?.now ?? defaultClock;
  return Object.freeze({
    via: 'api',
    actorId: actor.actorId,
    requestedAt: now(),
  }) satisfies Provenance;
}

// ---------------------------------------------------------------------------
// Forward / accept guards
// ---------------------------------------------------------------------------

/**
 * Resolve the provenance for a row about to be inserted.
 *
 *   - If the request body carries a well-formed `provenance` and the
 *     caller is an internal trusted client (brain orchestrator), use
 *     the body's provenance.
 *   - Otherwise stamp `buildFormProvenance(c)` (the safe default).
 *
 * The internal-client gate is opt-in via the `trustedSource`
 * argument; route handlers that already know the request came from
 * a brain tool (e.g. tools using `httpClient` with the internal
 * service token) pass `trustedSource: true`. Public form-POST routes
 * leave it `false` and the provenance defaults to `via: 'form'`,
 * preventing a client from spoofing `via: 'chat'`.
 */
export function resolveProvenance(
  c: Pick<Context, 'get'>,
  body: unknown,
  options?: {
    readonly trustedSource?: boolean;
    readonly now?: Clock;
  },
): Provenance {
  if (options?.trustedSource === true && isProvenanceCarrier(body)) {
    const parsed = provenanceSchema.safeParse(body.provenance);
    if (parsed.success) return parsed.data;
  }
  return buildFormProvenance(c, { ...(options?.now && { now: options.now }) });
}

// ---------------------------------------------------------------------------
// Defaults — used by migrations / backfills / unit tests
// ---------------------------------------------------------------------------

export const LEGACY_PROVENANCE: Provenance = Object.freeze({
  via: 'legacy',
  actorId: null,
  requestedAt: '1970-01-01T00:00:00Z',
}) satisfies Provenance;

export const UNKNOWN_PROVENANCE: Provenance = Object.freeze({
  via: 'unknown',
  actorId: null,
  requestedAt: '1970-01-01T00:00:00Z',
}) satisfies Provenance;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function safeGetAuth(c: Pick<Context, 'get'>): AuthContext | undefined {
  try {
    const v = c.get('auth' as never) as AuthContext | undefined;
    return v ?? undefined;
  } catch {
    return undefined;
  }
}

function isProvenanceCarrier(body: unknown): body is { provenance: unknown } {
  return (
    typeof body === 'object' &&
    body !== null &&
    'provenance' in (body as Record<string, unknown>)
  );
}
