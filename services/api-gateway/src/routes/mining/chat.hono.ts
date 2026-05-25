// @ts-nocheck — Hono v4 streamSSE + status-literal-union widening
// (hono-dev/hono#3891). Brain wire-up runs through the central
// orchestrator — this route is the Master Brain entry surface; the
// orchestrator owns evidence resolution, junior dispatch, mode switch.
/**
 * /api/v1/mining/chat — Master Brain entry (SSE).
 *
 * Routes:
 *   POST  /     submit a turn; SSE stream of {evidence_ids,
 *               message_chunks, junior_calls}. Supports the owner-web
 *               mode switcher via `mode` (advisor | operator | board).
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { streamSSE } from 'hono/streaming';
import { authMiddleware } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', databaseMiddleware);

const ChatTurnSchema = z.object({
  message: z.string().min(1).max(8000),
  threadId: z.string().optional(),
  mode: z.enum(['advisor', 'operator', 'board', 'analyst', 'auditor']).default('advisor'),
  language: z.enum(['sw', 'en']).default('sw'),
  evidenceHints: z.array(z.string()).optional(),
});

app.post('/', zValidator('json', ChatTurnSchema), async (c) => {
  const { tenantId, userId } = c.get('auth');
  const input = c.req.valid('json');
  return streamSSE(c, async (stream) => {
    try {
      // Surface the turn context first so the client can render
      // "received" affordance immediately.
      await stream.writeSSE({
        event: 'turn.accepted',
        data: JSON.stringify({
          tenantId,
          userId,
          mode: input.mode,
          language: input.language,
          threadId: input.threadId ?? null,
          at: new Date().toISOString(),
        }),
      });
      // Evidence pre-flight — orchestrator will resolve LMBM + corpus
      // ids; emit a placeholder for now so the client can wire its
      // citation panel against a stable contract.
      await stream.writeSSE({
        event: 'evidence_ids',
        data: JSON.stringify({ ids: input.evidenceHints ?? [], source: 'pre-flight' }),
      });
      // Stream a single message chunk — real orchestrator will yield
      // many; the wire-format is stable.
      await stream.writeSSE({
        event: 'message_chunks',
        data: JSON.stringify({
          chunk: 'orchestrator-pending',
          done: false,
        }),
      });
      // No junior dispatch in this stub; emit empty array so client
      // unconditionally consumes the field.
      await stream.writeSSE({
        event: 'junior_calls',
        data: JSON.stringify({ calls: [] }),
      });
      await stream.writeSSE({
        event: 'done',
        data: JSON.stringify({ at: new Date().toISOString() }),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await stream.writeSSE({
        event: 'error',
        data: JSON.stringify({ kind: 'error', message, retryable: false }),
      });
    }
  });
});

export const miningChatRouter = app;
