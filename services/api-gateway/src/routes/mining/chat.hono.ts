// @ts-nocheck — Hono v4 streamSSE + status-literal-union widening
// (hono-dev/hono#3891). Brain wire-up runs through the chat
// orchestrator (see `./chat-orchestrator.ts`) — this route is the
// Master Brain SSE entry surface; the orchestrator owns evidence
// resolution, junior dispatch, and mode-to-Master-Brain translation.
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
 *               Supports the owner-web mode switcher via `mode`
 *               (build | strategy | operations | document | finance |
 *               risk | board-investor | compliance).
 *
 *               When ANTHROPIC_API_KEY is set, the real Master Brain
 *               junior dispatches. Otherwise the orchestrator falls
 *               back to a static mode→junior table + a corpus-grounded
 *               mock answer so the demo works without LLM costs.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { streamSSE } from 'hono/streaming';
import pino from 'pino';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { runChatOrchestrator, type ChatMode } from './chat-orchestrator';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info', name: 'mining-chat' });

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

const CHAT_MODES = [
  'build',
  'strategy',
  'operations',
  'document',
  'finance',
  'risk',
  'board-investor',
  'compliance',
] as const satisfies ReadonlyArray<ChatMode>;

const ChatTurnSchema = z.object({
  message: z.string().min(1).max(8000),
  sessionId: z.string().optional(),
  mode: z.enum(CHAT_MODES).default('build'),
  language: z.enum(['sw', 'en']).default('sw'),
});

app.post('/', zValidator('json', ChatTurnSchema), async (c) => {
  const { tenantId, userId } = c.get('auth');
  const db = c.get('db');
  const input = c.req.valid('json');
  return streamSSE(c, async (stream) => {
    try {
      await stream.writeSSE({
        event: 'turn.accepted',
        data: JSON.stringify({
          tenantId,
          userId,
          mode: input.mode,
          language: input.language,
          sessionId: input.sessionId ?? null,
          at: new Date().toISOString(),
        }),
      });

      for await (const evt of runChatOrchestrator({
        tenantId,
        userId,
        mode: input.mode,
        language: input.language,
        message: input.message,
        sessionId: input.sessionId ?? null,
        db,
      })) {
        switch (evt.type) {
          case 'turn_accepted':
            // Already emitted above; the orchestrator yields this for
            // its own state machine — skip the duplicate wire frame.
            break;
          case 'junior_call':
            await stream.writeSSE({
              event: 'junior_call',
              data: JSON.stringify({
                junior: evt.junior,
                intent: evt.intent,
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
            logger.warn({ tenantId, mode: input.mode, err: evt.message }, 'chat orchestrator soft-error');
            await stream.writeSSE({
              event: 'error',
              data: JSON.stringify({ kind: 'orchestrator', message: evt.message, retryable: true }),
            });
            break;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ tenantId, mode: input.mode, err: message }, 'chat stream failed');
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({ kind: 'fatal', message, retryable: false }),
      });
    }
  });
});

export const miningChatRouter = app;
