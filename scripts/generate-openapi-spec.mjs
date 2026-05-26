#!/usr/bin/env node
/**
 * generate-openapi-spec.mjs — best-effort static OpenAPI 3.1 spec for
 * the Borjie mining sub-API.
 *
 * Walks every `services/api-gateway/src/routes/mining/.../<name>.hono.ts`
 * file, regex-parses each `app.<method>('<path>', ...)` registration
 * (along with any adjacent `zValidator('json', <SchemaName>)` call),
 * resolves the schema against `openapi-component-schemas.mjs`, and
 * emits `docs/openapi/borjie-mining.yaml`.
 *
 * Approach: Option B from the brief — pragmatic regex over a TypeScript
 * AST. This is intentionally imperfect; see `docs/openapi/README.md`
 * for the known gaps.
 *
 * Output:
 *   docs/openapi/borjie-mining.yaml — OpenAPI 3.1 spec (YAML)
 *
 * Stats are printed to stdout for the build log.
 */

import { readFile, readdir, writeFile, mkdir, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { componentSchemas } from './openapi-component-schemas.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');
const MINING_ROUTES_DIR = resolve(
  REPO_ROOT,
  'services/api-gateway/src/routes/mining',
);
const OUTPUT_PATH = resolve(REPO_ROOT, 'docs/openapi/borjie-mining.yaml');
const BASE_PREFIX = '/api/v1/mining';

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'];

// ---------------------------------------------------------------------------
// File discovery
// ---------------------------------------------------------------------------

async function listHonoFiles(dir) {
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) {
      const nested = await listHonoFiles(p);
      out.push(...nested);
    } else if (entry.isFile() && entry.name.endsWith('.hono.ts')) {
      out.push(p);
    }
  }
  return out.sort();
}

// ---------------------------------------------------------------------------
// Route extraction (regex over source, no TypeScript parser)
// ---------------------------------------------------------------------------

/**
 * Recover the mount-prefix for a given mining file by reading the
 * matching `mining.route('/x', xRouter)` line out of `mining/index.ts`.
 * Falls back to the filename stem for files we can't resolve.
 */
async function buildPrefixMap() {
  const indexPath = join(MINING_ROUTES_DIR, 'index.ts');
  const source = await readFile(indexPath, 'utf8');
  const map = new Map();
  const importLineRe =
    /import\s+\{\s*([A-Za-z0-9_]+)\s*\}\s+from\s+'(\.[^']+)'/g;
  const routeLineRe =
    /mining\.route\(\s*['"]([^'"]+)['"]\s*,\s*([A-Za-z0-9_]+)\s*\)/g;
  const importByName = new Map();
  let m;
  while ((m = importLineRe.exec(source)) !== null) {
    const [, name, rel] = m;
    importByName.set(name, rel);
  }
  while ((m = routeLineRe.exec(source)) !== null) {
    const [, prefix, name] = m;
    const importRel = importByName.get(name);
    if (!importRel) continue;
    // Resolve `./sites.hono` -> absolute path to `sites.hono.ts`.
    const abs = resolve(MINING_ROUTES_DIR, `${importRel}.ts`);
    map.set(abs, prefix);
  }
  return map;
}

/**
 * Pull the leading JSDoc `@route` summaries — fallback to nearest comment
 * above an `app.<method>` call.
 *
 * We index every `//` and `/* ... *\/` comment with its end-line number,
 * then for each route handler look for the highest comment end-line that
 * is still <= the route start-line. Cheap, deterministic, good enough.
 */
function indexComments(source) {
  /** @type {Array<{ endLine: number, text: string }>} */
  const idx = [];
  let line = 1;
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === '\n') {
      line++;
      i++;
      continue;
    }
    // Line comment.
    if (ch === '/' && source[i + 1] === '/') {
      const end = source.indexOf('\n', i);
      const stop = end === -1 ? source.length : end;
      const text = source.slice(i + 2, stop).trim();
      idx.push({ endLine: line, text });
      i = stop;
      continue;
    }
    // Block comment.
    if (ch === '/' && source[i + 1] === '*') {
      const end = source.indexOf('*/', i + 2);
      if (end === -1) break;
      const block = source.slice(i + 2, end);
      const startLine = line;
      // Update line count for newlines inside the block.
      for (let j = 0; j < block.length; j++) if (block[j] === '\n') line++;
      const text = block
        .split('\n')
        .map((l) => l.replace(/^\s*\*?\s?/, '').trimEnd())
        .filter(Boolean)
        .join(' ')
        .trim();
      idx.push({ endLine: line, text });
      i = end + 2;
      continue;
    }
    i++;
  }
  return idx;
}

function summaryFor(commentIdx, lineNumber) {
  // Only consider comments within 6 lines above the route — the
  // file-header JSDoc is usually 30+ lines above and would otherwise
  // win for every route in the file.
  let best = null;
  for (const c of commentIdx) {
    if (c.endLine > lineNumber) break;
    if (lineNumber - c.endLine <= 6) best = c;
  }
  if (!best) return null;
  return best.text
    .replace(/^Routes?:\s*/i, '')
    .replace(/^([A-Z]+)\s+\S+\s+/, '')
    .slice(0, 120);
}

/**
 * Walk a single .hono.ts file and yield route registrations.
 *
 * We match any of:
 *   app.get('/path', ...)
 *   app.post('/path', zValidator('json', SchemaName), ...)
 *   app.post('/path', zValidator('json', SchemaName), withSecurityEvents(...))
 *
 * The arg-list is captured to the matching top-level `)`. Inside that,
 * we look for the first `zValidator('json', <Name>)` reference. We do
 * NOT try to extract response shapes — every handler returns a Hono
 * `c.json(...)` and parsing that would need a real TS AST.
 */
function extractRoutes(source) {
  const out = [];
  const commentIdx = indexComments(source);
  const methodRe = new RegExp(
    `\\bapp\\.(${HTTP_METHODS.join('|')})\\s*\\(`,
    'g',
  );
  let m;
  while ((m = methodRe.exec(source)) !== null) {
    const method = m[1];
    const argsStart = m.index + m[0].length;
    const argsEnd = findMatchingParen(source, argsStart - 1);
    if (argsEnd === -1) continue;
    const argSlice = source.slice(argsStart, argsEnd);
    const pathMatch = argSlice.match(/^\s*['"]([^'"]+)['"]/);
    if (!pathMatch) continue;
    const routePath = pathMatch[1];
    const validatorMatch = argSlice.match(
      /zValidator\(\s*['"](json|form|query|param|header)['"]\s*,\s*([A-Za-z0-9_]+)/,
    );
    const requestBodySchema =
      validatorMatch && validatorMatch[1] === 'json' ? validatorMatch[2] : null;
    const requestQuerySchema =
      validatorMatch && validatorMatch[1] === 'query' ? validatorMatch[2] : null;
    const lineNumber = source.slice(0, m.index).split('\n').length;
    const summary = summaryFor(commentIdx, lineNumber);
    out.push({
      method,
      path: routePath,
      requestBodySchema,
      requestQuerySchema,
      summary,
      sourceLine: lineNumber,
    });
  }
  return out;
}

/** Find the matching `)` for the `(` at `openIdx` in `source`. */
function findMatchingParen(source, openIdx) {
  if (source[openIdx] !== '(') return -1;
  let depth = 0;
  let i = openIdx;
  let inStr = null;
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

/** Convert Hono `:param` segments to OpenAPI `{param}` segments. */
function honoToOpenApiPath(p) {
  return p.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}');
}

/** Extract `{name}` path-parameter names from an OpenAPI-style path. */
function pathParamNames(p) {
  const out = [];
  const re = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
  let m;
  while ((m = re.exec(p)) !== null) out.push(m[1]);
  return out;
}

// ---------------------------------------------------------------------------
// OpenAPI assembly
// ---------------------------------------------------------------------------

function tagFromFile(fileBasename) {
  // sites.hono.ts -> sites, internal/audit-log.hono.ts -> internal-audit-log
  return fileBasename
    .replace(/\.hono\.ts$/, '')
    .replace(/[\\/]/g, '-');
}

function buildPathItem(route, fileRel, tag) {
  const params = pathParamNames(route.path).map((name) => ({
    name,
    in: 'path',
    required: true,
    schema: { type: 'string' },
  }));

  /** @type {Record<string, unknown>} */
  const responses = {
    200: {
      description: 'Success envelope (`{ success: true, data: ... }`).',
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/ApiSuccessEnvelope' },
        },
      },
    },
    400: {
      description: 'Validation or business error.',
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/ApiErrorEnvelope' },
        },
      },
    },
    401: {
      description: 'Auth missing or invalid.',
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/ApiErrorEnvelope' },
        },
      },
    },
    404: {
      description: 'Resource not found.',
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/ApiErrorEnvelope' },
        },
      },
    },
  };
  if (route.method === 'post') {
    responses[201] = {
      description: 'Created.',
      content: {
        'application/json': {
          schema: { $ref: '#/components/schemas/ApiSuccessEnvelope' },
        },
      },
    };
  }

  /** @type {Record<string, unknown>} */
  const op = {
    tags: [tag],
    summary: route.summary || `${route.method.toUpperCase()} ${route.path}`,
    operationId: `${tag}.${route.method}.${route.path.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '')}`,
    parameters: params,
    responses,
    security: [{ BearerAuth: [] }],
    'x-source-file': fileRel,
    'x-source-line': route.sourceLine,
  };

  if (route.requestBodySchema) {
    const schemaName = route.requestBodySchema;
    const known = Object.prototype.hasOwnProperty.call(componentSchemas, schemaName);
    op.requestBody = {
      required: true,
      content: {
        'application/json': {
          schema: known
            ? { $ref: `#/components/schemas/${schemaName}` }
            : { type: 'object', additionalProperties: true },
        },
      },
    };
    if (!known) {
      op['x-zod-schema-unmapped'] = schemaName;
    }
  }

  if (route.requestQuerySchema) {
    op['x-query-zod-schema'] = route.requestQuerySchema;
  }

  // Drop empty `parameters: []` to keep the YAML tidy.
  if (op.parameters.length === 0) delete op.parameters;

  return op;
}

// ---------------------------------------------------------------------------
// Minimal YAML emitter (avoids js-yaml dep)
// ---------------------------------------------------------------------------

function toYaml(value, indent = 0) {
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
    const keys = Object.keys(value);
    if (keys.length === 0) return '{}';
    return keys
      .map((k, idx) => {
        const v = value[k];
        const safeKey = yamlKey(k);
        const isObj = v !== null && typeof v === 'object';
        if (isObj && !Array.isArray(v) && Object.keys(v).length === 0) {
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

function yamlKey(k) {
  if (/^[A-Za-z0-9_./{}-]+$/.test(k)) return k;
  return `"${k.replace(/"/g, '\\"')}"`;
}

function yamlString(s) {
  // Multiline strings are folded; otherwise quote when needed.
  if (s.includes('\n')) {
    const indent = '  ';
    const folded = s.split('\n').map((line) => `${indent}${line}`).join('\n');
    return `|\n${folded}`;
  }
  // Quote when the value contains any YAML-special character or could be
  // mis-parsed (numeric, boolean, null, leading whitespace, etc).
  const needsQuote =
    /^[\s\-?:,\[\]{}#&*!|>%@`'"]/.test(s) ||
    /[:#]/.test(s) ||
    /[\s]$/.test(s) ||
    /^(true|false|null|~|yes|no|on|off)$/i.test(s) ||
    /^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(s);
  if (!needsQuote) return s;
  // Use single quotes; escape embedded ones by doubling.
  return `'${s.replace(/'/g, "''")}'`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const exists = await stat(MINING_ROUTES_DIR).catch(() => null);
  if (!exists) {
    console.error(`mining routes directory not found: ${MINING_ROUTES_DIR}`);
    process.exit(2);
  }
  // `docs.hono.ts` serves the spec itself; including it would have the
  // spec document its own discovery endpoints. Skip it so the stats stay
  // a clean count of domain endpoints.
  const files = (await listHonoFiles(MINING_ROUTES_DIR)).filter(
    (f) => !f.endsWith('/index.ts') && !f.endsWith('/docs.hono.ts'),
  );
  const prefixByFile = await buildPrefixMap();

  /** @type {Record<string, Record<string, unknown>>} */
  const paths = {};
  /** @type {Set<string>} */
  const tagSet = new Set();
  /** @type {Set<string>} */
  const usedSchemas = new Set();
  /** @type {string[]} */
  const unmappedSchemas = [];

  let totalEndpoints = 0;

  for (const file of files) {
    const source = await readFile(file, 'utf8');
    const routes = extractRoutes(source);
    if (routes.length === 0) continue;
    const fileRel = relative(REPO_ROOT, file);
    const prefix = prefixByFile.get(file);
    if (!prefix) {
      console.warn(
        `[warn] no mining/index.ts mount entry for ${fileRel} — skipping ` +
          'so the spec only contains routes that actually answer on /api/v1/mining/*',
      );
      continue;
    }
    for (const route of routes) {
      totalEndpoints++;
      const fullPath = honoToOpenApiPath(
        `${BASE_PREFIX}${prefix}${route.path}`.replace(/\/+/g, '/').replace(/\/$/, '') ||
          `${BASE_PREFIX}${prefix}`,
      );
      const pathKey = fullPath || `${BASE_PREFIX}${prefix}/`;
      const tag = tagFromFile(relative(MINING_ROUTES_DIR, file));
      tagSet.add(tag);
      const operation = buildPathItem(route, fileRel, tag);
      paths[pathKey] = paths[pathKey] || {};
      if (paths[pathKey][route.method]) {
        console.warn(
          `[warn] duplicate ${route.method.toUpperCase()} ${pathKey} ` +
            `(second hit in ${fileRel}:${route.sourceLine})`,
        );
      }
      paths[pathKey][route.method] = operation;
      if (route.requestBodySchema) {
        if (Object.prototype.hasOwnProperty.call(componentSchemas, route.requestBodySchema)) {
          usedSchemas.add(route.requestBodySchema);
        } else {
          unmappedSchemas.push(`${fileRel}:${route.sourceLine} → ${route.requestBodySchema}`);
        }
      }
    }
  }

  // Always include the envelope schemas — every operation references them.
  usedSchemas.add('ApiSuccessEnvelope');
  usedSchemas.add('ApiErrorEnvelope');

  const schemas = {};
  for (const name of Array.from(usedSchemas).sort()) {
    schemas[name] = componentSchemas[name];
  }

  const sortedPaths = Object.keys(paths)
    .sort()
    .reduce((acc, k) => {
      acc[k] = paths[k];
      return acc;
    }, {});

  const spec = {
    openapi: '3.1.0',
    info: {
      title: 'Borjie Mining API',
      version: '0.1.0',
      description:
        'Best-effort static OpenAPI spec for the Borjie mining sub-API. ' +
        'Generated from `services/api-gateway/src/routes/mining/**/*.hono.ts` ' +
        'by `scripts/generate-openapi-spec.mjs` (Option B — regex over source, ' +
        'no AST). Limitations are documented in `docs/openapi/README.md`.',
    },
    servers: [
      { url: 'http://localhost:3001', description: 'Local development gateway' },
      { url: 'https://api.borjie.example.com', description: 'Production (placeholder)' },
    ],
    security: [{ BearerAuth: [] }],
    tags: Array.from(tagSet)
      .sort()
      .map((name) => ({ name, description: `Mining sub-API: ${name}` })),
    paths: sortedPaths,
    components: {
      securitySchemes: {
        BearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      },
      schemas,
    },
  };

  await mkdir(dirname(OUTPUT_PATH), { recursive: true });
  const yaml = `# Generated by scripts/generate-openapi-spec.mjs — do not edit by hand.\n${toYaml(spec)}\n`;
  await writeFile(OUTPUT_PATH, yaml, 'utf8');

  // Build-log summary.
  console.log('OpenAPI mining spec generated.');
  console.log(`  output:           ${relative(REPO_ROOT, OUTPUT_PATH)}`);
  console.log(`  files scanned:    ${files.length}`);
  console.log(`  paths:            ${Object.keys(sortedPaths).length}`);
  console.log(`  endpoints:        ${totalEndpoints}`);
  console.log(`  tags:             ${tagSet.size}`);
  console.log(`  schemas resolved: ${Object.keys(schemas).length}`);
  if (unmappedSchemas.length > 0) {
    console.log(`  unmapped zValidator schemas (${unmappedSchemas.length}):`);
    for (const u of unmappedSchemas) console.log(`    - ${u}`);
  }
}

main().catch((err) => {
  console.error('openapi:generate failed:', err);
  process.exit(1);
});
