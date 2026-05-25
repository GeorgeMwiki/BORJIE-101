/**
 * Route harvester — walks mounted Hono routers and emits OpenAPI path
 * items by combining Hono's runtime `.routes` table with the schema
 * registry.
 *
 * Design rules:
 *   - Never throw for a single malformed route; log and skip.
 *   - Paths with no registry entry still produce a minimal OpenAPI path
 *     item (so the endpoint is discoverable) with a generic 401/500.
 *   - Mount prefixes are composed (e.g. `/applications` + `/route` →
 *     `/applications/route`).
 *   - Colon-style path params (`:id`) are rewritten to OpenAPI
 *     brace-style (`{id}`).
 */

import type { Hono } from 'hono';
import { z, type ZodTypeAny } from 'zod';
import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi';
import {
  getRouteMeta,
  listRegisteredRoutes,
  type OpenApiRouteMeta,
} from './schema-registry';
import { logger } from '../utils/logger.js';

// Extend Zod with `.openapi()` once at module load — `@asteasolutions/zod-to-openapi`
// reflects on schemas via a method patched onto ZodType.prototype, which
// is absent until this runs. Without the extension, `generateDocument`
// throws `schema.openapi is not a function` the first time any route
// declares request params/query/body.
extendZodWithOpenApi(z);

export interface MountedRouter {
  /** Mount prefix as seen from `/api/v1` (e.g. `/applications`). */
  prefix: string;
  /** The Hono router instance. */
  app: Hono;
  /** Optional default tag used when a route has none registered. */
  defaultTag?: string;
}

interface HarvestedRoute {
  method: string;
  /** Full path from API root (e.g. `/applications/route`). */
  fullPath: string;
  /** Path relative to the router (e.g. `/route`). */
  relPath: string;
  meta?: OpenApiRouteMeta;
  defaultTag?: string;
}

/** Valid HTTP methods we surface. Hono also exposes `all` — we skip those. */
const METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);

/**
 * Rewrite `:param` style path segments to OpenAPI `{param}` style.
 * Idempotent — already-braced segments pass through unchanged.
 */
export function normalizePathForOpenApi(path: string): string {
  return path.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}');
}

/** Join a mount prefix + a router-local path, collapsing double slashes. */
function joinPath(prefix: string, rel: string): string {
  const a = prefix.endsWith('/') ? prefix.slice(0, -1) : prefix;
  const b = rel.startsWith('/') ? rel : `/${rel}`;
  return `${a}${b}`.replace(/\/+/g, '/');
}

/** Walk a Hono app's routes table and project into HarvestedRoute entries. */
function harvestRouter(router: MountedRouter): HarvestedRoute[] {
  const out: HarvestedRoute[] = [];
  // Hono exposes `.routes: RouterRoute[]` on every instance. Middleware
  // entries share the structure but use method `ALL` or `use` — those
  // are filtered out below.
  const routes = (router.app as unknown as { routes?: Array<{ method: string; path: string }> }).routes ?? [];
  for (const r of routes) {
    const method = String(r.method || '').toLowerCase();
    if (!METHODS.has(method)) continue;
    const relPath = r.path || '/';
    const fullPath = normalizePathForOpenApi(joinPath(router.prefix, relPath));
    const meta = getRouteMeta(router.prefix, method, relPath);
    out.push({ method, fullPath, relPath, meta, defaultTag: router.defaultTag });
  }
  return out;
}

function buildResponsesFromMeta(
  meta: OpenApiRouteMeta | undefined,
  errorSchemaRef: { $ref: string }
): Record<string, unknown> {
  // Default error responses every authenticated endpoint shares. These
  // reference the shared ErrorEnvelope schema registered once at spec
  // build time.
  const defaults: Record<string, unknown> = {
    '401': {
      description: 'Unauthorized — missing or invalid bearer token.',
      content: { 'application/json': { schema: errorSchemaRef } },
    },
    '500': {
      description: 'Internal server error.',
      content: { 'application/json': { schema: errorSchemaRef } },
    },
  };

  if (!meta?.responses) {
    defaults['200'] = { description: 'Successful response.' };
    return defaults;
  }

  const out: Record<string, unknown> = { ...defaults };
  for (const [code, resp] of Object.entries(meta.responses)) {
    if (!resp) continue;
    const entry: Record<string, unknown> = { description: resp.description };
    if (resp.schema) {
      entry.content = {
        [resp.contentType ?? 'application/json']: { schema: resp.schema },
      };
    }
    out[code] = entry;
  }
  return out;
}

export interface BuildSpecOptions {
  title?: string;
  version?: string;
  description?: string;
  servers?: Array<{ url: string; description?: string }>;
}

/**
 * Build a full OpenAPI 3.1 spec from the mounted routers and the
 * schema registry.
 *
 * The function is synchronous — all inputs are in-memory — and never
 * throws. Routes that fail to serialize are replaced with a minimal
 * placeholder and logged to console.warn.
 */
export function buildOpenApiSpec(
  mounted: MountedRouter[],
  options: BuildSpecOptions = {}
): Record<string, unknown> {
  const registry = new OpenAPIRegistry();

  // Shared components — bearer auth + the canonical error envelope.
  registry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
    description: 'Bearer JWT issued by POST /auth/login.',
  });

  // Register paths.
  const errorRef = { $ref: '#/components/schemas/ErrorEnvelope' };
  const seen = new Set<string>();

  for (const router of mounted) {
    const harvested = harvestRouter(router);
    for (const hr of harvested) {
      const key = `${hr.method} ${hr.fullPath}`;
      if (seen.has(key)) continue;
      seen.add(key);

      try {
        const request: Record<string, ZodTypeAny | { content: { 'application/json': { schema: ZodTypeAny } } }> = {};
        if (hr.meta?.requestBody) {
          request.body = {
            content: { 'application/json': { schema: hr.meta.requestBody } },
          } as never;
        }
        if (hr.meta?.requestParams) request.params = hr.meta.requestParams;
        if (hr.meta?.requestQuery) request.query = hr.meta.requestQuery;

        const tags = hr.meta?.tags ?? (hr.defaultTag ? [hr.defaultTag] : []);
        const auth = hr.meta?.auth ?? 'bearer';

        registry.registerPath({
          method: hr.method as never,
          path: hr.fullPath,
          summary: hr.meta?.summary ?? `${hr.method.toUpperCase()} ${hr.fullPath}`,
          description: buildDescription(hr.meta),
          tags: tags.length ? tags : undefined,
          deprecated: hr.meta?.deprecated || undefined,
          security: auth === 'bearer' ? [{ bearerAuth: [] }] : [],
          request: Object.keys(request).length ? (request as never) : undefined,
          responses: buildResponsesFromMeta(hr.meta, errorRef) as never,
        });
      } catch (err) {
        // Surface but never abort — a single bad schema shouldn't tank
        // the whole spec.
        logger.warn(`openapi: failed to register ${hr.method} ${hr.fullPath}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // Warn about registry entries that never matched a real mounted route —
  // typos or routers that got unmounted.
  const registered = listRegisteredRoutes();
  const matched = new Set<string>();
  for (const router of mounted) {
    for (const hr of harvestRouter(router)) {
      if (hr.meta) matched.add(`${router.prefix} ${hr.method} ${hr.relPath}`);
    }
  }
  for (const r of registered) {
    const key = `${r.prefix} ${r.method} ${r.path}`;
    if (!matched.has(key)) {
      logger.warn(`openapi: registered route ${key} has no mounted handler`);
    }
  }

  const generator = new OpenApiGeneratorV31(registry.definitions);
  const doc = generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: options.title ?? 'BORJIE API',
      version: options.version ?? '1.0.0',
      description:
        options.description ??
        'Multi-tenant property management platform — full platform API.',
    },
    servers: options.servers ?? [
      { url: '/api/v1', description: 'Default relative base path' },
    ],
  });

  // Inject the canonical ErrorEnvelope schema. Done here rather than
  // via zod so the envelope is stable regardless of future zod changes.
  const components = (doc.components ??= {} as never) as {
    schemas?: Record<string, unknown>;
  };
  components.schemas ??= {};
  components.schemas.ErrorEnvelope = {
    type: 'object',
    properties: {
      success: { type: 'boolean', const: false },
      error: {
        type: 'object',
        properties: {
          code: { type: 'string' },
          message: { type: 'string' },
          requestId: { type: 'string' },
          details: {},
        },
        required: ['code', 'message'],
      },
    },
    required: ['error'],
  };

  return doc as unknown as Record<string, unknown>;
}

function buildDescription(meta: OpenApiRouteMeta | undefined): string | undefined {
  if (!meta) return undefined;
  const parts: string[] = [];
  if (meta.description) parts.push(meta.description);
  if (meta.permissions?.length) {
    parts.push(`**Required permissions:** ${meta.permissions.map((p) => `\`${p}\``).join(', ')}`);
  }
  if (meta.rateLimit) {
    parts.push(`**Rate limit bucket:** \`${meta.rateLimit}\``);
  }
  return parts.length ? parts.join('\n\n') : undefined;
}
