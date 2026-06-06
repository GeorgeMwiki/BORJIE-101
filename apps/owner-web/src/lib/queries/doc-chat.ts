'use client';

/**
 * Per-document chat — wired to the LIVE document-intelligence pipeline.
 *
 * The gateway has no single "answer this question about document X" route.
 * Conversing with a document is a two-step, session-scoped flow
 * (services/api-gateway/src/routes/mining/document-intelligence.hono.ts):
 *
 *   1. POST /api/v1/mining/document-intelligence/sessions
 *      body { documentIds:[id] } → { sessionId }
 *      Opens a doc-intelligence session bound to the document(s); RLS
 *      verifies tenant ownership (404 otherwise).
 *
 *   2. POST /api/v1/mining/document-intelligence/sessions/:id/ask
 *      body { question, language } →
 *        { sessionId, question, language, evidenceIds, documentIds,
 *          answer }
 *      Retrieves the evidence chunks drawn ONLY from the bound documents.
 *
 * HONEST OUTPUT (CLAUDE.md "no fabricated data"): the gateway today
 * returns `answer: null` because the written answer is produced by the
 * doc-chat orchestrator and streamed out-of-band. We therefore surface
 * the REAL `answer` when the gateway provides one, and otherwise an
 * honest "evidence located, full written answer pending" state carrying
 * the REAL evidence chunk ids — we NEVER synthesise a quote client-side.
 *
 * Transport: shared `apiRequest` forwards the Supabase bearer + cookie
 * and unwraps the `{ success, data }` envelope. Responses are zod-parsed.
 */

import { z } from 'zod';
import { apiRequest, LLM_REQUEST_TIMEOUT_MS } from '@/lib/api-client';

const DOC_INTEL_BASE = '/api/v1/mining/document-intelligence';

const SessionResponseSchema = z.object({
  sessionId: z.string(),
});

const AskResponseSchema = z.object({
  sessionId: z.string(),
  question: z.string().optional().default(''),
  language: z.enum(['sw', 'en']).optional().default('en'),
  evidenceIds: z.array(z.string()).default([]),
  documentIds: z.array(z.string()).default([]),
  // The orchestrator answer; null until the doc-chat stream resolves it.
  answer: z.string().nullable().default(null),
});

export type DocChatAnswer = z.infer<typeof AskResponseSchema>;

/**
 * Open a doc-intelligence session bound to a single document and ask one
 * question. Returns the gateway's real answer + evidence envelope.
 *
 * Throws `ApiError` on non-2xx (the caller surfaces an honest error
 * state via react-query / try-catch).
 */
export async function askDocument(args: {
  readonly documentId: string;
  readonly question: string;
  readonly language: 'sw' | 'en';
  readonly signal?: AbortSignal;
}): Promise<DocChatAnswer> {
  const opened = await apiRequest<unknown>(`${DOC_INTEL_BASE}/sessions`, {
    method: 'POST',
    body: { documentIds: [args.documentId] },
    ...(args.signal ? { signal: args.signal } : {}),
  });
  const { sessionId } = SessionResponseSchema.parse(opened);

  const raw = await apiRequest<unknown>(
    `${DOC_INTEL_BASE}/sessions/${encodeURIComponent(sessionId)}/ask`,
    {
      method: 'POST',
      body: { question: args.question, language: args.language },
      // Retrieval + orchestrator dispatch can run several seconds.
      timeoutMs: LLM_REQUEST_TIMEOUT_MS,
      ...(args.signal ? { signal: args.signal } : {}),
    },
  );
  return AskResponseSchema.parse(raw);
}
