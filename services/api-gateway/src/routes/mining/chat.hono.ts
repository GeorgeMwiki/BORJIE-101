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

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info', name: 'mining-chat' });

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
    try {
      for await (const evt of runChatOrchestrator({
        tenantId,
        userId,
        language: input.language,
        message: input.message,
        sessionId: input.sessionId ?? null,
        db,
      })) {
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
                error: evt.error ?? null,
              }),
            });
            break;
          case 'message_chunk':
            await stream.writeSSE({
              event: 'message_chunk',
              data: JSON.stringify({
                text: evt.text,
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
                message: evt.message,
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
        data: JSON.stringify({ kind: 'fatal', message, retryable: false }),
      });
    }
  });
}) as unknown as Parameters<typeof app.openapi<typeof chatTurnRoute>>[1]);
export const miningChatRouter = app;
