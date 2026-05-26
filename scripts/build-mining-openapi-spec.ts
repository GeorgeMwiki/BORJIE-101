/**
 * build-mining-openapi-spec.ts — emit `docs/openapi/borjie-mining.yaml`
 * from the Zod-OpenAPI route definitions declared in
 * `services/api-gateway/src/routes/mining/_openapi/route-defs.ts`.
 *
 * Pipeline:
 *   1. Import `migratedRoutes` (side-effect free — no DB / middleware).
 *   2. Register each route on a fresh `OpenAPIRegistry`, prefixed with
 *      the mining mount + the route's relative path.
 *   3. Generate the 3.1 document via `OpenApiGeneratorV31.generateDocument`.
 *   4. For files still marked `// TODO(openapi-migration)`, regex-scrape
 *      paths + methods so the spec still surfaces every endpoint. These
 *      get a generic `ApiSuccessEnvelope` 200 response with an
 *      `x-openapi-migration: pending` extension pointing at issue #60.
 *   5. Emit YAML.
 *
 * Invoked via `scripts/generate-openapi-spec.mjs` (which spawns `tsx`).
 */

import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
} from '@asteasolutions/zod-to-openapi';

import { migratedRoutes } from '../services/api-gateway/src/routes/mining/_openapi/route-defs';
import { toYaml } from './openapi/yaml-emitter';
import {
  scanLegacyRoutes,
  honoToOpenApiPath,
  pathParamNames,
  type LegacyRoute,
} from './openapi/legacy-route-scanner';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const MINING_ROUTES_DIR = resolve(
  REPO_ROOT,
  'services/api-gateway/src/routes/mining',
);
const OUTPUT_PATH = resolve(REPO_ROOT, 'docs/openapi/borjie-mining.yaml');
const BASE_PREFIX = '/api/v1/mining';
const MIGRATION_ISSUE_URL =
  'https://github.com/GeorgeMwiki/BORJIE-101/issues/60';

function buildPath(mount: string, routePath: string): string {
  const joined = `${BASE_PREFIX}${mount}${routePath}`.replace(/\/+/g, '/');
  return joined.length > 1 ? joined.replace(/\/$/, '') : joined;
}

interface SpecStats {
  migratedRouteCount: number;
  legacyRouteCount: number;
  totalPathCount: number;
  schemaCount: number;
  responseShapeCount: number;
}

function buildLegacyOperation(
  route: LegacyRoute,
  fullPath: string,
): Record<string, unknown> {
  const params = pathParamNames(fullPath).map((name) => ({
    name,
    in: 'path',
    required: true,
    schema: { type: 'string' },
  }));
  const op: Record<string, unknown> = {
    tags: [route.tag],
    summary: `${route.method.toUpperCase()} ${route.relativePath}`,
    operationId: `${route.tag}.${route.method}.${route.relativePath.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`,
    security: [{ BearerAuth: [] }],
    responses: {
      '200': {
        description: 'Success envelope (`{ success: true, data: ... }`).',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ApiSuccessEnvelope' },
          },
        },
      },
      '400': {
        description: 'Validation or business error.',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ApiErrorEnvelope' },
          },
        },
      },
      '401': {
        description: 'Auth missing or invalid.',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ApiErrorEnvelope' },
          },
        },
      },
      '404': {
        description: 'Resource not found.',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/ApiErrorEnvelope' },
          },
        },
      },
    },
    'x-openapi-migration': {
      status: 'pending',
      tracking_issue: MIGRATION_ISSUE_URL,
      source_file: route.fileRel,
      source_line: route.sourceLine,
    },
  };
  if (params.length > 0) op.parameters = params;
  return op;
}

async function buildSpec(): Promise<{
  document: Record<string, unknown>;
  stats: SpecStats;
}> {
  const registry = new OpenAPIRegistry();

  registry.registerComponent('securitySchemes', 'BearerAuth', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
  });

  // Migrated routes — `.openapi('Name')` annotations on referenced
  // schemas self-register as named components during `registerPath`.
  let migratedRouteCount = 0;
  for (const { mount, def } of migratedRoutes) {
    registry.registerPath({ ...def, path: buildPath(mount, def.path) });
    migratedRouteCount++;
  }

  const generator = new OpenApiGeneratorV31(registry.definitions);
  const document = generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'Borjie Mining API',
      version: '0.2.0',
      description:
        'OpenAPI 3.1 spec for the Borjie mining sub-API. Generated from ' +
        '`@hono/zod-openapi` route definitions in ' +
        '`services/api-gateway/src/routes/mining/_openapi/route-defs.ts`. ' +
        'Routes from files marked `// TODO(openapi-migration)` are surfaced ' +
        'via regex-parse with a generic envelope until they are converted ' +
        '(tracked in issue #60).',
    },
    servers: [
      { url: 'http://localhost:3001', description: 'Local development gateway' },
      { url: 'https://api.borjie.example.com', description: 'Production (placeholder)' },
    ],
  }) as Record<string, unknown>;

  const paths = (document.paths ??= {}) as Record<
    string,
    Record<string, unknown>
  >;

  const tagSet = new Set<string>(
    migratedRoutes.flatMap(({ def }) =>
      ((def.tags as string[] | undefined) ?? []).map((t) => t),
    ),
  );

  // Append paths for the un-migrated files.
  const legacyRoutes = await scanLegacyRoutes(MINING_ROUTES_DIR, REPO_ROOT);
  let legacyRouteCount = 0;
  for (const route of legacyRoutes) {
    legacyRouteCount++;
    const fullPath = honoToOpenApiPath(
      buildPath(route.mountPrefix, route.relativePath),
    );
    tagSet.add(route.tag);
    const item = (paths[fullPath] ??= {});
    if (item[route.method]) continue;
    item[route.method] = buildLegacyOperation(route, fullPath);
  }

  // Sort paths + tags so successive runs produce identical YAML.
  document.paths = Object.keys(paths)
    .sort()
    .reduce<Record<string, unknown>>((acc, k) => {
      acc[k] = paths[k];
      return acc;
    }, {});

  document.tags = Array.from(tagSet)
    .sort()
    .map((name) => ({ name, description: `Mining sub-API: ${name}` }));

  document.security = [{ BearerAuth: [] }];

  const components = (document.components ?? {}) as Record<string, unknown>;
  const schemas = (components.schemas ?? {}) as Record<string, unknown>;

  const responseShapeCount = Object.keys(paths).reduce((total, p) => {
    const item = paths[p] as Record<string, { responses?: Record<string, unknown> }>;
    return (
      total +
      Object.values(item).reduce(
        (acc, op) => acc + Object.keys(op?.responses ?? {}).length,
        0,
      )
    );
  }, 0);

  return {
    document,
    stats: {
      migratedRouteCount,
      legacyRouteCount,
      totalPathCount: Object.keys(document.paths as object).length,
      schemaCount: Object.keys(schemas).length,
      responseShapeCount,
    },
  };
}

async function main(): Promise<void> {
  const { document, stats } = await buildSpec();
  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  const yaml =
    `# Generated by scripts/generate-openapi-spec.mjs (via tsx) — do not edit by hand.\n` +
    `${toYaml(document)}\n`;
  await writeFile(OUTPUT_PATH, yaml, 'utf8');

  process.stdout.write('OpenAPI mining spec generated.\n');
  process.stdout.write(`  output:                 ${relative(REPO_ROOT, OUTPUT_PATH)}\n`);
  process.stdout.write(`  paths:                  ${stats.totalPathCount}\n`);
  process.stdout.write(`  routes migrated:        ${stats.migratedRouteCount}\n`);
  process.stdout.write(`  routes pending (regex): ${stats.legacyRouteCount}\n`);
  process.stdout.write(`  schemas:                ${stats.schemaCount}\n`);
  process.stdout.write(`  response shapes:        ${stats.responseShapeCount}\n`);
}

main().catch((err: unknown) => {
  if (err instanceof Error) {
    process.stderr.write(`openapi:generate failed: ${err.message}\n`);
    process.stderr.write(`${err.stack ?? ''}\n`);
  } else {
    process.stderr.write(`openapi:generate failed: ${String(err)}\n`);
  }
  process.exit(1);
});
