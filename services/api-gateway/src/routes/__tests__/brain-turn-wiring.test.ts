/**
 * Brain /turn live-path WIRING tests — LP-01 / LP-15 / LP-30.
 *
 * Pins that the two previously-dark adapters are now INVOKED on the live
 * `POST /api/v1/brain/turn` request path (not just constructed):
 *
 *   1. Cognitive enrichment (`withCognitiveEnrichment`): when the wired
 *      cognitive bundle is exposed on the Hono context (the
 *      `createCognitiveContextMiddleware` seam used in index.ts) the
 *      recalled-memory block is PREPENDED to the user's text before the
 *      orchestrator runs. The deep composer rides inside the same
 *      enrichment (flag-gated, default OFF) — see cognitive-wiring tests
 *      for the composer routing itself.
 *
 *   2. Privacy router (`consultBrainTurnPrivacy`): consulted BEFORE the
 *      orchestrator (the LLM provider boundary). Ordinary text passes
 *      through unchanged; text carrying PII (an M-Pesa transaction id) is
 *      PII-STRIPPED so no raw PII reaches the provider.
 *
 *   3. Fail-safe: with NO cognitive middleware mounted (bundle absent) and
 *      the privacy router enabled, a normal turn still returns 200 — neither
 *      call-site can break the turn.
 *
 * These complement the wiring-module unit tests (privacy-router-wiring,
 * cognitive-wiring, cognitive-composer-wiring) by proving the call-sites
 * actually fire on a real request.
 */

import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { Hono } from 'hono';
import { SignJWT } from 'jose';

const SUPABASE_SECRET = 'test-secret-supabase-jwt-1234567890-abcdefghijkl';
process.env.SUPABASE_JWT_SECRET = SUPABASE_SECRET;
process.env.ANTHROPIC_API_KEY =
  process.env.ANTHROPIC_API_KEY || 'sk-ant-test-key-aaaaaaaaaaaaaaaaaaaa';
process.env.NEXT_PUBLIC_SUPABASE_URL =
  process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://example.supabase.co';
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'anon-key-aaaaaaaaaaaaaaaaaaaa';
process.env.SUPABASE_SERVICE_ROLE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY || 'service-role-aaaaaaaaaaaaaaaa';
process.env.DATABASE_URL =
  process.env.DATABASE_URL || 'postgres://test:test@localhost:5432/test';
process.env.BORJIE_SKIP_DOTENV = 'true';
process.env.NODE_ENV = process.env.NODE_ENV || 'test';
// Privacy router is default-ON; the local-model health URL is intentionally
// unset so RESTRICTED data would be denied — but ordinary/PII text classifies
// INTERNAL/CONFIDENTIAL and is allowed (the cases under test).
delete process.env.BORJIE_LOCAL_MODEL_HEALTH_URL;

// Capture every userText the orchestrator receives so the tests can assert
// the enrichment / privacy substitution happened upstream of dispatch.
const handleTurnTexts: string[] = [];

vi.mock('@borjie/ai-copilot', async () => {
  const real = await vi.importActual<typeof import('@borjie/ai-copilot')>(
    '@borjie/ai-copilot',
  );
  return {
    ...real,
    createBrain: () => ({
      orchestrator: {
        startThread: async () => ({
          success: true,
          data: {
            thread: { id: 'thread-1' },
            turn: {
              threadId: 'thread-1',
              finalPersonaId: 'persona.coworker',
              responseText: 'mock start [evidence:lmbm_start_1]',
              toolCalls: [],
              handoffs: [],
              tokensUsed: 10,
              timeMs: 5,
              advisorConsulted: false,
            },
          },
        }),
        handleTurn: async (args: { userText: string }) => {
          handleTurnTexts.push(args.userText);
          return {
            success: true,
            data: {
              threadId: 'existing-thread',
              finalPersonaId: 'persona.coworker',
              responseText: 'mock reply [evidence:lmbm_reply_1]',
              toolCalls: [],
              handoffs: [],
              tokensUsed: 10,
              timeMs: 5,
              advisorConsulted: false,
            },
          };
        },
      },
      personas: {
        get: () => null,
        register: () => undefined,
        resolveCoworker: () => null,
      },
      threads: {
        listThreads: async () => [],
        getThread: async () => null,
        readAs: async () => [],
      },
      tools: { register: () => undefined },
      governance: {},
      reviewService: {},
      executor: { healthCheck: async () => true },
    }),
    streamTurn: async function* () {
      yield {
        type: 'turn_end',
        threadId: 'x',
        finalPersonaId: 'p',
        totalTokens: 0,
        totalCost: 0,
        timeMs: 0,
        advisorConsulted: false,
      };
    },
    checkBrainHealth: async () => ({ ok: true, providers: { anthropic: true } }),
  };
});

vi.mock('@borjie/database', async () => {
  const real = await vi.importActual<typeof import('@borjie/database')>(
    '@borjie/database',
  );
  return {
    ...real,
    createDatabaseClient: () => ({ execute: async () => ({ rows: [] }) }),
    BrainThreadRepository: class {},
    // `withTenantContext` is used by the support-recall hook; make it a
    // passthrough that returns an empty recall so the hook is a no-op and
    // the only prepended block under test is the cognitive enrichment.
    withTenantContext: async (
      _db: unknown,
      _tenantId: string,
      fn: (tx: unknown) => Promise<unknown>,
    ) => fn({}),
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

// Support-case recall returns nothing so it never prepends a block — the
// cognitive enrichment is the only memory block under test.
vi.mock('../../services/support-cases/index.js', () => ({
  recallSupportMemory: async () => ({ preamble: '', cases: [] }),
}));

import {
  brainRouter,
  __resetBrainIdempotencyCache,
  __resetBrainPrivacyRouter,
} from '../brain.hono';
import {
  wireCognitive,
  createCognitiveContextMiddleware,
} from '../../composition/cognitive-wiring';

const SECRET_BYTES = new TextEncoder().encode(SUPABASE_SECRET);

async function mintToken(): Promise<string> {
  return await new SignJWT({
    sub: 'user-W',
    email: 'w@example.com',
    app_metadata: {
      tenant_id: 'tenant-W',
      tenant_name: 'W Tenant',
      roles: ['owner'],
      team_ids: [],
      environment: 'production',
    },
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('1h')
    .setSubject('user-W')
    .sign(SECRET_BYTES);
}

/** Mount with the cognitive context middleware seeded with `facts`. */
async function mountWithCognitive(
  facts: ReadonlyArray<string>,
): Promise<Hono> {
  const wired = wireCognitive({
    db: null,
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  });
  for (let i = 0; i < facts.length; i += 1) {
    await wired.cognitiveMemory?.observe(
      { content_text: facts[i]!, kind: 'fact', initial_confidence: 0.9 },
      {
        tenant_id: 'tenant-W',
        scope_id: 'tenant_root',
        specialisation: 'test-seed',
        turn_id: `seed-${i}`,
      },
    );
  }
  const app = new Hono();
  app.use(
    '*',
    createCognitiveContextMiddleware(wired) as unknown as Parameters<
      Hono['use']
    >[1],
  );
  app.route('/api/v1/brain', brainRouter);
  return app;
}

/** Mount WITHOUT the cognitive middleware (bundle absent on the context). */
function mountBare(): Hono {
  const app = new Hono();
  app.route('/api/v1/brain', brainRouter);
  return app;
}

beforeAll(() => {
  expect(process.env.SUPABASE_JWT_SECRET?.length ?? 0).toBeGreaterThanOrEqual(
    32,
  );
});

afterEach(() => {
  __resetBrainIdempotencyCache();
  __resetBrainPrivacyRouter();
  handleTurnTexts.length = 0;
});

describe('brain /turn — cognitive enrichment call-site (LP-01 / LP-30)', () => {
  it('prepends the recalled-memory block to userText before dispatch', async () => {
    const app = await mountWithCognitive([
      'Compliance certificate expires 2026-08-12',
    ]);
    const token = await mintToken();
    const res = await app.request('/api/v1/brain/turn', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      // Existing-thread path so the orchestrator's `handleTurn` (which we
      // capture) receives the enriched text.
      body: JSON.stringify({
        userText: 'compliance certificate expiry',
        threadId: 'existing-thread',
      }),
    });
    expect(res.status).toBe(200);
    expect(handleTurnTexts.length).toBe(1);
    // The enrichment block is prepended ahead of the original user text.
    expect(handleTurnTexts[0]).toMatch(/RELEVANT MEMORIES/);
    expect(handleTurnTexts[0]).toContain('compliance certificate expiry');
  });

  it('leaves userText unchanged when the cognitive bundle is absent (fail-safe)', async () => {
    const app = mountBare();
    const token = await mintToken();
    const res = await app.request('/api/v1/brain/turn', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        userText: 'plain question',
        threadId: 'existing-thread',
      }),
    });
    expect(res.status).toBe(200);
    expect(handleTurnTexts.length).toBe(1);
    expect(handleTurnTexts[0]).toBe('plain question');
    expect(handleTurnTexts[0]).not.toMatch(/RELEVANT MEMORIES/);
  });
});

describe('brain /turn — privacy-router call-site (LP-15 / LP-30)', () => {
  it('passes ordinary (INTERNAL) text through unchanged and returns 200', async () => {
    const app = mountBare();
    const token = await mintToken();
    const res = await app.request('/api/v1/brain/turn', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        userText: 'how is the night shift going',
        threadId: 'existing-thread',
      }),
    });
    expect(res.status).toBe(200);
    expect(handleTurnTexts[0]).toBe('how is the night shift going');
  });

  it('PII-strips a CONFIDENTIAL payload (M-Pesa id) before the orchestrator sees it', async () => {
    const app = mountBare();
    const token = await mintToken();
    const mpesaId = 'MPESAQGH1234XY';
    const res = await app.request('/api/v1/brain/turn', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        userText: `please reconcile payment ${mpesaId} for the royalty`,
        threadId: 'existing-thread',
      }),
    });
    expect(res.status).toBe(200);
    expect(handleTurnTexts.length).toBe(1);
    // The raw M-Pesa id must NOT have reached the provider — it was stripped
    // by the privacy router's CONFIDENTIAL branch before dispatch.
    expect(handleTurnTexts[0]).not.toContain(mpesaId);
    // The surrounding (non-PII) text survives.
    expect(handleTurnTexts[0]).toContain('royalty');
  });
});
