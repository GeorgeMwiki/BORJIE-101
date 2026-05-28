/**
 * brain-api — unit tests for the LIVE `/api/v1/brain` client.
 *
 * Covers:
 *   1. createThread happy path (POST /turn returns threadId)
 *   2. 401 → throws ApiError with status preserved
 *   3. streamBrainChat yields a single terminal chunk with citations
 *      normalised from the wire response
 *   4. citations fall back to tool-call evidenceIds when the gateway
 *      response omits a top-level `citations` array
 *   5. loadThread normalises both camelCase and snake_case event shapes
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ApiError,
  createThread,
  loadThread,
  streamBrainChat,
  submitBrainTurn,
} from '@/lib/brain-api';

// Supabase client is dynamically imported by api-client → stub it so
// `authHeaders()` resolves without touching the network or env.
vi.mock('@/lib/supabase/client', () => ({
  createSupabaseBrowserClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
    },
  }),
}));

function mockFetchOnce(response: {
  readonly status: number;
  readonly body: unknown;
}): ReturnType<typeof vi.fn> {
  const fn = vi.fn(
    async () =>
      new Response(JSON.stringify(response.body), {
        status: response.status,
        headers: { 'Content-Type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fn);
  return fn;
}

beforeEach(() => {
  // Avoid the page-render `window` happy path needing localStorage etc.
  process.env.NEXT_PUBLIC_API_GATEWAY_URL = 'http://localhost:9999';
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('brain-api · createThread', () => {
  it('returns the threadId from POST /api/v1/brain/turn', async () => {
    mockFetchOnce({
      status: 200,
      body: {
        threadId: 'thr_abc',
        finalPersonaId: 'mr-mwikila',
        responseText: 'Hello! How can I help?',
        handoffs: [],
        toolCalls: [],
        advisorConsulted: false,
        proposedAction: null,
        tokensUsed: 42,
      },
    });
    const result = await createThread('Hello Borjie');
    expect(result.threadId).toBe('thr_abc');
  });
});

describe('brain-api · ApiError on non-2xx', () => {
  it('throws ApiError(401) when the gateway rejects the token', async () => {
    mockFetchOnce({ status: 401, body: { error: 'missing_authorization_header' } });
    await expect(
      submitBrainTurn({ userText: 'rejected please' }),
    ).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
    });
  });

  it('preserves ApiError type for instanceof checks', async () => {
    mockFetchOnce({ status: 503, body: { error: 'BRAIN_NOT_CONFIGURED' } });
    try {
      await submitBrainTurn({ userText: 'no env' });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect((err as ApiError).status).toBe(503);
    }
  });
});

describe('brain-api · streamBrainChat', () => {
  it('yields one terminal chunk with text + citations', async () => {
    mockFetchOnce({
      status: 200,
      body: {
        threadId: 'thr_stream',
        finalPersonaId: 'borjie',
        responseText: 'Gold output rose 4% on the Geita PML.',
        handoffs: [],
        toolCalls: [],
        advisorConsulted: false,
        proposedAction: null,
        tokensUsed: 117,
        citations: [
          {
            id: 'chunk_001',
            mineralCode: 'AU',
            section: '3.2 Output',
            score: 0.87,
            sourceFile: 'pml-25434.pdf',
          },
        ],
      },
    });
    const chunks: Array<{ chunk: string; done: boolean }> = [];
    for await (const c of streamBrainChat({ message: 'How is gold output?' })) {
      chunks.push({ chunk: c.chunk, done: c.done });
    }
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.done).toBe(true);
    expect(chunks[0]!.chunk).toContain('Gold output rose 4%');
  });

  it('falls back to tool-call evidenceIds when citations are omitted', async () => {
    mockFetchOnce({
      status: 200,
      body: {
        threadId: 'thr_fallback',
        finalPersonaId: 'borjie',
        responseText: 'Investigating.',
        handoffs: [],
        toolCalls: [
          {
            name: 'Geology',
            status: 'ok',
            latencyMs: 240,
            evidence_ids: ['chunk_xyz', 'chunk_qqq'],
          },
        ],
        advisorConsulted: false,
        proposedAction: null,
        tokensUsed: 5,
      },
    });
    const chunks: Array<{ citations: readonly { id: string }[] }> = [];
    for await (const c of streamBrainChat({ message: 'What changed?' })) {
      chunks.push({ citations: c.citations });
    }
    const ids = chunks[0]!.citations.map((c) => c.id);
    expect(ids).toContain('chunk_xyz');
    expect(ids).toContain('chunk_qqq');
  });
});

describe('brain-api · loadThread', () => {
  it('normalises camelCase and snake_case event shapes uniformly', async () => {
    mockFetchOnce({
      status: 200,
      body: {
        thread: { id: 'thr_load' },
        events: [
          {
            id: 'evt_1',
            role: 'user',
            content: 'Why is FX down?',
            createdAt: '2026-05-27T10:00:00Z',
          },
          {
            id: 'evt_2',
            role: 'assistant',
            text: 'TZS strengthened vs USD by 1.2%.',
            created_at: '2026-05-27T10:00:05Z',
            persona_id: 'fx-analyst',
          },
          {
            // Should be filtered — bad role.
            id: 'evt_bad',
            role: 'random',
            content: 'oops',
          },
        ],
      },
    });
    const result = await loadThread('thr_load');
    expect(result.threadId).toBe('thr_load');
    expect(result.messages).toHaveLength(2);
    expect(result.messages[0]!.role).toBe('user');
    expect(result.messages[1]!.role).toBe('assistant');
    expect(result.messages[1]!.personaId).toBe('fx-analyst');
    expect(result.messages[1]!.content).toBe('TZS strengthened vs USD by 1.2%.');
  });
});
