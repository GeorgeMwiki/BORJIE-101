/**
 * Zod-OpenAPI schemas for `/api/v1/mining/chat` — Master Brain SSE
 * entry surface.
 *
 * The actual transport is server-sent-events (text/event-stream). The
 * OpenAPI spec documents:
 *   - the request body shape (turn submission)
 *   - a synthetic JSON shape describing the event-stream frames so
 *     codegen consumers can typecheck their SSE wire parser
 */
import { z } from '@hono/zod-openapi';

export const ChatModeEnum = z
  .enum([
    'build',
    'strategy',
    'operations',
    'document',
    'finance',
    'risk',
    'board-investor',
    'compliance',
  ])
  .openapi('ChatMode');

export const ChatLanguageEnum = z.enum(['sw', 'en']).openapi('ChatLanguage');

export const ChatTurnSchema = z
  .object({
    message: z.string().min(1).max(8000),
    sessionId: z.string().optional(),
    mode: ChatModeEnum.default('build'),
    language: ChatLanguageEnum.default('sw'),
  })
  .openapi('ChatTurnRequest');

export const ChatStreamFrameSchema = z
  .discriminatedUnion('event', [
    z.object({
      event: z.literal('turn.accepted'),
      data: z.object({
        tenantId: z.string(),
        userId: z.string(),
        mode: ChatModeEnum,
        language: ChatLanguageEnum,
        sessionId: z.string().nullable(),
        at: z.string().datetime(),
      }),
    }),
    z.object({
      event: z.literal('junior_call'),
      data: z.object({
        junior: z.string(),
        intent: z.string(),
        status: z.string(),
        evidence_ids: z.array(z.string()),
        confidence: z.number().nullable(),
        error: z.string().nullable(),
      }),
    }),
    z.object({
      event: z.literal('message_chunk'),
      data: z.object({
        text: z.string(),
        evidence_ids: z.array(z.string()),
        confidence: z.number().nullable(),
        done: z.boolean(),
      }),
    }),
    z.object({
      event: z.literal('done'),
      data: z.object({ at: z.string().datetime() }),
    }),
    z.object({
      event: z.literal('error'),
      data: z.object({
        kind: z.string(),
        message: z.string(),
        retryable: z.boolean(),
      }),
    }),
  ])
  .openapi('ChatStreamFrame');
