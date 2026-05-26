/**
 * OpenAPI document emitter — real introspection, not a stub.
 *
 * ## What this module does
 *
 * At runtime, walks every mounted Hono router on the gateway, consults
 * the `openapi/schema-registry` for Zod request/response metadata, and
 * emits an OpenAPI 3.1 document via `@asteasolutions/zod-to-openapi`
 * (the same engine `@hono/zod-openapi` uses internally).
 *
 * ## Endpoints exposed
 *
 *   GET /openapi.json  — the generated spec
 *   GET /docs          — Swagger UI (loaded from swagger-ui CDN)
 *
 * ## Why not OpenAPIHono everywhere?
 *
 * Every existing router uses `@hono/zod-validator`. Converting all 40+
 * routers to `OpenAPIHono` + `createRoute` would touch every file with
 * behavioural risk. Instead routers register metadata declaratively in
 * `openapi/manifests.ts`; routes without manifests still appear in the
 * spec with a minimal path item so the spec is exhaustive by default.
 *
 * ## How to add a route to the spec
 *
 * 1. Write the Hono handler normally.
 * 2. Add a `registerRoute({ prefix, method, path, ... })` call in
 *    `openapi/manifests.ts` (or anywhere imported before the first
 *    `/openapi.json` request).
 * 3. Done — refresh `/openapi.json`.
 */

import { Hono } from 'hono';
import type { BuildSpecOptions, MountedRouter } from './openapi/route-harvester';
import { buildOpenApiSpec } from './openapi/route-harvester';

// Eagerly load the manifests so registerRoute() runs at module-load
// time. Any consumer importing this file gets the full spec.
import './openapi/manifests';

export type OpenApiDocumentOptions = BuildSpecOptions;

export interface CreateOpenApiRouterOptions extends OpenApiDocumentOptions {
  /** Routers to harvest. Prefix is relative to the `/api/v1` base. */
  mountedRouters: MountedRouter[];
  /** Override the spec URL that Swagger UI points at. Defaults to `./openapi.json`. */
  swaggerSpecUrl?: string;
}

/**
 * Build the OpenAPI JSON document for the gateway. Pure function —
 * given the same routers + registry state it returns the same spec.
 */
export function generateOpenApiDocument(
  options: CreateOpenApiRouterOptions
): Record<string, unknown> {
  return buildOpenApiSpec(options.mountedRouters, {
    ...(options.title !== undefined ? { title: options.title } : {}),
    ...(options.version !== undefined ? { version: options.version } : {}),
    ...(options.description !== undefined ? { description: options.description } : {}),
    ...(options.servers !== undefined ? { servers: options.servers } : {}),
  });
}

/**
 * Create a Hono sub-app that serves the OpenAPI spec + Swagger UI.
 * Typically mounted under `/api/v1` so the spec lives at
 * `/api/v1/openapi.json` and the UI at `/api/v1/docs`.
 */
export function createOpenApiRouter(
  options: CreateOpenApiRouterOptions
): Hono {
  const app = new Hono();

  // Build the spec lazily on first request so routers that are
  // registered AFTER this factory runs (hot-reload, tests) are still
  // picked up. Cache the result for the life of the process.
  let cachedSpec: Record<string, unknown> | null = null;
  const spec = (): Record<string, unknown> => {
    if (!cachedSpec) cachedSpec = generateOpenApiDocument(options);
    return cachedSpec;
  };

  app.get('/openapi.json', (c) => c.json(spec()));

  // Swagger UI via CDN — avoids bundling a few MB of static assets.
  // The shell references `./openapi.json` so the page works regardless
  // of where the router is mounted (relative URL).
  const specUrl = options.swaggerSpecUrl ?? './openapi.json';
  app.get('/docs', (c) =>
    c.html(renderSwaggerHtml(options.title ?? 'BORJIE API', specUrl))
  );

  return app;
}

/**
 * Legacy backwards-compatible stub — preserved so existing callers
 * that imported `buildStubOpenApiSpec` do not break. The new
 * `generateOpenApiDocument` is the preferred entry point.
 *
 * @deprecated use `generateOpenApiDocument`
 */
export function buildStubOpenApiSpec(
  options: OpenApiDocumentOptions = {}
): Record<string, unknown> {
  return generateOpenApiDocument({ ...options, mountedRouters: [] });
}

function renderSwaggerHtml(title: string, specUrl: string): string {
  // Basic Swagger UI shell. CDN pinned to a known-good major.
  const safeTitle = title.replace(/[<>&]/g, (c) => `&#${c.charCodeAt(0)};`);
  const safeUrl = specUrl.replace(/"/g, '&quot;');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${safeTitle} — API Docs</title>
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui.css" />
</head>
<body style="margin:0">
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5.17.14/swagger-ui-bundle.js" crossorigin></script>
  <script>
    window.addEventListener('load', function () {
      window.ui = SwaggerUIBundle({
        url: "${safeUrl}",
        dom_id: '#swagger-ui',
        deepLinking: true,
        persistAuthorization: true,
        filter: true,
      });
    });
  </script>
</body>
</html>`;
}
