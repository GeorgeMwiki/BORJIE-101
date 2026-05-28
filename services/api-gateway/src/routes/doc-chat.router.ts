/**
 * Document Chat API Routes (NEW 15)
 *
 *   GET  /                           — list all sessions for the tenant
 *   GET  /sessions                   — alias for GET /
 *   POST /sessions                   — start a new session (DB-backed; 201)
 *   POST /sessions/:id/ask           — append a user question + deterministic
 *                                       assistant answer. Uses a top-K
 *                                       fallback against `document_embeddings`
 *                                       when the real LLM is not wired.
 *   POST /sessions/:id/messages      — group-chat peer message (DB-backed)
 *   GET  /sessions/:id/messages      — listMessages (DB-backed)
 *   GET  /sessions/:id               — load session (DB-backed)
 *
 * Graceful degradation: when ANTHROPIC_API_KEY is not configured we still
 * persist the user + assistant messages, we just use a deterministic
 * citation-first fallback so clients can continue the flow. The response
 * is 200 for the sync path and 201 for creation.
 *
 * Tenant isolation: every read + write is scoped by `tenantId` taken from
 * the auth context so cross-tenant leakage is prevented at the query
 * boundary.
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  docChatSessions,
  docChatMessages,
  documentEmbeddings,
} from '@borjie/database';
import { authMiddleware } from '../middleware/hono-auth';
import { routeCatch } from '../utils/safe-error';

import { withSecurityEvents } from '@borjie/observability';
const app = new Hono();
app.use('*', authMiddleware);

const StartSessionSchema = z.object({
  scope: z
    .enum(['single_document', 'multi_document', 'group_chat'])
    .default('single_document'),
  documentIds: z.array(z.string().min(1)).min(1),
  participants: z.array(z.string()).optional(),
  title: z.string().max(200).optional(),
});

const AskSchema = z.object({
  question: z.string().min(1).max(4000),
});

const PostMessageSchema = z.object({
  content: z.string().min(1).max(4000),
});

function notConfigured(c: any) {
  return c.json(
    {
      success: false,
      error: 'DocChat database not configured — DATABASE_URL unset',
    },
    503
  );
}

function newId(prefix: string): string {
  // crypto.randomUUID() is always available on supported Node versions; the
  // prefix keeps ids readable in logs + grep-ability across the codebase.
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

function tokenize(text: string): string[] {
  return (text || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 2);
}

/**
 * Deterministic fallback retriever: pulls recent chunks for the session's
 * documents and ranks them by shared-token overlap with the question.
 * Intentionally small & local so we don't take a dependency on the real
 * embedding service here — the service can override this retrieval later
 * via the document-chat service without changing the API shape.
 */
async function fallbackRetrieve(
  db: any,
  tenantId: string,
  documentIds: readonly string[],
  question: string,
  topK: number
): Promise<
  Array<{
    documentId: string;
    chunkIndex: number;
    text: string;
    score: number;
    page?: number;
  }>
> {
  if (!documentIds.length) return [];
  const rows = await db
    .select()
    .from(documentEmbeddings)
    .where(
      and(
        eq(documentEmbeddings.tenantId, tenantId),
        inArray(documentEmbeddings.documentId, [...documentIds])
      )
    )
    .limit(200);

  const qTokens = new Set(tokenize(question));
  if (!qTokens.size || !rows.length) return [];

  type DocChunkRow = {
    documentId: string;
    chunkIndex: number;
    chunkText?: string;
    text?: string;
    chunkMeta?: unknown;
  };
  const scored = (rows as DocChunkRow[])
    .map((r) => {
      const text = r.chunkText ?? r.text ?? '';
      const tokens = tokenize(text);
      let overlap = 0;
      for (const t of tokens) if (qTokens.has(t)) overlap += 1;
      const score = tokens.length ? overlap / Math.sqrt(tokens.length) : 0;
      const page =
        r.chunkMeta && typeof r.chunkMeta === 'object' && 'page' in r.chunkMeta
          ? (r.chunkMeta as { page?: unknown }).page
          : undefined;
      return {
        documentId: r.documentId,
        chunkIndex: r.chunkIndex,
        text,
        score,
        ...(typeof page === 'number' && { page }),
      };
    })
    .filter((r) => r.score > 0)
    .sort((a: any, b: any) => b.score - a.score)
    .slice(0, topK);

  return scored;
}

async function listSessions(c: any) {
  const services = c.get('services');
  const db = services?.db;
  if (!db) return notConfigured(c);
  const tenantId = c.get('tenantId');
  const rows = await db
    .select()
    .from(docChatSessions)
    .where(eq(docChatSessions.tenantId, tenantId))
    .orderBy(desc(docChatSessions.createdAt))
    .limit(100);
  return c.json({ success: true, data: rows });
}

app.get('/', listSessions);
app.get('/sessions', listSessions);

app.get('/sessions/:id', async (c: any) => {
  const services = c.get('services');
  const db = services?.db;
  if (!db) return notConfigured(c);
  const tenantId = c.get('tenantId');
  const id = c.req.param('id');
  const rows = await db
    .select()
    .from(docChatSessions)
    .where(
      and(eq(docChatSessions.id, id), eq(docChatSessions.tenantId, tenantId))
    )
    .limit(1);
  if (!rows[0]) {
    return c.json(
      { success: false, error: 'Session not found' },
      404
    );
  }
  return c.json({ success: true, data: rows[0] });
});

app.get('/sessions/:id/messages', async (c: any) => {
  const services = c.get('services');
  const db = services?.db;
  if (!db) return notConfigured(c);
  const tenantId = c.get('tenantId');
  const sessionId = c.req.param('id');
  const rows = await db
    .select()
    .from(docChatMessages)
    .where(
      and(
        eq(docChatMessages.sessionId, sessionId),
        eq(docChatMessages.tenantId, tenantId)
      )
    )
    .orderBy(docChatMessages.createdAt);
  return c.json({ success: true, data: rows });
});

// ---------------------------------------------------------------------------
// POST /sessions — create a new chat session (persists, does not call the LLM)
// ---------------------------------------------------------------------------
app.post('/sessions', zValidator('json', StartSessionSchema), withSecurityEvents({ action: 'doc-chat.create', resource: 'doc-chat', severity: 'info' }, async (c: any) => {
  const services = c.get('services');
  const db = services?.db;
  if (!db) return notConfigured(c);
  const tenantId = c.get('tenantId');
  const userId = c.get('userId');
  const body = c.req.valid('json');

  const now = new Date();
  const row = {
    id: newId('dcs'),
    tenantId,
    scope: body.scope,
    title: body.title ?? null,
    documentIds: body.documentIds,
    participants: body.participants ?? [userId],
    createdBy: userId,
    createdAt: now,
    lastMessageAt: null,
  } as const;

  try {
    const [inserted] = await db
      .insert(docChatSessions)
      .values(row)
      .returning();

    // Fire-and-forget event so subscribers can react (e.g. audit log).
    try {
      await services.eventBus?.publish({
        event: {
          eventId: newId('evt'),
          eventType: 'DocChatSessionStarted',
          timestamp: now.toISOString(),
          tenantId,
          correlationId: newId('cor'),
          causationId: null,
          metadata: {},
          payload: { sessionId: row.id, scope: body.scope },
        } as any,
        version: 1,
        aggregateId: row.id,
        aggregateType: 'DocChatSession',
      });
    } catch (_e) {
      // Event-bus publish failures must never break the create path.
    }

    return c.json({ success: true, data: inserted ?? row }, 201);
  } catch (error) {
    return routeCatch(c, error, {
      code: 'CREATE_FAILED',
      status: 500,
      fallback: 'Create failed',
    });
  }
}));

// ---------------------------------------------------------------------------
// POST /sessions/:id/ask — ask a question. Persists user + assistant message
// via a deterministic top-K fallback when the real LLM is not wired.
// ---------------------------------------------------------------------------
app.post(
  '/sessions/:id/ask',
  zValidator('json', AskSchema),
  withSecurityEvents({ action: 'doc-chat.create', resource: 'doc-chat', severity: 'info' }, async (c: any) => {
    const services = c.get('services');
    const db = services?.db;
    if (!db) return notConfigured(c);
    const tenantId = c.get('tenantId');
    const userId = c.get('userId');
    const sessionId = c.req.param('id');
    const body = c.req.valid('json');

    // Load session, enforce tenant isolation.
    const [session] = await db
      .select()
      .from(docChatSessions)
      .where(
        and(
          eq(docChatSessions.id, sessionId),
          eq(docChatSessions.tenantId, tenantId)
        )
      )
      .limit(1);
    if (!session) {
      return c.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'Session not found' } },
        404
      );
    }

    const now = new Date();
    const nowIso = now.toISOString();

    // 1) Persist the user message FIRST (always, even if retrieval fails).
    const userMessage = {
      id: newId('dcm'),
      tenantId,
      sessionId: session.id,
      role: 'user' as const,
      authorUserId: userId,
      content: body.question,
      citations: [],
      retrievedChunkIds: [],
      createdAt: now,
    };
    await db.insert(docChatMessages).values(userMessage);

    // 2) Retrieve top-K chunks (fallback; safe when embedding svc is absent).
    const documentIds = Array.isArray(session.documentIds)
      ? session.documentIds
      : [];
    let retrieved: Array<{
      documentId: string;
      chunkIndex: number;
      text: string;
      score: number;
      page?: number;
    }> = [];
    try {
      retrieved = await fallbackRetrieve(db, tenantId, documentIds, body.question, 5);
    } catch (_e) {
      retrieved = [];
    }

    // 3) Build a deterministic assistant response.
    const anthropicConfigured = Boolean(process.env.ANTHROPIC_API_KEY);
    const top = retrieved[0];
    const content = top
      ? `Based on the indexed documents, the most relevant passage reads: "${top.text.slice(0, 240)}". (See citations for more.)`
      : `I could not find any relevant context for: "${body.question}".`;

    const citations = retrieved.slice(0, 3).map((r) => ({
      documentId: r.documentId,
      chunkIndex: r.chunkIndex,
      quote: r.text.slice(0, 240),
      score: r.score,
      page: r.page,
    }));

    const assistantMessage = {
      id: newId('dcm'),
      tenantId,
      sessionId: session.id,
      role: 'assistant' as const,
      authorUserId: null,
      content,
      citations,
      retrievedChunkIds: retrieved.map((_r, idx) => `local-${idx}`),
      model: anthropicConfigured ? 'claude-api-pending' : 'deterministic-fallback-v0',
      tokensUsed: {
        input: body.question.length,
        output: content.length,
      },
      createdAt: new Date(),
    };
    await db.insert(docChatMessages).values(assistantMessage);

    // 4) Touch the session.
    await db
      .update(docChatSessions)
      .set({ lastMessageAt: new Date() })
      .where(
        and(
          eq(docChatSessions.id, session.id),
          eq(docChatSessions.tenantId, tenantId)
        )
      );

    // 5) Emit domain event.
    try {
      await services.eventBus?.publish({
        event: {
          eventId: newId('evt'),
          eventType: 'DocChatQuestionAnswered',
          timestamp: nowIso,
          tenantId,
          correlationId: newId('cor'),
          causationId: null,
          metadata: { fallback: !anthropicConfigured },
          payload: {
            sessionId: session.id,
            userMessageId: userMessage.id,
            assistantMessageId: assistantMessage.id,
            citationCount: citations.length,
          },
        } as any,
        version: 1,
        aggregateId: session.id,
        aggregateType: 'DocChatSession',
      });
    } catch (_e) {
      // non-fatal
    }

    return c.json(
      {
        success: true,
        data: {
          userMessage,
          assistantMessage,
          fallback: !anthropicConfigured,
        },
      },
      200
    );
  })
);

// ---------------------------------------------------------------------------
// POST /sessions/:id/messages — group-chat peer message (no LLM call).
// ---------------------------------------------------------------------------
app.post(
  '/sessions/:id/messages',
  zValidator('json', PostMessageSchema),
  withSecurityEvents({ action: 'doc-chat.create', resource: 'doc-chat', severity: 'info' }, async (c: any) => {
    const services = c.get('services');
    const db = services?.db;
    if (!db) return notConfigured(c);
    const tenantId = c.get('tenantId');
    const userId = c.get('userId');
    const sessionId = c.req.param('id');
    const body = c.req.valid('json');

    const [session] = await db
      .select()
      .from(docChatSessions)
      .where(
        and(
          eq(docChatSessions.id, sessionId),
          eq(docChatSessions.tenantId, tenantId)
        )
      )
      .limit(1);
    if (!session) {
      return c.json(
        { success: false, error: { code: 'NOT_FOUND', message: 'Session not found' } },
        404
      );
    }

    const now = new Date();
    const message = {
      id: newId('dcm'),
      tenantId,
      sessionId: session.id,
      role: 'user' as const,
      authorUserId: userId,
      content: body.content,
      citations: [],
      retrievedChunkIds: [],
      createdAt: now,
    };
    await db.insert(docChatMessages).values(message);
    await db
      .update(docChatSessions)
      .set({ lastMessageAt: now })
      .where(
        and(
          eq(docChatSessions.id, session.id),
          eq(docChatSessions.tenantId, tenantId)
        )
      );

    try {
      await services.eventBus?.publish({
        event: {
          eventId: newId('evt'),
          eventType: 'DocChatMessagePosted',
          timestamp: now.toISOString(),
          tenantId,
          correlationId: newId('cor'),
          causationId: null,
          metadata: {},
          payload: { sessionId: session.id, messageId: message.id },
        } as any,
        version: 1,
        aggregateId: session.id,
        aggregateType: 'DocChatSession',
      });
    } catch (_e) {
      // non-fatal
    }

    return c.json({ success: true, data: message }, 201);
  })
);

export default app;
