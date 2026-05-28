/**
 * Brain-tool provenance injector.
 *
 * Every WRITE brain tool wraps its POST body with this helper. The
 * downstream HTTP route (which already does the `db.insert`) reads
 * `body.provenance` and forwards it to the insert call via
 * `resolveProvenance(c, body, { trustedSource: true })` (see
 * `services/api-gateway/src/services/provenance.ts`).
 *
 * Centralising the wrapping here means:
 *
 *   1. There is exactly one place to fix if the provenance envelope
 *      shape ever changes (it MUST be shape-stable with the form
 *      path's `buildFormProvenance`).
 *   2. Tool authors cannot accidentally forget the `via: 'chat'`
 *      marker — they pass their handler context, the helper does
 *      the rest.
 *   3. The test in
 *      `services/api-gateway/__tests__/parity/brain-tool-provenance.test.ts`
 *      walks every descriptor with `isWrite: true` and asserts the
 *      tool's POST body carries provenance with `via: 'chat'`.
 *
 * The injected provenance object is structurally identical to what
 * `buildChatProvenance` in `services/api-gateway/src/services/provenance.ts`
 * produces (same fields, same encoding); we re-export `Provenance`
 * here as the canonical type so handlers don't have to import from
 * two places.
 */

import {
  buildChatProvenance,
  type Provenance,
} from '../../services/provenance';
import type { PersonaToolHandlerContext } from './types';

export type { Provenance } from '../../services/provenance';

/**
 * Wrap a POST body with chat provenance derived from the tool's
 * handler context.
 *
 * The actor is `ctx.actorId`; the session is `ctx.chatSessionId`
 * (threaded from `ToolExecutionContext.threadId`); the turn is
 * `ctx.chatTurnId` if the gate adapter exposes one.
 *
 * Returns a NEW object — never mutates the caller's body
 * (`coding-style.md` immutability rule).
 */
export function withChatProvenance<TBody extends Record<string, unknown>>(
  body: TBody,
  ctx: Pick<PersonaToolHandlerContext, 'actorId' | 'chatSessionId' | 'chatTurnId'>,
  options?: { readonly now?: () => string },
): TBody & { readonly provenance: Provenance } {
  const provenance = buildChatProvenance(
    {
      actorId: ctx.actorId,
      sessionId: ctx.chatSessionId ?? null,
      turnId: ctx.chatTurnId ?? null,
    },
    options,
  );
  return Object.freeze({ ...body, provenance }) as TBody & {
    readonly provenance: Provenance;
  };
}
