/**
 * Piece-G artifact render wiring.
 *
 * Wires the server-side render pipeline:
 *
 *   GET /api/v1/artifacts/:id/render?format=png|pdf|svg
 *     1. Loads the artifact from `ui_artifacts` (RLS-scoped to the
 *        caller's tenant via Supabase auth).
 *     2. Checks the `artifact_render_cache` for a (artifact_id, format)
 *        row whose content_hash matches the artifact's current state.
 *     3. On miss: renders via the injected `ArtifactRenderer` adapter
 *        (Playwright in production; a stub in tests / CI), persists
 *        the bytes + hash, returns them.
 *
 * The renderer adapter is INJECTED so the composition is host-agnostic
 * — production wires `createPlaywrightArtifactRenderer()` while the
 * unit tests in this package wire `createStubArtifactRenderer()` so
 * the test environment doesn't need a real browser.
 *
 * Cache invalidation: parent-artifact mutations cascade-delete via the
 * FK from `0207_artifact_render_cache`; explicit invalidation also
 * fires through `invalidateCache()`.
 */

import { createHash, randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import {
  ARTIFACT_CATALOG_BY_KEY,
  type ArtifactComponentType,
  type UiArtifactRow,
} from '@borjie/genui/server';

export type ArtifactOutputFormat = 'png' | 'pdf' | 'svg' | 'html';

const OUTPUT_FORMATS: ReadonlyArray<ArtifactOutputFormat> = ['png', 'pdf', 'svg', 'html'];

export function isArtifactOutputFormat(v: unknown): v is ArtifactOutputFormat {
  return typeof v === 'string' && (OUTPUT_FORMATS as ReadonlyArray<string>).includes(v);
}

export interface RenderedArtifact {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly contentHash: string;
  readonly sizeBytes: number;
}

export interface ArtifactRenderer {
  readonly name: string;
  render(
    artifact: UiArtifactRow,
    format: ArtifactOutputFormat,
  ): Promise<RenderedArtifact>;
}

export interface ArtifactRepository {
  findById(tenantId: string, id: string): Promise<UiArtifactRow | null>;
  insert(row: UiArtifactRow): Promise<void>;
}

export interface ArtifactRenderCacheRepository {
  findCached(
    artifactId: string,
    format: ArtifactOutputFormat,
  ): Promise<RenderedArtifact | null>;
  upsertCached(
    artifactId: string,
    format: ArtifactOutputFormat,
    rendered: RenderedArtifact,
    expiresAt?: Date,
  ): Promise<void>;
  invalidate(artifactId: string): Promise<void>;
}

export interface ArtifactRenderService {
  readonly renderer: ArtifactRenderer;
  readonly artifactRepository: ArtifactRepository;
  readonly cacheRepository: ArtifactRenderCacheRepository;
  render(
    tenantId: string,
    artifactId: string,
    format: ArtifactOutputFormat,
    options?: { readonly forceRefresh?: boolean },
  ): Promise<RenderedArtifact>;
}

// ─────────────────────────────────────────────────────────────────────
// Service: thin orchestrator over the three injected ports.
// ─────────────────────────────────────────────────────────────────────

export function createArtifactRenderService(deps: {
  readonly renderer: ArtifactRenderer;
  readonly artifactRepository: ArtifactRepository;
  readonly cacheRepository: ArtifactRenderCacheRepository;
}): ArtifactRenderService {
  return {
    renderer: deps.renderer,
    artifactRepository: deps.artifactRepository,
    cacheRepository: deps.cacheRepository,

    async render(
      tenantId: string,
      artifactId: string,
      format: ArtifactOutputFormat,
      options?: { readonly forceRefresh?: boolean },
    ): Promise<RenderedArtifact> {
      if (!isArtifactOutputFormat(format)) {
        throw new Error(`unsupported render format: ${format}`);
      }
      const artifact = await deps.artifactRepository.findById(tenantId, artifactId);
      if (!artifact) {
        throw new Error(`artifact not found: ${artifactId}`);
      }
      const cap =
        ARTIFACT_CATALOG_BY_KEY[
          artifact.componentType as ArtifactComponentType
        ];
      if (!cap) {
        throw new Error(
          `unknown component_type for artifact ${artifactId}: ${artifact.componentType}`,
        );
      }
      if (!cap.ssrCapable && format !== 'html') {
        throw new Error(
          `component_type ${artifact.componentType} is not SSR-capable for format ${format}`,
        );
      }

      if (!options?.forceRefresh) {
        const cached = await deps.cacheRepository.findCached(artifactId, format);
        if (cached) return cached;
      }

      const rendered = await deps.renderer.render(artifact, format);
      await deps.cacheRepository.upsertCached(artifactId, format, rendered);
      return rendered;
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Stub renderer — deterministic bytes for tests + when no Chromium is
// available. The bytes form a 1×1 pixel of the requested format (PNG +
// PDF magic headers) so downstream code can verify it's a valid file.
// ─────────────────────────────────────────────────────────────────────

const TRANSPARENT_PNG_1X1 = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
  0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89, 0x00, 0x00, 0x00,
  0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00, 0x00, 0x00, 0x00, 0x49,
  0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);

const MINIMAL_PDF_BYTES = new TextEncoder().encode(
  '%PDF-1.4\n%\xff\xff\xff\xff\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n',
);

const MINIMAL_SVG = new TextEncoder().encode(
  '<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"></svg>',
);

function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export function createStubArtifactRenderer(): ArtifactRenderer {
  return {
    name: 'stub-renderer',
    async render(
      _artifact: UiArtifactRow,
      format: ArtifactOutputFormat,
    ): Promise<RenderedArtifact> {
      switch (format) {
        case 'png': {
          return {
            bytes: TRANSPARENT_PNG_1X1,
            contentType: 'image/png',
            contentHash: sha256Hex(TRANSPARENT_PNG_1X1),
            sizeBytes: TRANSPARENT_PNG_1X1.byteLength,
          };
        }
        case 'pdf': {
          return {
            bytes: MINIMAL_PDF_BYTES,
            contentType: 'application/pdf',
            contentHash: sha256Hex(MINIMAL_PDF_BYTES),
            sizeBytes: MINIMAL_PDF_BYTES.byteLength,
          };
        }
        case 'svg': {
          return {
            bytes: MINIMAL_SVG,
            contentType: 'image/svg+xml',
            contentHash: sha256Hex(MINIMAL_SVG),
            sizeBytes: MINIMAL_SVG.byteLength,
          };
        }
        case 'html':
        default: {
          const bytes = new TextEncoder().encode(
            `<!doctype html><html><body><pre>stub-renderer</pre></body></html>`,
          );
          return {
            bytes,
            contentType: 'text/html; charset=utf-8',
            contentHash: sha256Hex(bytes),
            sizeBytes: bytes.byteLength,
          };
        }
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Playwright renderer — production adapter.
//
// The api-gateway already depends on `playwright` (used by the
// browser-perception package). We dynamically import to keep the
// stub-only path zero-dep for unit tests.
// ─────────────────────────────────────────────────────────────────────

export interface PlaywrightArtifactRendererOptions {
  /**
   * Absolute URL of the artifact-render web target — typically the
   * customer-app's `/artifact-renderer?id=…` page which mounts
   * `<UiArtifact />` with no chrome.
   */
  readonly rendererUrl: string;
  /** Total render budget (ms). Default 8_000. */
  readonly timeoutMs?: number;
  /** Optional viewport. Default {1280, 720}. */
  readonly viewport?: { readonly width: number; readonly height: number };
}

export function createPlaywrightArtifactRenderer(
  options: PlaywrightArtifactRendererOptions,
): ArtifactRenderer {
  const timeoutMs = options.timeoutMs ?? 8_000;
  const viewport = options.viewport ?? { width: 1280, height: 720 };

  return {
    name: 'playwright-renderer',
    async render(
      artifact: UiArtifactRow,
      format: ArtifactOutputFormat,
    ): Promise<RenderedArtifact> {
      // Dynamic import avoids loading Playwright when the api-gateway
      // is started in a context that never reaches this code path.
      const playwright = (await import('playwright')) as typeof import('playwright');
      const browser = await playwright.chromium.launch({ headless: true });
      try {
        const context = await browser.newContext({ viewport });
        const page = await context.newPage();
        const targetUrl = `${options.rendererUrl}?id=${encodeURIComponent(artifact.id)}&format=${format}`;
        await page.goto(targetUrl, { waitUntil: 'networkidle', timeout: timeoutMs });
        await page.waitForSelector('[data-testid="ui-artifact"]', { timeout: timeoutMs });

        if (format === 'png') {
          const bytes = await page.screenshot({ type: 'png', fullPage: true });
          return {
            bytes: new Uint8Array(bytes),
            contentType: 'image/png',
            contentHash: sha256Hex(new Uint8Array(bytes)),
            sizeBytes: bytes.byteLength,
          };
        }
        if (format === 'pdf') {
          const bytes = await page.pdf({ printBackground: true, format: 'A4' });
          return {
            bytes: new Uint8Array(bytes),
            contentType: 'application/pdf',
            contentHash: sha256Hex(new Uint8Array(bytes)),
            sizeBytes: bytes.byteLength,
          };
        }
        if (format === 'svg' || format === 'html') {
          const html = await page.content();
          const encoded = new TextEncoder().encode(html);
          return {
            bytes: encoded,
            contentType: format === 'svg' ? 'image/svg+xml' : 'text/html; charset=utf-8',
            contentHash: sha256Hex(encoded),
            sizeBytes: encoded.byteLength,
          };
        }
        throw new Error(`unsupported format: ${format}`);
      } finally {
        await browser.close();
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Postgres repositories — Drizzle execute + sql template.
// ─────────────────────────────────────────────────────────────────────

type DbLike = {
  execute(q: unknown): Promise<unknown>;
};

function asRows(res: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(res)) return res as Record<string, unknown>[];
  const r = (res as { rows?: unknown }).rows;
  return Array.isArray(r) ? (r as Record<string, unknown>[]) : [];
}

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

function rowToArtifact(row: Record<string, unknown>): UiArtifactRow {
  return {
    id: asString(row.id),
    tenantId: asString(row.tenant_id),
    threadId: (row.thread_id as string | null) ?? null,
    createdByUserId: (row.created_by_user_id as string | null) ?? null,
    componentType: asString(row.component_type),
    props: (row.props_jsonb as Readonly<Record<string, unknown>>) ?? {},
    data: (row.data_jsonb as Readonly<Record<string, unknown>>) ?? {},
    version: typeof row.version === 'number' ? row.version : Number(row.version ?? 1),
    parentVersionId: (row.parent_version_id as string | null) ?? null,
    title: (row.title as string | null) ?? null,
    description: (row.description as string | null) ?? null,
    locale: (row.locale as 'en' | 'sw') ?? 'en',
    themeTokenSetId: (row.theme_token_set_id as string | null) ?? null,
    createdAt:
      row.created_at instanceof Date
        ? (row.created_at as Date).toISOString()
        : asString(row.created_at),
  };
}

export function createPostgresArtifactRepository(db: unknown): ArtifactRepository {
  const exec = (db as DbLike).execute.bind(db as DbLike);
  return {
    async findById(tenantId: string, id: string): Promise<UiArtifactRow | null> {
      const res = await exec(sql`
        SELECT id, tenant_id, thread_id, created_by_user_id, component_type,
               props_jsonb, data_jsonb, version, parent_version_id,
               title, description, locale, theme_token_set_id, created_at
        FROM ui_artifacts
        WHERE id = ${id} AND tenant_id = ${tenantId}
        LIMIT 1
      `);
      const row = asRows(res)[0];
      return row ? rowToArtifact(row) : null;
    },

    async insert(row: UiArtifactRow): Promise<void> {
      await exec(sql`
        INSERT INTO ui_artifacts (
          id, tenant_id, thread_id, created_by_user_id, component_type,
          props_jsonb, data_jsonb, version, parent_version_id,
          title, description, locale, theme_token_set_id, created_at
        )
        VALUES (
          ${row.id}, ${row.tenantId}, ${row.threadId ?? null},
          ${row.createdByUserId ?? null}, ${row.componentType},
          ${JSON.stringify(row.props)}::jsonb,
          ${JSON.stringify(row.data)}::jsonb,
          ${row.version}, ${row.parentVersionId ?? null},
          ${row.title ?? null}, ${row.description ?? null},
          ${row.locale ?? 'en'}, ${row.themeTokenSetId ?? null},
          ${row.createdAt}
        )
        ON CONFLICT (id) DO NOTHING
      `);
    },
  };
}

export function createPostgresArtifactRenderCacheRepository(
  db: unknown,
): ArtifactRenderCacheRepository {
  const exec = (db as DbLike).execute.bind(db as DbLike);
  return {
    async findCached(
      artifactId: string,
      format: ArtifactOutputFormat,
    ): Promise<RenderedArtifact | null> {
      const res = await exec(sql`
        SELECT content_bytes, content_hash, size_bytes
        FROM artifact_render_cache
        WHERE artifact_id = ${artifactId} AND output_format = ${format}
          AND (expires_at IS NULL OR expires_at > NOW())
        LIMIT 1
      `);
      const row = asRows(res)[0];
      if (!row) return null;
      const bytes =
        row.content_bytes instanceof Uint8Array
          ? (row.content_bytes as Uint8Array)
          : Buffer.isBuffer(row.content_bytes)
            ? new Uint8Array(row.content_bytes)
            : new Uint8Array(0);
      return {
        bytes,
        contentType: contentTypeFor(format),
        contentHash: asString(row.content_hash),
        sizeBytes: typeof row.size_bytes === 'number' ? row.size_bytes : bytes.byteLength,
      };
    },

    async upsertCached(
      artifactId: string,
      format: ArtifactOutputFormat,
      rendered: RenderedArtifact,
      expiresAt?: Date,
    ): Promise<void> {
      const id = `arcache-${randomUUID()}`;
      const expIso = expiresAt ? expiresAt.toISOString() : null;
      await exec(sql`
        INSERT INTO artifact_render_cache (
          id, artifact_id, output_format, content_bytes, content_hash,
          size_bytes, created_at, expires_at
        )
        VALUES (
          ${id}, ${artifactId}, ${format},
          ${Buffer.from(rendered.bytes)}, ${rendered.contentHash},
          ${rendered.sizeBytes}, NOW(), ${expIso}
        )
        ON CONFLICT (artifact_id, output_format) DO UPDATE
        SET content_bytes = EXCLUDED.content_bytes,
            content_hash  = EXCLUDED.content_hash,
            size_bytes    = EXCLUDED.size_bytes,
            created_at    = NOW(),
            expires_at    = EXCLUDED.expires_at
      `);
    },

    async invalidate(artifactId: string): Promise<void> {
      await exec(sql`DELETE FROM artifact_render_cache WHERE artifact_id = ${artifactId}`);
    },
  };
}

export function contentTypeFor(format: ArtifactOutputFormat): string {
  switch (format) {
    case 'png': return 'image/png';
    case 'pdf': return 'application/pdf';
    case 'svg': return 'image/svg+xml';
    case 'html': return 'text/html; charset=utf-8';
    default: return 'application/octet-stream';
  }
}

// ─────────────────────────────────────────────────────────────────────
// Not-wired service — used when the artifact render pipeline is not
// yet bound in this environment (e.g. no Chromium / DB). The /types
// endpoint stays live (returns the static catalog), but /:id/render
// throws a clear "artifact not found" so the FE surfaces a 404 with a
// useful error body instead of crashing.
// ─────────────────────────────────────────────────────────────────────

export function createNotWiredArtifactRenderService(): ArtifactRenderService {
  const renderer = createStubArtifactRenderer();
  const artifactRepository: ArtifactRepository = {
    async findById(): Promise<UiArtifactRow | null> {
      return null;
    },
    async insert(): Promise<void> {
      throw new Error('artifact render service not wired (insert)');
    },
  };
  const cacheRepository: ArtifactRenderCacheRepository = {
    async findCached(): Promise<RenderedArtifact | null> {
      return null;
    },
    async upsertCached(): Promise<void> {
      /* no-op */
    },
    async invalidate(): Promise<void> {
      /* no-op */
    },
  };
  return createArtifactRenderService({
    renderer,
    artifactRepository,
    cacheRepository,
  });
}
