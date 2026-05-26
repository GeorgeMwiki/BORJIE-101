/**
 * build-mining-openapi-spec.ts — produce `docs/openapi/borjie-mining.yaml`
 * from the Zod-OpenAPI route definitions declared in
 * `services/api-gateway/src/routes/mining/_openapi/route-defs.ts`.
 *
 * Pipeline:
 *   1. Import `migratedRoutes` (side-effect free — no DB / middleware).
 *   2. Register each route with a fresh `OpenAPIRegistry`, prefixed with
 *      the mining mount + the route's relative path.
 *   3. Generate the 3.1 document via `OpenApiGeneratorV31.generateDocument`.
 *   4. For the 26 un-migrated `.hono.ts` files, regex-scrape paths +
 *      methods so the spec still surfaces every endpoint. These get a
 *      generic `ApiSuccessEnvelope` 200 response with an
 *      `x-openapi-migration: pending` extension pointing at issue #60.
 *   5. Emit YAML.
 *
 * Run via the thin `.mjs` wrapper: `node scripts/generate-openapi-spec.mjs`
 * (which shells out to `tsx` so workspace TypeScript Just Works).
 */

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
} from '@asteasolutions/zod-to-openapi';

import { migratedRoutes } from '../services/api-gateway/src/routes/mining/_openapi/route-defs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

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

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
type HttpMethod = (typeof HTTP_METHODS)[number];

// ---------------------------------------------------------------------------
// File walking (for un-migrated routes)
// ---------------------------------------------------------------------------

async function listHonoFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await listHonoFiles(p)));
    } else if (entry.isFile() && entry.name.endsWith('.hono.ts')) {
      out.push(p);
    }
  }
  return out.sort();
}

async function buildPrefixMap(): Promise<Map<string, string>> {
  const indexPath = join(MINING_ROUTES_DIR, 'index.ts');
  const source = await readFile(indexPath, 'utf8');
  const map = new Map<string, string>();
  const importByName = new Map<string, string>();
  const importLineRe =
    /import\s+\{\s*([A-Za-z0-9_]+)\s*\}\s+from\s+'(\.[^']+)'/g;
  const routeLineRe =
    /mining\.route\(\s*['"]([^'"]+)['"]\s*,\s*([A-Za-z0-9_]+)\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = importLineRe.exec(source)) !== null) {
    importByName.set(m[1], m[2]);
  }
  while ((m = routeLineRe.exec(source)) !== null) {
    const importRel = importByName.get(m[2]);
    if (!importRel) continue;
    map.set(resolve(MINING_ROUTES_DIR, `${importRel}.ts`), m[1]);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Regex-based legacy route extraction (for the 26 un-migrated files)
// ---------------------------------------------------------------------------

interface LegacyRoute {
  method: HttpMethod;
  relativePath: string;
  fileRel: string;
  sourceLine: number;
}

function findMatchingParen(source: string, openIdx: number): number {
  if (source[openIdx] !== '(') return -1;
  let depth = 0;
  let i = openIdx;
  let inStr: string | null = null;
  let inLineComment = false;
  let inBlockComment = false;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      i++;
      continue;
    }
    if (inBlockComment) {
      if (ch === '*' && next === '/') {
        inBlockComment = false;
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (inStr) {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === inStr) inStr = null;
      i++;
      continue;
    }
    if (ch === '/' && next === '/') {
      inLineComment = true;
      i += 2;
      continue;
    }
    if (ch === '/' && next === '*') {
      inBlockComment = true;
      i += 2;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      inStr = ch;
      i++;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return i;
    }
    i++;
  }
  return -1;
}

function extractLegacyRoutes(source: string, fileRel: string): LegacyRoute[] {
  const out: LegacyRoute[] = [];
  const methodRe = new RegExp(`\\bapp\\.(${HTTP_METHODS.join('|')})\\s*\\(`, 'g');
  let m: RegExpExecArray | null;
  while ((m = methodRe.exec(source)) !== null) {
    const method = m[1] as HttpMethod;
    const argsStart = m.index + m[0].length;
    const argsEnd = findMatchingParen(source, argsStart - 1);
    if (argsEnd === -1) continue;
    const argSlice = source.slice(argsStart, argsEnd);
    const pathMatch = argSlice.match(/^\s*['"]([^'"]+)['"]/);
    if (!pathMatch) continue;
    const sourceLine = source.slice(0, m.index).split('\n').length;
    out.push({ method, relativePath: pathMatch[1], fileRel, sourceLine });
  }
  return out;
}

function honoToOpenApiPath(p: string): string {
  return p.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}');
}

function pathParamNames(p: string): string[] {
  const out: string[] = [];
  const re = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(p)) !== null) out.push(m[1]);
  return out;
}

function tagFromFile(fileBasename: string): string {
  return fileBasename.replace(/\.hono\.ts$/, '').replace(/[\\/]/g, '-');
}

// ---------------------------------------------------------------------------
// YAML emitter (avoids a js-yaml dep — same minimal impl as the legacy
// generator, copy-pasted to keep the script standalone).
// ---------------------------------------------------------------------------

function yamlKey(k: string): string {
  if (/^[A-Za-z0-9_./{}-]+$/.test(k)) return k;
  return `"${k.replace(/"/g, '\\"')}"`;
}

function yamlString(s: string): string {
  if (s.includes('\n')) {
    const indent = '  ';
    const folded = s
      .split('\n')
      .map((line) => `${indent}${line}`)
      .join('\n');
    return `|\n${folded}`;
  }
  const needsQuote =
    /^[\s\-?:,\[\]{}#&*!|>%@`'"]/.test(s) ||
    /[:#]/.test(s) ||
    /[\s]$/.test(s) ||
    /^(true|false|null|~|yes|no|on|off)$/i.test(s) ||
    /^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(s);
  if (!needsQuote) return s;
  return `'${s.replace(/'/g, "''")}'`;
}

function toYaml(value: unknown, indent = 0): string {
  const pad = '  '.repeat(indent);
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (typeof value === 'string') return yamlString(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    return value
      .map((item) => {
        const rendered = toYaml(item, indent + 1);
        if (typeof item === 'object' && item !== null) {
          const trimmed = rendered.replace(/^\s+/, '');
          return `${pad}- ${trimmed}`;
        }
        return `${pad}- ${rendered}`;
      })
      .join('\n');
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 0) return '{}';
    return keys
      .map((k, idx) => {
        const v = obj[k];
        const safeKey = yamlKey(k);
        const isObj = v !== null && typeof v === 'object';
        if (isObj && !Array.isArray(v) && Object.keys(v as object).length === 0) {
          return `${idx === 0 && indent === 0 ? '' : pad}${safeKey}: {}`;
        }
        if (Array.isArray(v) && v.length === 0) {
          return `${idx === 0 && indent === 0 ? '' : pad}${safeKey}: []`;
        }
        if (isObj) {
          const rendered = toYaml(v, indent + 1);
          return `${idx === 0 && indent === 0 ? '' : pad}${safeKey}:\n${rendered}`;
        }
        return `${idx === 0 && indent === 0 ? '' : pad}${safeKey}: ${toYaml(v, indent + 1)}`;
      })
      .join('\n');
  }
  return JSON.stringify(value);
}

// ---------------------------------------------------------------------------
// Build the spec
// ---------------------------------------------------------------------------

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

async function buildSpec(): Promise<{
  document: Record<string, unknown>;
  stats: SpecStats;
}> {
  const registry = new OpenAPIRegistry();

  // 1. Register security scheme.
  registry.registerComponent('securitySchemes', 'BearerAuth', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
  });

  // 2. Register each migrated route at its fully-qualified path. Zod
  // schemas annotated via `.openapi('Name')` self-register as named
  // components during `registerPath` — no separate `register` calls
  // needed for envelopes.
  let migratedRouteCount = 0;
  for (const { mount, def } of migratedRoutes) {
    const fullPath = buildPath(mount, def.path);
    registry.registerPath({ ...def, path: fullPath });
    migratedRouteCount++;
  }

  // 4. Emit the document.
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

  // 5. Append paths for the 26 un-migrated files. Cast: we know `paths` is
  // a Record after `generateDocument`.
  const paths = (document.paths ??= {}) as Record<
    string,
    Record<string, unknown>
  >;
  const migratedPathKeys = new Set(Object.keys(paths));

  const tagSet = new Set<string>(
    Array.from(
      new Set(
        migratedRoutes.flatMap(({ def }) =>
          ((def.tags as string[] | undefined) ?? []).map((t) => t),
        ),
      ),
    ),
  );

  const files = (await listHonoFiles(MINING_ROUTES_DIR)).filter(
    (f) => !f.endsWith('/index.ts') && !f.endsWith('/docs.hono.ts'),
  );
  const prefixByFile = await buildPrefixMap();

  let legacyRouteCount = 0;
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    if (!source.includes('TODO(openapi-migration)')) {
      // Already migrated — skip the regex pass; route-defs handles it.
      continue;
    }
    const fileRel = relative(REPO_ROOT, file);
    const prefix = prefixByFile.get(file);
    if (!prefix) continue;
    const legacy = extractLegacyRoutes(source, fileRel);
    const tag = tagFromFile(relative(MINING_ROUTES_DIR, file));
    tagSet.add(tag);
    for (const route of legacy) {
      legacyRouteCount++;
      const fullPath = honoToOpenApiPath(buildPath(prefix, route.relativePath));
      const params = pathParamNames(fullPath).map((name) => ({
        name,
        in: 'path',
        required: true,
        schema: { type: 'string' },
      }));
      const operation: Record<string, unknown> = {
        tags: [tag],
        summary: `${route.method.toUpperCase()} ${route.relativePath}`,
        operationId: `${tag}.${route.method}.${route.relativePath.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`,
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
          source_file: fileRel,
          source_line: route.sourceLine,
        },
      };
      if (params.length > 0) operation.parameters = params;
      paths[fullPath] ??= {};
      if (paths[fullPath][route.method]) continue;
      // Skip if the migrated registry already produced this combo (paranoia).
      if (
        migratedPathKeys.has(fullPath) &&
        (paths[fullPath] as Record<string, unknown>)[route.method]
      ) {
        continue;
      }
      (paths[fullPath] as Record<string, unknown>)[route.method] = operation;
    }
  }

  // 6. Sort paths + tags so successive runs produce identical YAML.
  const sortedPaths = Object.keys(paths)
    .sort()
    .reduce<Record<string, unknown>>((acc, k) => {
      acc[k] = paths[k];
      return acc;
    }, {});
  document.paths = sortedPaths;

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
      totalPathCount: Object.keys(sortedPaths).length,
      schemaCount: Object.keys(schemas).length,
      responseShapeCount,
    },
  };
}

// ---------------------------------------------------------------------------
// Entrypoint
// ---------------------------------------------------------------------------

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
