// Brain wire-up runs through the chat orchestrator
// (see `./chat-orchestrator.ts`) — this route is the Master Brain SSE
// entry surface; the orchestrator owns evidence resolution, junior
// dispatch, and mode-to-Master-Brain translation.
/**
 * /api/v1/mining/chat — Master Brain entry (SSE).
 *
 * Routes:
 *   POST  /     submit a turn; SSE stream of:
 *                 - `turn.accepted`     turn context acknowledgement
 *                 - `junior_call`       one per dispatched junior
 *                 - `message_chunk`     answer text + evidence_ids + confidence
 *                 - `done`              terminator
 *                 - `error`             surfaced when orchestrator throws
 *
 * Migrated to `@hono/zod-openapi` (issue #19). Route def + SSE frame
 * schema live in `./_openapi/route-defs.ts` and `./_openapi/chat-schemas.ts`.
 */

import { OpenAPIHono } from '@hono/zod-openapi';
import { streamSSE } from 'hono/streaming';
import pino from 'pino';
import { authMiddleware } from '../../middleware/hono-auth';
// NoPin: this route streams (SSE) and fans out to the LLM (Master Brain +
// juniors). Pinning a reserved connection across that multi-second stream
// would exhaust the pool, so we inject the db WITHOUT pinning; the
// orchestrator binds tenant context per DB op (its single corpus read runs
// inside `withTenantContext`, the LLM calls stay outside any transaction).
import { databaseMiddlewareNoPin } from '../../middleware/database';
import { runChatOrchestrator } from './chat-orchestrator';
import { chatTurnRoute } from './_openapi/route-defs';
// SEC-4 / INV-H — IP-egress output firewall. This is the SECOND live
// Master-Brain chat SSE surface (the first is brain.hono.ts), so it MUST run
// the SAME FAIL-CLOSED last hop before any model text reaches the client.
// `message_chunk` text (straight from the LLM via runChatOrchestrator) and
// `error.message` are guarded; the structured non-LLM fields (lenses,
// junior/intent/status, evidence_ids, confidence) pass through unchanged.
// DEFAULT-ON; kill-switch `BORJIE_EGRESS_FILTER`. See
// `composition/egress-filter-wiring.ts`.
import { getEgressFilter } from '../../composition/egress-filter-wiring.js';
// INPUT CONTAINMENT (CLOSE-G) — ingress prompt-injection / jailbreak guard on
// the inbound user message BEFORE the orchestrator, mirroring brain.hono /turn.
// CRITICAL → refuse with single-language copy (the orchestrator never sees it);
// lower severities run on the detector-redacted text. DEFAULT-ON; fail-OPEN.
import {
  applyIngressGuard,
  pickIngressGuardLang,
} from '../../composition/ingress-guard-apply.js';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info', name: 'mining-chat' });

/** Fail-closed placeholder substituted when a guard wrapper itself throws. */
const EGRESS_FAIL_CLOSED = '[redacted]';

/**
 * Guard a model-generated text span (final guard, persists block rows) before
 * it egresses on the SSE stream. FAIL-CLOSED: the underlying filter already
 * returns a redacted placeholder on any internal fault, and this wrapper
 * try/catches so a construction fault also fails closed to `[redacted]` rather
 * than leaking the raw model text. Empty / non-string spans pass through.
 */
function guardChatText(text: string, tenantId: string): string {
  if (typeof text !== 'string' || text.length === 0) return text;
  try {
    return getEgressFilter().guardFinal(text, tenantId).text;
  } catch (err) {
    logger.error(
      {
        wiring: 'egress-filter',
        tenantId,
        err: err instanceof Error ? err.message : String(err),
      },
      'mining chat: egress guard threw — failing closed (redacting span)',
    );
    return EGRESS_FAIL_CLOSED;
  }
}

const app = new OpenAPIHono();
app.use('*', authMiddleware);
app.use('*', databaseMiddlewareNoPin);

// SSE streaming handlers don't conform to the discriminated-response type
// `OpenAPIHono` infers from the spec — `streamSSE` returns a `Response`
// with `text/event-stream` regardless of the per-status JSON envelopes
// declared in `chatTurnRoute`. Cast around the response narrowing while
// keeping the spec accurate at the OpenAPI / docs surface.
app.openapi(chatTurnRoute, (async (c) => {  const { tenantId, userId } = c.get('auth');
  const db = c.get('db');
  const input = c.req.valid('json');
  return streamSSE(c, async (stream) => {
    // SSE RESILIENCE (mfr-3) — the orchestrator does real, side-effecting work
    // per yielded event (OpenAI embedding, tenant-scoped corpus read, then
    // either Master-Brain junior fan-out with multiple Claude calls + junior DB
    // writes, OR a full sov.kernel.think() pass). Hono's streamSSE swallows
    // write errors, so without an explicit disconnect hook the for-await loop
    // would keep pulling events (and spending) after the client is gone. Wire
    // the same AbortController pattern brain-teach uses: onAbort flips the
    // signal, and we return early at the top of the drain loop so the async
    // generator unwinds and stops further model/DB work.
    const abort = new AbortController();
    stream.onAbort(() => abort.abort());
    try {
      // INPUT CONTAINMENT (CLOSE-G) — run the blessed ingress guard on the user
      // message BEFORE the orchestrator. CRITICAL prompt-injection / jailbreak →
      // refuse with single-language copy (the orchestrator never sees it); lower
      // severities → run on the detector-redacted text. Fail-OPEN-but-logged.
      const ingress = await applyIngressGuard({
        userText: input.message,
        tenantId,
        userId: userId ?? null,
        lang: pickIngressGuardLang(
          c.req.header('accept-language') ?? input.language,
        ),
      });
      if (ingress.refused) {
        await stream.writeSSE({
          event: 'error',
          data: JSON.stringify({
            kind: 'input_guard_refused',
            message: ingress.refusalMessage,
            retryable: false,
          }),
        });
        await stream.writeSSE({
          event: 'done',
          data: JSON.stringify({ at: new Date().toISOString(), refused: true }),
        });
        return;
      }
      // mfr-3 — thread the disconnect signal into the orchestrator so the
      // upstream generator can cancel in-flight model/junior work, not just
      // stop being drained here. The gateway-side `abort.signal.aborted`
      // early-return below remains the guaranteed floor; this passes the
      // signal as the orchestrator's optional second `options` arg, which
      // forwards it to `sov.kernel.think()/thinkStream()` and the
      // Master-Brain junior calls. See needsAttention for the downstream
      // `runChatOrchestrator` + kernel signatures that must accept + forward
      // it to the provider stream call (`client.messages.stream({ signal })`).
      for await (const evt of runChatOrchestrator(
        {
          tenantId,
          userId,
          language: input.language,
          message: ingress.text,
          sessionId: input.sessionId ?? null,
          db,
        },
        { signal: abort.signal },
      )) {
        // SSE RESILIENCE (mfr-3) — client disconnected: stop pulling further
        // events from the generator so its async-generator cleanup runs and no
        // additional model/DB work is performed for a connection no one reads.
        if (abort.signal.aborted) return;
        switch (evt.type) {
          case 'turn_accepted':
            // The orchestrator classifies the persona lens(es) from the
            // message (there is no user-selected mode) and yields them here
            // so the wire frame can surface the read-only blend.
            await stream.writeSSE({
              event: 'turn.accepted',
              data: JSON.stringify({
                tenantId,
                userId,
                lenses: evt.lenses,
                language: evt.language,
                sessionId: input.sessionId ?? null,
                at: new Date().toISOString(),
              }),
            });
            break;
          case 'junior_call':
            await stream.writeSSE({
              event: 'junior_call',
              data: JSON.stringify({
                junior: evt.junior,
                intent: evt.intent,
                status: evt.status,
                evidence_ids: evt.evidence_ids ?? [],
                confidence: evt.confidence ?? null,
                // SEC-4 — a junior error string is a model/provider span and a
                // classic leak vector; route it through the SAME fail-closed
                // egress guard as message_chunk / error (single chokepoint).
                error:
                  evt.error !== undefined
                    ? guardChatText(evt.error, tenantId)
                    : null,
              }),
            });
            break;
          case 'commitment_state':
            // LIVING-MD felt diff: the reconciliation sweep reaches the
            // conversation. Structured, non-LLM fields (counts, ids) pass
            // through; the human-readable titles are guarded as a leak-safety
            // (they are owner-authored, but the egress chokepoint is absolute).
            await stream.writeSSE({
              event: 'commitment_state',
              data: JSON.stringify({
                counts: evt.counts,
                deferredCount: evt.deferredCount,
                nextDueAtMs: evt.nextDueAtMs,
                becameDue: evt.becameDue.map((b) => ({
                  id: b.id,
                  title: guardChatText(b.title, tenantId),
                  kind: b.kind,
                  sovereign: b.sovereign,
                })),
                at: new Date().toISOString(),
              }),
            });
            break;
          case 'message_chunk':
            await stream.writeSSE({
              event: 'message_chunk',
              data: JSON.stringify({
                // SEC-4 — guard the LLM-generated answer text before egress.
                text: guardChatText(evt.text, tenantId),
                evidence_ids: evt.evidence_ids,
                confidence: evt.confidence,
                done: false,
              }),
            });
            break;
          case 'done':
            await stream.writeSSE({
              event: 'done',
              data: JSON.stringify({ at: new Date().toISOString() }),
            });
            break;
          case 'error':
            logger.warn(
              { tenantId, err: evt.message, source: evt.source },
              'chat orchestrator soft-error',
            );
            await stream.writeSSE({
              event: 'error',
              data: JSON.stringify({
                kind: evt.source ?? 'orchestrator',
                // SEC-4 — error messages are a classic leak vector; guard it.
                message: guardChatText(evt.message, tenantId),
                retryable: evt.source !== 'config',
              }),
            });
            break;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ tenantId, err: message }, 'chat stream failed');
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({
          kind: 'fatal',
          // SEC-4 — guard the error message before egress (leak vector).
          message: guardChatText(message, tenantId),
          retryable: false,
        }),
      });
    }
  });
}) as unknown as Parameters<typeof app.openapi<typeof chatTurnRoute>>[1]);
export const miningChatRouter = app;
