
/**
 * /api/v1/artifacts — Piece G GenUI artifact endpoints.
 *
 *   GET /api/v1/artifacts/:id/render?format=png|pdf|svg|html
 *     Returns rasterised bytes (cached) for the given artifact. Tenant
 *     context comes from the Supabase JWT; cross-tenant reads are
 *     blocked at the database layer by RLS.
 *
 *   GET /api/v1/artifacts/types
 *     Returns the canonical artifact catalog (the `list_artifact_types`
 *     surface, callable from the brain or the admin console).
 *
 * The router is composed in `src/composition/artifact-render-wiring.ts`
 * via `createArtifactRenderService`. Tests inject a stub renderer;
 * production wires the Playwright adapter.
 */

import { Hono } from 'hono';
import {
  listArtifactTypes,
  type UiArtifactRow,
} from '@borjie/genui/server';
import {
  isArtifactOutputFormat,
  type ArtifactRenderService,
  type ArtifactOutputFormat,
  contentTypeFor,
} from '../composition/artifact-render-wiring';

export interface ArtifactsRouterDeps {
  readonly service: ArtifactRenderService;
  /**
   * Resolves the tenant id for the current request. In production this
   * comes from Supabase JWT middleware; in tests we inject a stub.
   */
  readonly resolveTenantId: (
    c: { readonly req: { readonly header: (k: string) => string | undefined } },
  ) => string | null;
}

export function createArtifactsRouter(deps: ArtifactsRouterDeps): Hono {
  const app = new Hono();

  // ── GET /api/v1/artifacts/types — the LLM-tool surface ─────────────
  app.get('/types', (c) => {
    return c.json({ types: listArtifactTypes() });
  });

  // ── GET /api/v1/artifacts/:id/render ───────────────────────────────
  app.get('/:id/render', async (c) => {
    const tenantId = deps.resolveTenantId(c);
    if (!tenantId) {
      return c.json({ error: 'unauthorized' }, 401);
    }

    const id = c.req.param('id');
    const rawFormat = c.req.query('format') ?? 'png';
    if (!isArtifactOutputFormat(rawFormat)) {
      return c.json(
        {
          error: 'unsupported_format',
          message: `format must be one of png | pdf | svg | html`,
        },
        400,
      );
    }
    const format = rawFormat as ArtifactOutputFormat;

    try {
      const rendered = await deps.service.render(tenantId, id, format);
      const body = Buffer.isBuffer(rendered.bytes)
        ? new Uint8Array(rendered.bytes)
        : rendered.bytes;
      return new Response(body, {
        status: 200,
        headers: {
          'Content-Type': contentTypeFor(format),
          'Content-Length': String(rendered.sizeBytes),
          'Cache-Control': 'private, max-age=300',
          'X-Artifact-Hash': rendered.contentHash,
        },
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'render failed';
      if (/artifact not found/i.test(message)) {
        return c.json({ error: 'not_found', message }, 404);
      }
      if (/not SSR-capable/i.test(message) || /unknown component_type/i.test(message)) {
        return c.json({ error: 'invalid_artifact', message }, 422);
      }
      return c.json({ error: 'render_failed', message }, 500);
    }
  });

  return app;
}

/** Type helper for downstream consumers. */
export type ArtifactsRouter = ReturnType<typeof createArtifactsRouter>;
export type { UiArtifactRow };
