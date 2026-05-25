/**
 * /api/v1/artifacts router tests — stub renderer + stub repo.
 *
 * Verifies HTTP contract:
 *   * GET /types returns the catalog summary
 *   * GET /:id/render returns bytes + correct content-type for PNG/PDF/SVG
 *   * 401 when no tenant context
 *   * 400 for unsupported format
 *   * 404 for missing artifact
 *   * 422 for non-SSR-capable component_type
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import {
  createArtifactRenderService,
  createStubArtifactRenderer,
  type ArtifactRepository,
  type ArtifactRenderCacheRepository,
  type RenderedArtifact,
} from '../../composition/artifact-render-wiring';
import { createArtifactsRouter } from '../artifacts.hono';
import type { UiArtifactRow } from '@borjie/genui/server';

function makeArtifact(overrides: Partial<UiArtifactRow> = {}): UiArtifactRow {
  return {
    id: 'artifact-1',
    tenantId: 'tenant-1',
    componentType: 'kpi_tile',
    props: { label: 'MRR', format: 'currency', currency: 'TZS' },
    data: { value: 1234, delta: 0.1, deltaDirection: 'up' },
    version: 1,
    createdAt: '2026-05-22T10:00:00Z',
    ...overrides,
  };
}

function makeArtifactRepo(rows: ReadonlyArray<UiArtifactRow>): ArtifactRepository {
  return {
    async findById(tenantId, id) {
      return rows.find((r) => r.id === id && r.tenantId === tenantId) ?? null;
    },
    async insert() {},
  };
}

function makeInMemoryCache(): ArtifactRenderCacheRepository {
  const map = new Map<string, RenderedArtifact>();
  const key = (id: string, format: string) => `${id}::${format}`;
  return {
    async findCached(artifactId, format) {
      return map.get(key(artifactId, format)) ?? null;
    },
    async upsertCached(artifactId, format, rendered) {
      map.set(key(artifactId, format), rendered);
    },
    async invalidate(artifactId) {
      for (const k of map.keys()) {
        if (k.startsWith(`${artifactId}::`)) map.delete(k);
      }
    },
  };
}

function makeRouter(artifacts: ReadonlyArray<UiArtifactRow>, tenantId: string | null = 'tenant-1') {
  const service = createArtifactRenderService({
    renderer: createStubArtifactRenderer(),
    artifactRepository: makeArtifactRepo(artifacts),
    cacheRepository: makeInMemoryCache(),
  });
  const router = createArtifactsRouter({
    service,
    resolveTenantId: () => tenantId,
  });
  const app = new Hono();
  app.route('/api/v1/artifacts', router);
  return app;
}

describe('GET /api/v1/artifacts/types', () => {
  it('returns the catalog summary', async () => {
    const app = makeRouter([]);
    const res = await app.request('/api/v1/artifacts/types');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { types: ReadonlyArray<{ key: string }> };
    expect(body.types.length).toBeGreaterThanOrEqual(30);
    const keys = body.types.map((t) => t.key);
    expect(keys).toContain('kpi_tile');
    expect(keys).toContain('bar_chart');
    expect(keys).toContain('markdown');
  });
});

describe('GET /api/v1/artifacts/:id/render', () => {
  it('returns PNG bytes with the correct content-type', async () => {
    const app = makeRouter([makeArtifact()]);
    const res = await app.request('/api/v1/artifacts/artifact-1/render?format=png');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    const buf = await res.arrayBuffer();
    expect(buf.byteLength).toBeGreaterThan(0);
    // PNG magic
    const head = new Uint8Array(buf).slice(0, 8);
    expect(Array.from(head)).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  it('returns PDF bytes for ?format=pdf', async () => {
    const app = makeRouter([makeArtifact()]);
    const res = await app.request('/api/v1/artifacts/artifact-1/render?format=pdf');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    const buf = await res.arrayBuffer();
    expect(new TextDecoder().decode(buf.slice(0, 5))).toBe('%PDF-');
  });

  it('returns SVG bytes for ?format=svg', async () => {
    const app = makeRouter([makeArtifact()]);
    const res = await app.request('/api/v1/artifacts/artifact-1/render?format=svg');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/svg+xml');
    const txt = await res.text();
    expect(txt).toContain('<svg');
  });

  it('400 for unsupported format', async () => {
    const app = makeRouter([makeArtifact()]);
    const res = await app.request('/api/v1/artifacts/artifact-1/render?format=gif');
    expect(res.status).toBe(400);
  });

  it('401 when no tenant context', async () => {
    const app = makeRouter([makeArtifact()], null);
    const res = await app.request('/api/v1/artifacts/artifact-1/render?format=png');
    expect(res.status).toBe(401);
  });

  it('404 for missing artifact', async () => {
    const app = makeRouter([]);
    const res = await app.request('/api/v1/artifacts/missing/render?format=png');
    expect(res.status).toBe(404);
  });

  it('422 for non-SSR-capable component_type (video → png)', async () => {
    const app = makeRouter([
      makeArtifact({
        componentType: 'video',
        props: { title: 'Walk-through' },
        data: { url: 'https://example.com/v.mp4', mimeType: 'video/mp4' },
      }),
    ]);
    const res = await app.request('/api/v1/artifacts/artifact-1/render?format=png');
    expect(res.status).toBe(422);
  });

  it('caches subsequent identical requests (content-hash stable)', async () => {
    const app = makeRouter([makeArtifact()]);
    const a = await app.request('/api/v1/artifacts/artifact-1/render?format=png');
    const b = await app.request('/api/v1/artifacts/artifact-1/render?format=png');
    expect(a.headers.get('x-artifact-hash')).toEqual(b.headers.get('x-artifact-hash'));
  });

  it('blocks cross-tenant reads (artifact belongs to a different tenant)', async () => {
    // The repository scopes by tenant_id; a caller whose tenant is
    // `tenant-2` requesting an artifact owned by `tenant-1` must NOT
    // see it (returns 404 since the row is filtered out — the same
    // behaviour Postgres RLS produces at the DB layer).
    const app = makeRouter([makeArtifact({ tenantId: 'tenant-1' })], 'tenant-2');
    const res = await app.request('/api/v1/artifacts/artifact-1/render?format=png');
    expect(res.status).toBe(404);
  });
});
