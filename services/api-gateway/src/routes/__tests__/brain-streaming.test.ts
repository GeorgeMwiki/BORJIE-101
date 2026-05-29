/**
 * /api/v1/brain/turn — SSE streaming + JSON fallback contract.
 *
 * Locks the wire contract used by mobile + web chat surfaces:
 *
 *   1. SSE happy path — `Accept: text/event-stream` gets
 *      `turn.accepted` → (`tool_call` | `message_chunk`)* → `done`.
 *   2. JSON fallback — anything else (incl. `application/json` and
 *      wildcard accept) keeps the legacy object-shape response so
 *      owner-web continues to work unchanged.
 *   3. `turn.accepted` lands first and carries `{ at }` so the mobile
 *      "typing" indicator can render in <100ms (TTFT win).
 *   4. Orchestrator hard-error mid-stream → `event: error` frame +
 *      stream closes (no `done` frame). Kill-switch fail-closed proxy.
 *   5. Auth + body validation gates fire BEFORE the stream opens so
 *      callers still see a JSON 4xx for 400 / 401 / 403.
 *
 * The Brain is mocked via `vi.mock('@borjie/ai-copilot', ...)` so the
 * test rig does not require a real Anthropic key, Postgres pool, or
 * Neo4j cluster — it pins only the route-level contract.
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

// Pin Supabase JWT secret + a minimal brain env BEFORE any router import
// so `loadBrainEnv` succeeds on first lazy access.
const SUPABASE_SECRET = 'test-secret-supabase-jwt-1234567890-abcdefghijkl';
process.env.SUPABASE_JWT_SECRET = SUPABASE_SECRET;
process.env.ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || 'sk-ant-test-key-aaaaaaaaaaaaaaaaaaaa';
process.env.NEXT_PUBLIC_SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://example.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'anon-key-aaaaaaaaaaaaaaaaaaaa';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-aaaaaaaaaaaaaaaa';
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgres://test:test@localhost:5432/test';
process.env.BORJIE_SKIP_DOTENV = 'true';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';

// ---------------------------------------------------------------------------
// Mocks — pre-import so the lazy module-init in brain.hono.ts picks them up
// ---------------------------------------------------------------------------

interface MockTurn {
  threadId: string;
  finalPersonaId: string;
  responseText: string;
  toolCalls: Array<{ tool: string; ok: boolean }>;
  handoffs: Array<{ from: string; to: string; objective: string }>;
  tokensUsed: number;
  timeMs: number;
  advisorConsulted: boolean;
  proposedAction?: { verb: string; object: string; riskLevel: string; reviewRequired: boolean; executionHeld?: boolean };
}

let startThreadImpl: () => Promise<{ success: boolean; data?: { thread: { id: string }; turn: MockTurn }; error?: { code: string; message: string; retryable: boolean } }> = async () => ({
  success: true,
  data: {
    thread: { id: 'thread-mock-1' },
    turn: {
      threadId: 'thread-mock-1',
      finalPersonaId: 'persona.coworker',
      responseText: 'Hello from mock brain.',
      toolCalls: [],
      handoffs: [],
      tokensUsed: 42,
      timeMs: 12,
      advisorConsulted: false,
    },
  },
});

let handleTurnImpl: () => Promise<{ success: boolean; data?: MockTurn; error?: { code: string; message: string; retryable: boolean } }> = async () => ({
  success: true,
  data: {
    threadId: 'thread-mock-existing',
    finalPersonaId: 'persona.coworker',
    responseText: 'Existing thread reply from mock.',
    toolCalls: [{ tool: 'skill.lookup', ok: true }],
    handoffs: [],
    tokensUsed: 21,
    timeMs: 7,
    advisorConsulted: false,
  },
});

vi.mock('@borjie/ai-copilot', async () => {
  const real = await vi.importActual<typeof import('@borjie/ai-copilot')>(
    '@borjie/ai-copilot',
  );
  return {
    ...real,
    // Replace createBrain with a factory that returns our controllable
    // fake — keeps the rest of the public surface intact so the route
    // module can still use real `loadBrainEnv`, `verifySupabaseJwt`,
    // `principalToBrainContexts`, `BrainRegistry`, etc.
    createBrain: () => ({
      orchestrator: {
        startThread: (...args: unknown[]) => startThreadImpl(...(args as [])),
        handleTurn: (...args: unknown[]) => handleTurnImpl(...(args as [])),
      },
      personas: { get: () => null, register: () => undefined, resolveCoworker: () => null },
      threads: { listThreads: async () => [], getThread: async () => null, readAs: async () => [] },
      tools: { register: () => undefined },
      governance: {},
      reviewService: {},
      executor: { healthCheck: async () => true },
    }),
    // Override `streamTurn` to yield from our handleTurnImpl result; the
    // shape mirrors the real generator's event contract.
    streamTurn: async function* (
      _orchestrator: unknown,
      req: { threadId: string; forcePersonaId?: string },
    ): AsyncGenerator<unknown> {
      const result = await handleTurnImpl();
      yield {
        type: 'turn_start',
        threadId: req.threadId,
        personaId: req.forcePersonaId,
        createdAt: new Date().toISOString(),
      };
      if (!result.success) {
        yield {
          type: 'error',
          code: result.error?.code ?? 'UNKNOWN',
          message: result.error?.message ?? 'unknown',
          retryable: result.error?.retryable ?? false,
        };
        yield {
          type: 'turn_end',
          threadId: req.threadId,
          finalPersonaId: req.forcePersonaId ?? 'unknown',
          totalTokens: 0,
          totalCost: 0,
          timeMs: 0,
          advisorConsulted: false,
        };
        return;
      }
      const turn = result.data!;
      for (const tc of turn.toolCalls) {
        yield { type: 'tool_call', name: tc.tool };
        yield { type: 'tool_result', name: tc.tool, ok: tc.ok };
      }
      for (const h of turn.handoffs) {
        yield { type: 'handoff', from: h.from, to: h.to, objective: h.objective };
      }
      const chunk = 24;
      for (let i = 0; i < turn.responseText.length; i += chunk) {
        yield { type: 'delta', content: turn.responseText.slice(i, i + chunk) };
      }
      yield {
        type: 'turn_end',
        threadId: turn.threadId,
        finalPersonaId: turn.finalPersonaId,
        totalTokens: turn.tokensUsed,
        totalCost: 0,
        timeMs: turn.timeMs,
        advisorConsulted: turn.advisorConsulted,
      };
    },
    // checkBrainHealth must still resolve — used by /health route.
    checkBrainHealth: async () => ({ ok: true, providers: { anthropic: true } }),
  };
});

// Database + graph-sync + observability stubs — the route imports the
// `createDatabaseClient` factory, the Neo4j toolkit, and the security
// events sink. None of them need real connections for these tests.
vi.mock('@borjie/database', async () => {
  const real = await vi.importActual<typeof import('@borjie/database')>(
    '@borjie/database',
  );
  return {
    ...real,
    createDatabaseClient: () => ({
      execute: async () => ({ rows: [] }),
    }),
    BrainThreadRepository: class {},
    MigrationWriterService: class {
      async commit() {
        return { ok: true };
      }
    },
  };
});

vi.mock('@borjie/graph-sync', () => ({
  createNeo4jClient: () => {
    throw new Error('graph not wired in test');
  },
  createGraphQueryService: () => ({}),
  createGraphAgentToolkit: () => undefined,
}));

vi.mock('../../composition/brain-extensions', () => ({
  getBrainExtraSkills: () => [],
}));

// ---------------------------------------------------------------------------
// After the mocks are in place, import the router.
// ---------------------------------------------------------------------------

import { brainRouter } from '../brain.hono';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SECRET_BYTES = new TextEncoder().encode(SUPABASE_SECRET);

async function mintSupabaseToken(opts: {
  userId?: string;
  tenantId?: string;
  roles?: string[];
} = {}): Promise<string> {
  return await new SignJWT({
    sub: opts.userId ?? 'user-1',
    email: 'tester@example.com',
    app_metadata: {
      tenant_id: opts.tenantId ?? 'tenant-1',
      tenant_name: 'Test Tenant',
      roles: opts.roles ?? ['admin'],
      team_ids: [],
      environment: 'production',
    },
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .setSubject(opts.userId ?? 'user-1')
    .sign(SECRET_BYTES);
}

interface ParsedSseFrame {
  event: string;
  data: unknown;
}

async function readSseFrames(
  body: ReadableStream<Uint8Array> | null,
  maxMs = 4_000,
): Promise<ParsedSseFrame[]> {
  if (!body) return [];
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const start = Date.now();
  let buffer = '';
  const frames: ParsedSseFrame[] = [];
  try {
    while (Date.now() - start < maxMs) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx = buffer.indexOf('\n\n');
      while (idx !== -1) {
        const raw = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        let event = '';
        let data = '';
        for (const line of raw.split('\n')) {
          if (line.startsWith('event: ')) event = line.slice(7).trim();
          else if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data: ')) data += line.slice(6);
          else if (line.startsWith('data:')) data += line.slice(5);
        }
        if (event) {
          let parsed: unknown = data;
          try {
            parsed = JSON.parse(data);
          } catch {
            // leave raw
          }
          frames.push({ event, data: parsed });
        }
        idx = buffer.indexOf('\n\n');
      }
    }
  } finally {
    reader.releaseLock();
  }
  return frames;
}

function mount(): Hono {
  const app = new Hono();
  app.route('/api/v1/brain', brainRouter);
  return app;
}

async function bearerOk(): Promise<string> {
  return `Bearer ${await mintSupabaseToken()}`;
}

// ---------------------------------------------------------------------------
// Test environment sanity
// ---------------------------------------------------------------------------

beforeAll(() => {
  expect(process.env.SUPABASE_JWT_SECRET?.length ?? 0).toBeGreaterThanOrEqual(32);
});

afterEach(() => {
  // Reset to default success impls between tests.
  startThreadImpl = async () => ({
    success: true,
    data: {
      thread: { id: 'thread-mock-1' },
      turn: {
        threadId: 'thread-mock-1',
        finalPersonaId: 'persona.coworker',
        responseText: 'Hello from mock brain.',
        toolCalls: [],
        handoffs: [],
        tokensUsed: 42,
        timeMs: 12,
        advisorConsulted: false,
      },
    },
  });
  handleTurnImpl = async () => ({
    success: true,
    data: {
      threadId: 'thread-mock-existing',
      finalPersonaId: 'persona.coworker',
      responseText: 'Existing thread reply from mock.',
      toolCalls: [{ tool: 'skill.lookup', ok: true }],
      handoffs: [],
      tokensUsed: 21,
      timeMs: 7,
      advisorConsulted: false,
    },
  });
});

// ---------------------------------------------------------------------------
// 1. SSE happy paths
// ---------------------------------------------------------------------------

describe('POST /api/v1/brain/turn — SSE happy path (Accept: text/event-stream)', () => {
  it('opens an SSE stream with text/event-stream content-type', async () => {
    const app = mount();
    const res = await app.request('/api/v1/brain/turn', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: await bearerOk(),
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({ userText: 'kick the brain' }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toContain('text/event-stream');
  });

  it('emits turn.accepted as the very first frame (TTFT ack)', async () => {
    const app = mount();
    const res = await app.request('/api/v1/brain/turn', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: await bearerOk(),
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({ userText: 'hello there' }),
    });
    const frames = await readSseFrames(res.body, 4_000);
    expect(frames.length).toBeGreaterThan(0);
    expect(frames[0]?.event).toBe('turn.accepted');
    const data = frames[0]?.data as { at: string; tenantId: string };
    expect(typeof data.at).toBe('string');
    expect(new Date(data.at).toString()).not.toBe('Invalid Date');
    expect(data.tenantId).toBe('tenant-1');
  });

  it('streams message_chunk frames carrying response text and terminates with done', async () => {
    const app = mount();
    const res = await app.request('/api/v1/brain/turn', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: await bearerOk(),
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({ userText: 'start a new thread' }),
    });
    const frames = await readSseFrames(res.body, 4_000);
    const eventNames = frames.map((f) => f.event);
    expect(eventNames[0]).toBe('turn.accepted');
    expect(eventNames).toContain('message_chunk');
    expect(eventNames[eventNames.length - 1]).toBe('done');
    // Concatenated chunks reconstruct the mock's response text.
    const reconstructed = frames
      .filter((f) => f.event === 'message_chunk')
      .map((f) => (f.data as { text?: string }).text ?? '')
      .join('');
    expect(reconstructed).toContain('Hello from mock brain.');
    const doneData = frames[frames.length - 1]?.data as {
      threadId: string;
      tokensUsed: number;
      totalMs: number;
      cacheReadTokens: number | null;
    };
    expect(doneData.threadId).toBe('thread-mock-1');
    expect(doneData.tokensUsed).toBe(42);
    expect(typeof doneData.totalMs).toBe('number');
    // cacheReadTokens is intentionally null until the orchestrator
    // threads cacheStats through TurnResult (out-of-scope GAP).
    expect(doneData.cacheReadTokens).toBeNull();
  });

  it('emits ack frame in Swahili immediately after turn.accepted (default)', async () => {
    const app = mount();
    const res = await app.request('/api/v1/brain/turn', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: await bearerOk(),
        Accept: 'text/event-stream',
        // No Accept-Language → Swahili-first per Borjie hard rule.
      },
      body: JSON.stringify({ userText: 'kuongelea' }),
    });
    const frames = await readSseFrames(res.body, 4_000);
    expect(frames[0]?.event).toBe('turn.accepted');
    expect(frames[1]?.event).toBe('ack');
    const ack = frames[1]?.data as { text: string; lang: string };
    expect(ack.text).toBe('Karibu, ninafikiri…');
    expect(ack.lang).toBe('sw');
  });

  it('emits ack frame in English when Accept-Language: en', async () => {
    const app = mount();
    const res = await app.request('/api/v1/brain/turn', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: await bearerOk(),
        Accept: 'text/event-stream',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      body: JSON.stringify({ userText: 'speak english' }),
    });
    const frames = await readSseFrames(res.body, 4_000);
    expect(frames[1]?.event).toBe('ack');
    const ack = frames[1]?.data as { text: string; lang: string };
    expect(ack.text).toBe('Got it, thinking…');
    expect(ack.lang).toBe('en');
  });

  it('emits tool_call frames in dispatch order before message_chunk for existing threads', async () => {
    const app = mount();
    const res = await app.request('/api/v1/brain/turn', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: await bearerOk(),
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({ threadId: 'thread-mock-existing', userText: 'continue' }),
    });
    const frames = await readSseFrames(res.body, 4_000);
    const seq = frames.map((f) => f.event);
    const firstToolCall = seq.indexOf('tool_call');
    const firstChunk = seq.indexOf('message_chunk');
    expect(firstToolCall).toBeGreaterThan(0); // after turn.accepted
    // tool_call must precede message_chunk per StreamTurn ordering
    expect(firstChunk === -1 || firstToolCall < firstChunk).toBe(true);
    const toolFrame = frames.find((f) => f.event === 'tool_call');
    expect((toolFrame?.data as { tool: string }).tool).toBe('skill.lookup');
  });
});

// ---------------------------------------------------------------------------
// 2. JSON fallback
// ---------------------------------------------------------------------------

describe('POST /api/v1/brain/turn — JSON fallback', () => {
  it('returns application/json when Accept does not include text/event-stream', async () => {
    const app = mount();
    const res = await app.request('/api/v1/brain/turn', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: await bearerOk(),
        Accept: 'application/json',
      },
      body: JSON.stringify({ userText: 'json please' }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toContain('application/json');
    const body = (await res.json()) as {
      threadId: string;
      responseText: string;
      tokensUsed: number;
    };
    expect(body.threadId).toBe('thread-mock-1');
    expect(body.responseText).toBe('Hello from mock brain.');
    expect(body.tokensUsed).toBe(42);
  });

  it('JSON fallback applies for missing Accept header (legacy clients)', async () => {
    const app = mount();
    const res = await app.request('/api/v1/brain/turn', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: await bearerOk(),
      },
      body: JSON.stringify({ userText: 'no accept header' }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toContain('application/json');
  });

  it('JSON fallback applies when Accept is */* (curl default)', async () => {
    const app = mount();
    const res = await app.request('/api/v1/brain/turn', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: await bearerOk(),
        Accept: '*/*',
      },
      body: JSON.stringify({ userText: 'curl style' }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toContain('application/json');
  });

  it('JSON path with explicit threadId hits the handleTurn (not startThread) branch', async () => {
    const app = mount();
    const res = await app.request('/api/v1/brain/turn', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: await bearerOk(),
        Accept: 'application/json',
      },
      body: JSON.stringify({ threadId: 'thread-mock-existing', userText: 'follow up' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { threadId: string; responseText: string };
    expect(body.threadId).toBe('thread-mock-existing');
    expect(body.responseText).toContain('Existing thread reply');
  });
});

// ---------------------------------------------------------------------------
// 3. Error / mid-stream fail-closed
// ---------------------------------------------------------------------------

describe('POST /api/v1/brain/turn — error / fail-closed semantics', () => {
  it('SSE: orchestrator hard-error mid-stream emits event: error and closes without done', async () => {
    handleTurnImpl = async () => ({
      success: false,
      error: {
        code: 'KILL_SWITCH_ACTIVE',
        message: 'governance refused this step',
        retryable: false,
      },
    });
    const app = mount();
    const res = await app.request('/api/v1/brain/turn', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: await bearerOk(),
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({ threadId: 'thread-existing', userText: 'do the thing' }),
    });
    const frames = await readSseFrames(res.body, 4_000);
    const events = frames.map((f) => f.event);
    expect(events).toContain('turn.accepted');
    expect(events).toContain('error');
    // Critical fail-closed invariant: no `done` after `error`.
    expect(events[events.length - 1]).toBe('error');
    expect(events).not.toContain('done');
    const errFrame = frames.find((f) => f.event === 'error');
    const errData = errFrame?.data as { message: string; code: string; retryable: boolean };
    expect(errData.code).toBe('KILL_SWITCH_ACTIVE');
    expect(errData.retryable).toBe(false);
  });

  it('SSE: startThread failure on new-thread request surfaces as event: error', async () => {
    startThreadImpl = async () => ({
      success: false,
      error: {
        code: 'PERSONA_NOT_FOUND',
        message: 'forced persona missing',
        retryable: false,
      },
    });
    const app = mount();
    const res = await app.request('/api/v1/brain/turn', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: await bearerOk(),
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({ userText: 'new thread', forcePersonaId: 'ghost' }),
    });
    const frames = await readSseFrames(res.body, 4_000);
    const events = frames.map((f) => f.event);
    expect(events[0]).toBe('turn.accepted');
    expect(events).toContain('error');
    expect(events).not.toContain('done');
  });

  it('JSON: orchestrator failure surfaces as 500 with error message (legacy contract)', async () => {
    handleTurnImpl = async () => ({
      success: false,
      error: {
        code: 'BUDGET_EXCEEDED_MID_TURN',
        message: 'token ceiling reached',
        retryable: false,
      },
    });
    const app = mount();
    const res = await app.request('/api/v1/brain/turn', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: await bearerOk(),
        Accept: 'application/json',
      },
      body: JSON.stringify({ threadId: 'thread-x', userText: 'follow up' }),
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('token ceiling');
  });
});

// ---------------------------------------------------------------------------
// 4. Gate semantics (apply before stream opens)
// ---------------------------------------------------------------------------

describe('POST /api/v1/brain/turn — gate semantics', () => {
  it('returns 400 invalid_json for non-JSON body even when Accept: text/event-stream', async () => {
    const app = mount();
    const res = await app.request('/api/v1/brain/turn', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: await bearerOk(),
        Accept: 'text/event-stream',
      },
      body: 'not json at all',
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 userText_required when body is missing userText', async () => {
    const app = mount();
    const res = await app.request('/api/v1/brain/turn', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: await bearerOk(),
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({ threadId: 't' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('userText_required');
  });

  it('returns 401 when Authorization header is missing', async () => {
    const app = mount();
    const res = await app.request('/api/v1/brain/turn', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify({ userText: 'hi' }),
    });
    expect(res.status).toBe(401);
  });
});
