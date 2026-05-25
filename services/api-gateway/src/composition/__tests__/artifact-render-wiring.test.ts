/**
 * Piece-G artifact render wiring tests.
 *
 * Verifies:
 *   - createArtifactRenderService orchestrates artifact lookup +
 *     stub render + cache write
 *   - Cache hit on the second invocation skips the renderer
 *   - Unknown artifact ids reject
 *   - Unknown component_types reject
 *   - Stub renderer produces a valid PNG and a valid PDF for ≥3
 *     catalog entries (a kpi_tile, a bar_chart and a markdown card)
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createArtifactRenderService,
  createStubArtifactRenderer,
  isArtifactOutputFormat,
  type ArtifactRenderer,
  type ArtifactRepository,
  type ArtifactRenderCacheRepository,
  type RenderedArtifact,
} from '../artifact-render-wiring';
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
    async findById(tenantId, id): Promise<UiArtifactRow | null> {
      return rows.find((r) => r.id === id && r.tenantId === tenantId) ?? null;
    },
    async insert(_row): Promise<void> {
      // no-op
    },
  };
}

function makeInMemoryCache(): ArtifactRenderCacheRepository & {
  readonly map: Map<string, RenderedArtifact>;
} {
  const map = new Map<string, RenderedArtifact>();
  const key = (id: string, format: string) => `${id}::${format}`;
  return {
    map,
    async findCached(artifactId, format): Promise<RenderedArtifact | null> {
      return map.get(key(artifactId, format)) ?? null;
    },
    async upsertCached(artifactId, format, rendered): Promise<void> {
      map.set(key(artifactId, format), rendered);
    },
    async invalidate(artifactId): Promise<void> {
      for (const k of map.keys()) {
        if (k.startsWith(`${artifactId}::`)) map.delete(k);
      }
    },
  };
}

describe('isArtifactOutputFormat', () => {
  it('accepts png/pdf/svg/html', () => {
    expect(isArtifactOutputFormat('png')).toBe(true);
    expect(isArtifactOutputFormat('pdf')).toBe(true);
    expect(isArtifactOutputFormat('svg')).toBe(true);
    expect(isArtifactOutputFormat('html')).toBe(true);
  });
  it('rejects unsupported formats', () => {
    expect(isArtifactOutputFormat('gif')).toBe(false);
    expect(isArtifactOutputFormat('webp')).toBe(false);
    expect(isArtifactOutputFormat(123)).toBe(false);
    expect(isArtifactOutputFormat(undefined)).toBe(false);
  });
});

describe('createStubArtifactRenderer', () => {
  it('renders a valid PNG (magic header bytes)', async () => {
    const r = createStubArtifactRenderer();
    const out = await r.render(makeArtifact(), 'png');
    expect(out.contentType).toBe('image/png');
    expect(out.sizeBytes).toBeGreaterThan(0);
    expect(out.contentHash).toHaveLength(64);
    // PNG magic: 89 50 4E 47 0D 0A 1A 0A
    expect(Array.from(out.bytes.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  it('renders a valid PDF (magic header)', async () => {
    const r = createStubArtifactRenderer();
    const out = await r.render(makeArtifact(), 'pdf');
    expect(out.contentType).toBe('application/pdf');
    const header = new TextDecoder().decode(out.bytes.slice(0, 5));
    expect(header).toBe('%PDF-');
  });

  it('renders a valid SVG with xmlns', async () => {
    const r = createStubArtifactRenderer();
    const out = await r.render(makeArtifact(), 'svg');
    expect(out.contentType).toBe('image/svg+xml');
    const body = new TextDecoder().decode(out.bytes);
    expect(body).toContain('<svg');
    expect(body).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it('renders multiple distinct catalog component types', async () => {
    const r = createStubArtifactRenderer();
    const kinds: Array<UiArtifactRow> = [
      makeArtifact({ id: 'a', componentType: 'kpi_tile' }),
      makeArtifact({ id: 'b', componentType: 'bar_chart', props: { xField: 'm', yField: 'v' }, data: { rows: [] } }),
      makeArtifact({ id: 'c', componentType: 'markdown', props: { markdown: '# hi' }, data: {} }),
    ];
    for (const k of kinds) {
      const out = await r.render(k, 'png');
      expect(out.bytes.byteLength).toBeGreaterThan(0);
    }
  });
});

describe('createArtifactRenderService', () => {
  it('returns the renderer output and caches it on first hit', async () => {
    const renderer = createStubArtifactRenderer();
    const spy = vi.spyOn(renderer, 'render');
    const cache = makeInMemoryCache();
    const svc = createArtifactRenderService({
      renderer,
      artifactRepository: makeArtifactRepo([makeArtifact()]),
      cacheRepository: cache,
    });

    const out = await svc.render('tenant-1', 'artifact-1', 'png');
    expect(out.contentType).toBe('image/png');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(cache.map.size).toBe(1);
  });

  it('serves from cache on the second call without re-rendering', async () => {
    const renderer = createStubArtifactRenderer();
    const spy = vi.spyOn(renderer, 'render');
    const cache = makeInMemoryCache();
    const svc = createArtifactRenderService({
      renderer,
      artifactRepository: makeArtifactRepo([makeArtifact()]),
      cacheRepository: cache,
    });

    await svc.render('tenant-1', 'artifact-1', 'png');
    await svc.render('tenant-1', 'artifact-1', 'png');
    await svc.render('tenant-1', 'artifact-1', 'png');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('forceRefresh bypasses the cache', async () => {
    const renderer = createStubArtifactRenderer();
    const spy = vi.spyOn(renderer, 'render');
    const cache = makeInMemoryCache();
    const svc = createArtifactRenderService({
      renderer,
      artifactRepository: makeArtifactRepo([makeArtifact()]),
      cacheRepository: cache,
    });

    await svc.render('tenant-1', 'artifact-1', 'png');
    await svc.render('tenant-1', 'artifact-1', 'png', { forceRefresh: true });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('throws for unknown artifact id', async () => {
    const renderer = createStubArtifactRenderer();
    const svc = createArtifactRenderService({
      renderer,
      artifactRepository: makeArtifactRepo([]),
      cacheRepository: makeInMemoryCache(),
    });
    await expect(svc.render('tenant-1', 'missing', 'png')).rejects.toThrow(
      /artifact not found/,
    );
  });

  it('throws for unknown component_type', async () => {
    const renderer = createStubArtifactRenderer();
    const svc = createArtifactRenderService({
      renderer,
      artifactRepository: makeArtifactRepo([makeArtifact({ componentType: 'bogus' })]),
      cacheRepository: makeInMemoryCache(),
    });
    await expect(svc.render('tenant-1', 'artifact-1', 'png')).rejects.toThrow(
      /unknown component_type/,
    );
  });

  it('rejects unsupported format', async () => {
    const renderer = createStubArtifactRenderer();
    const svc = createArtifactRenderService({
      renderer,
      artifactRepository: makeArtifactRepo([makeArtifact()]),
      cacheRepository: makeInMemoryCache(),
    });
    await expect(
      // @ts-expect-error — intentionally wrong format
      svc.render('tenant-1', 'artifact-1', 'gif'),
    ).rejects.toThrow(/unsupported render format/);
  });

  it('rejects non-SSR component types for PNG / PDF', async () => {
    const renderer: ArtifactRenderer = createStubArtifactRenderer();
    // video is ssrCapable=false in catalog
    const svc = createArtifactRenderService({
      renderer,
      artifactRepository: makeArtifactRepo([
        makeArtifact({
          componentType: 'video',
          props: { title: 'Walk-through' },
          data: { url: 'https://example.com/v.mp4', mimeType: 'video/mp4' },
        }),
      ]),
      cacheRepository: makeInMemoryCache(),
    });
    await expect(svc.render('tenant-1', 'artifact-1', 'png')).rejects.toThrow(
      /not SSR-capable/,
    );
  });
});
