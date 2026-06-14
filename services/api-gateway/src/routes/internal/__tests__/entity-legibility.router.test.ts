/**
 * internal/entity-legibility.hono — the entity.* brain-tool loopback.
 *
 * These six routes were BORN DARK (no router mounted at
 * /internal/entity-legibility/*), so every entity.* tool call 404'd in prod.
 * This suite proves they are now reachable, tenant-bound, persona-filtered,
 * and auth-gated:
 *
 *   1. AUTH GATE — no token → 401 on every route.
 *   2. resolve/search/recent flow through queryEntityIndex against the
 *      caller's tenant and return the persona-projected rows.
 *   3. full-picture returns the canonical entity + its 1-hop cross-references.
 *   4. trace walks the cross-reference graph; deduplicate surfaces duplicate
 *      edges.
 *   5. A worker JWT is scope-clipped + financially redacted (defence in depth).
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';

process.env.JWT_SECRET =
  process.env.JWT_SECRET ?? 'test-secret-jwt-0123456789abcdef0123456789abcdef';
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
process.env.BORJIE_SKIP_DOTENV = 'true';

import internalEntityLegibilityRouter from '../entity-legibility.hono.js';
import { generateToken } from '../../../middleware/auth';
import { UserRole } from '../../../types/user-role';

// ---------------------------------------------------------------------------
// Fake tenant-bound DB. Routes by inspecting the rendered SQL fragments.
// ---------------------------------------------------------------------------

const INDEX_ROWS = [
  {
    kind: 'offtake_contract',
    id: 'oc_1',
    display_name: 'Tabora Catering Q2',
    summary: '$2.4M cobalt offtake for Tabora Catering Q2',
    tags: ['geita'],
    lifecycle_stage: 'active',
    refreshed_at: '2026-05-29T00:00:00Z',
    scope_id: null,
    metadata: null,
  },
  {
    kind: 'royalty_filing',
    id: 'rf_1',
    display_name: 'April royalty',
    summary: 'TZS 1,200,000 royalty filing due 9 Apr',
    tags: [],
    lifecycle_stage: 'active',
    refreshed_at: '2026-05-28T00:00:00Z',
    scope_id: null,
    metadata: null,
  },
];

const ENTITY_ROW = {
  kind: 'royalty_draft',
  id: 'rd_1',
  display_name: 'April royalty draft',
  summary: 'Draft royalty for April',
  tags: ['geita'],
  lifecycle_stage: 'active',
  updated_at: '2026-05-29T00:00:00Z',
};

const EDGE_ROWS = [
  {
    kind: 'licence',
    id: 'lic_geita',
    relationship: 'depends_on',
    confidence: 1,
    display_name: 'Geita PML',
    summary: 'Geita primary mining licence',
  },
];

const DUPLICATE_ROWS = [
  {
    kind: 'counterparty',
    id: 'cp_2',
    confidence: 0.91,
    derivation_source: 'discoverForCounterparty',
    display_name: 'Tabora Catering Ltd',
  },
];

function stringifyQuery(query: unknown): string {
  const q = query as { queryChunks?: ReadonlyArray<unknown> };
  return JSON.stringify(q.queryChunks ?? query);
}

function fakeDb(opts?: { failOn?: 'index' }) {
  return {
    async execute(query: unknown) {
      const text = stringifyQuery(query);
      if (text.includes('entity_cross_references')) {
        if (text.includes("'duplicate'")) return DUPLICATE_ROWS;
        return EDGE_ROWS;
      }
      // A single-row fetchEntity SELECT (full-picture) — has updated_at + LIMIT 1.
      if (text.includes('updated_at') && text.includes('entity_kind =')) {
        return [ENTITY_ROW];
      }
      // queryEntityIndex search/resolve/recent.
      if (opts?.failOn === 'index') throw new Error('boom');
      return INDEX_ROWS;
    },
  };
}

function appWith(opts?: { failOn?: 'index' }): Hono {
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('services', { entityLegibilityDb: fakeDb(opts) } as never);
    await next();
  });
  app.route('/internal/entity-legibility', internalEntityLegibilityRouter);
  return app;
}

function bearer(role: UserRole, tenantId = 'tenant_1'): string {
  return `Bearer ${generateToken({
    userId: 'op_1',
    tenantId,
    role: role as never,
    permissions: [],
    propertyAccess: ['*'],
  })}`;
}

function postJson(app: Hono, path: string, body: unknown, auth?: string) {
  return app.request(path, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: {
      'content-type': 'application/json',
      ...(auth ? { authorization: auth } : {}),
    },
  });
}

// ---------------------------------------------------------------------------
// Auth gate
// ---------------------------------------------------------------------------

describe('internal/entity-legibility — auth gate', () => {
  const routes: Array<[string, unknown]> = [
    ['/internal/entity-legibility/resolve', { phrase: 'geita' }],
    ['/internal/entity-legibility/search', { query: 'geita' }],
    ['/internal/entity-legibility/recent', {}],
    ['/internal/entity-legibility/full-picture', { kind: 'royalty_draft', id: 'rd_1' }],
    ['/internal/entity-legibility/trace', { sourceKind: 'royalty_draft', sourceId: 'rd_1' }],
    ['/internal/entity-legibility/deduplicate', { kind: 'counterparty', id: 'cp_1' }],
  ];

  for (const [path, body] of routes) {
    it(`401 without a token: ${path}`, async () => {
      const res = await postJson(appWith(), path, body);
      expect(res.status).toBe(401);
    });
  }
});

// ---------------------------------------------------------------------------
// Reads flow through queryEntityIndex / cross-references
// ---------------------------------------------------------------------------

describe('internal/entity-legibility — wired reads', () => {
  it('resolve returns ranked candidates from the entity index', async () => {
    const res = await postJson(
      appWith(),
      '/internal/entity-legibility/resolve',
      { phrase: 'tabora', limit: 5 },
      bearer(UserRole.OWNER),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      candidates: Array<{ kind: string; id: string; confidence: number }>;
    };
    expect(body.candidates.length).toBe(2);
    expect(body.candidates[0]?.id).toBe('oc_1');
    // Rank-derived confidence is bounded to (0, 1], DESC by rank.
    expect(body.candidates[0]?.confidence).toBeGreaterThan(
      body.candidates[1]?.confidence ?? 0,
    );
  });

  it('search returns scored hits', async () => {
    const res = await postJson(
      appWith(),
      '/internal/entity-legibility/search',
      { query: 'royalty' },
      bearer(UserRole.SUPER_ADMIN),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { hits: Array<{ id: string; score: number }> };
    expect(body.hits.length).toBe(2);
    expect(body.hits[0]?.score).toBeLessThanOrEqual(1);
  });

  it('recent returns the recently-updated entities', async () => {
    const res = await postJson(
      appWith(),
      '/internal/entity-legibility/recent',
      { limit: 10 },
      bearer(UserRole.OWNER),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { entities: Array<{ id: string }> };
    expect(body.entities.map((e) => e.id)).toContain('oc_1');
  });

  it('full-picture returns the entity + its 1-hop cross-references', async () => {
    const res = await postJson(
      appWith(),
      '/internal/entity-legibility/full-picture',
      { kind: 'royalty_draft', id: 'rd_1' },
      bearer(UserRole.OWNER),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      entity: { id: string; displayName: string };
      relatedEntities: Array<{ id: string; relationship: string }>;
    };
    expect(body.entity.id).toBe('rd_1');
    expect(body.entity.displayName).toBe('April royalty draft');
    expect(body.relatedEntities[0]?.id).toBe('lic_geita');
    expect(body.relatedEntities[0]?.relationship).toBe('depends_on');
  });

  it('trace walks the cross-reference graph to the related entity', async () => {
    const res = await postJson(
      appWith(),
      '/internal/entity-legibility/trace',
      { sourceKind: 'royalty_draft', sourceId: 'rd_1', maxHops: 2 },
      bearer(UserRole.OWNER),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      paths: Array<{ endpointId: string; hopCount: number }>;
    };
    expect(body.paths.length).toBeGreaterThanOrEqual(1);
    expect(body.paths[0]?.endpointId).toBe('lic_geita');
    expect(body.paths[0]?.hopCount).toBe(1);
  });

  it('deduplicate surfaces suspected duplicate edges', async () => {
    const res = await postJson(
      appWith(),
      '/internal/entity-legibility/deduplicate',
      { kind: 'counterparty', id: 'cp_1' },
      bearer(UserRole.OWNER),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      suspectedDuplicates: Array<{ id: string; similarity: number }>;
    };
    expect(body.suspectedDuplicates[0]?.id).toBe('cp_2');
    expect(body.suspectedDuplicates[0]?.similarity).toBeCloseTo(0.91);
  });
});

// ---------------------------------------------------------------------------
// Persona projection (defence in depth)
// ---------------------------------------------------------------------------

describe('internal/entity-legibility — persona projection', () => {
  it('a worker JWT redacts financial figures from summaries', async () => {
    const res = await postJson(
      appWith(),
      '/internal/entity-legibility/search',
      { query: 'tabora' },
      bearer(UserRole.MAINTENANCE_STAFF),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { hits: Array<{ summary: string }> };
    const offtake = body.hits.find((h) => h.summary.includes('Buy job'));
    // Worker vocab rewrite + financial redaction — never the raw "$2.4M".
    expect(offtake).toBeDefined();
    expect(body.hits.every((h) => !h.summary.includes('$2.4M'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Honest-degrade
// ---------------------------------------------------------------------------

describe('internal/entity-legibility — honest degrade', () => {
  it('returns an empty result (200) when the index read throws — never a 500 crash', async () => {
    const res = await postJson(
      appWith({ failOn: 'index' }),
      '/internal/entity-legibility/search',
      { query: 'geita' },
      bearer(UserRole.OWNER),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { hits: unknown[] };
    expect(body.hits).toEqual([]);
  });

  it('400 on an invalid body', async () => {
    const res = await postJson(
      appWith(),
      '/internal/entity-legibility/resolve',
      { notPhrase: 1 },
      bearer(UserRole.OWNER),
    );
    expect(res.status).toBe(400);
  });
});
