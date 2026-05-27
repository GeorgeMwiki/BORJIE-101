/**
 * brain-api (admin-web) — unit tests for the LIVE `/api/v1/brain` client.
 *
 * Covers:
 *   1. submitBrainTurn forwards `forcePersonaId` to the gateway when set.
 *   2. createThread forces `T2_admin_strategist` persona on the first
 *      turn (admin sees all-tenant scope).
 *   3. 401 responses bubble up as `ApiError` with the status preserved.
 *   4. Citations fall back to tool-call evidenceIds when the gateway
 *      omits the top-level `citations` array.
 *   5. streamBrainChat yields a single terminal chunk with normalised
 *      text + citations.
 *   6. loadThread normalises camelCase and snake_case event shapes
 *      uniformly so legacy and new wire formats both render correctly.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  ApiError,
  createThread,
  loadThread,
  streamBrainChat,
  submitBrainTurn,
} from '@/lib/brain-api';

// Stub the Supabase browser client so `authHeaders()` does not touch the
// network or require env vars.
vi.mock('@/lib/supabase/client', () => ({
  createSupabaseBrowserClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
    },
  }),
}));

interface MockResponseShape {
  readonly status: number;
  readonly body: unknown;
}

function mockFetchOnce(response: MockResponseShape) {
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
  process.env.NEXT_PUBLIC_API_GATEWAY_URL = 'http://localhost:9999';
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('brain-api (admin) · submitBrainTurn', () => {
  it('forwards forcePersonaId to the gateway when passed', async () => {
    const fetchSpy = mockFetchOnce({
      status: 200,
      body: {
        threadId: 'thr_admin',
        finalPersonaId: 'T2_admin_strategist',
        responseText: 'Habari kiongozi.',
        handoffs: [],
        toolCalls: [],
        advisorConsulted: false,
        proposedAction: null,
        tokensUsed: 10,
      },
    });
    await submitBrainTurn({
      userText: 'Onyesha tenants 10 wapya',
      forcePersonaId: 'T2_admin_strategist',
    });
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(0);
    const call = fetchSpy.mock.calls[0] as unknown as [
      string,
      { body?: string },
    ];
    const body = JSON.parse(call[1]?.body ?? '{}') as Record<string, unknown>;
    expect(body.forcePersonaId).toBe('T2_admin_strategist');
    expect(body.userText).toBe('Onyesha tenants 10 wapya');
  });
});

describe('brain-api (admin) · createThread', () => {
  it('returns the threadId and forces T2_admin_strategist persona', async () => {
    const fetchSpy = mockFetchOnce({
      status: 200,
      body: {
        threadId: 'thr_admin_first',
        finalPersonaId: 'T2_admin_strategist',
        responseText: 'Karibu kwa Borjie internal.',
        handoffs: [],
        toolCalls: [],
        advisorConsulted: false,
        proposedAction: null,
        tokensUsed: 4,
      },
    });
    const result = await createThread('Hello Borjie internal');
    expect(result.threadId).toBe('thr_admin_first');
    const call = fetchSpy.mock.calls[0] as unknown as [
      string,
      { body?: string },
    ];
    const body = JSON.parse(call[1]?.body ?? '{}') as Record<string, unknown>;
    expect(body.forcePersonaId).toBe('T2_admin_strategist');
  });
});

describe('brain-api (admin) · ApiError on non-2xx', () => {
  it('throws ApiError(401) when the gateway rejects the token', async () => {
    mockFetchOnce({
      status: 401,
      body: { error: 'missing_authorization_header' },
    });
    await expect(
      submitBrainTurn({ userText: 'rejected please' }),
    ).rejects.toMatchObject({
      name: 'ApiError',
      status: 401,
    });
  });
});

describe('brain-api (admin) · streamBrainChat', () => {
  it('yields one terminal chunk and falls back to tool-call evidence ids', async () => {
    mockFetchOnce({
      status: 200,
      body: {
        threadId: 'thr_stream',
        finalPersonaId: 'T2_admin_strategist',
        responseText: 'Tenants 10 wapya zimepatikana.',
        handoffs: [],
        toolCalls: [
          {
            name: 'TenantDirectory',
            status: 'ok',
            latencyMs: 88,
            evidence_ids: ['tnt_1', 'tnt_2'],
          },
        ],
        advisorConsulted: false,
        proposedAction: null,
        tokensUsed: 17,
      },
    });
    const chunks: Array<{ chunk: string; done: boolean; ids: string[] }> = [];
    for await (const c of streamBrainChat({ message: 'Tenants leo?' })) {
      chunks.push({
        chunk: c.chunk,
        done: c.done,
        ids: c.citations.map((cit) => cit.id),
      });
    }
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.done).toBe(true);
    expect(chunks[0]!.chunk).toContain('Tenants 10 wapya');
    expect(chunks[0]!.ids).toContain('tnt_1');
    expect(chunks[0]!.ids).toContain('tnt_2');
  });
});

describe('brain-api (admin) · loadThread', () => {
  it('normalises camelCase and snake_case events uniformly', async () => {
    mockFetchOnce({
      status: 200,
      body: {
        thread: { id: 'thr_load' },
        events: [
          {
            id: 'evt_1',
            role: 'user',
            content: 'Kill-switch hali?',
            createdAt: '2026-05-27T10:00:00Z',
          },
          {
            id: 'evt_2',
            role: 'assistant',
            text: 'Kill-switch ARM, hakuna abuse.',
            created_at: '2026-05-27T10:00:05Z',
            persona_id: 'T2_admin_strategist',
          },
          {
            // Bad role — should be filtered.
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
    expect(result.messages[1]!.personaId).toBe('T2_admin_strategist');
    expect(result.messages[1]!.content).toBe(
      'Kill-switch ARM, hakuna abuse.',
    );
  });

  it('rejects empty threadId with ApiError(400) before issuing a request', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await expect(loadThread('')).rejects.toBeInstanceOf(ApiError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
