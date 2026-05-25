/**
 * Route discovery for the cross-tenant regression generator.
 *
 * Walks the api-gateway routes directory and extracts every
 * `app.<verb>('<path>', ...)` registration so we can:
 *   1. count "routes considered" (denominator),
 *   2. emit one cross-tenant spec per non-allow-listed route + method.
 *
 * The discovery is pure string scanning — no TypeScript AST. That is
 * intentional: it stays fast in CI and accepts unusual handler bodies.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export interface DiscoveredRoute {
  readonly file: string;
  readonly line: number;
  readonly method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  readonly path: string;
}

export interface DiscoveryOptions {
  readonly root: string;
  /** Optional list of file globs to skip (e.g. test files). */
  readonly excludePaths?: ReadonlyArray<string>;
}

const METHOD_RE =
  /\b(?:app|router|api|hono)\s*\.\s*(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/g;

const DEFAULT_EXCLUDE_SUBSTR = ['__tests__', '.test.', '.spec.'];

function walk(
  dir: string,
  out: string[],
  excludeNames: ReadonlyArray<string>,
): void {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const e of entries) {
    if (excludeNames.includes(e)) continue;
    const p = join(dir, e);
    let s: ReturnType<typeof statSync>;
    try {
      s = statSync(p);
    } catch {
      continue;
    }
    if (s.isDirectory()) {
      walk(p, out, excludeNames);
    } else if (s.isFile() && /\.(ts|tsx|mjs|js)$/.test(e)) {
      out.push(p);
    }
  }
}

/**
 * Discover every HTTP route in a routes directory. Pass the absolute
 * path to `services/api-gateway/src/routes`.
 */
export function discoverRoutes(opts: DiscoveryOptions): DiscoveredRoute[] {
  const files: string[] = [];
  walk(opts.root, files, ['node_modules', 'dist']);
  const excludeSubstr = [
    ...DEFAULT_EXCLUDE_SUBSTR,
    ...(opts.excludePaths ?? []),
  ];

  const routes: DiscoveredRoute[] = [];
  for (const abs of files) {
    const rel = relative(opts.root, abs).split(sep).join('/');
    if (excludeSubstr.some((sub) => rel.includes(sub))) continue;
    let body: string;
    try {
      body = readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    const lines = body.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      METHOD_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = METHOD_RE.exec(line)) !== null) {
        const method = (m[1] ?? '').toUpperCase() as DiscoveredRoute['method'];
        const path = m[2] ?? '';
        routes.push({ file: rel, line: i + 1, method, path });
      }
    }
  }
  return routes;
}

/**
 * Group routes by their top-level family for reporting (e.g. `/leases`,
 * `/maintenance/:id` -> `/leases`, `/maintenance`).
 */
export function groupByFamily(
  routes: ReadonlyArray<DiscoveredRoute>,
): Map<string, DiscoveredRoute[]> {
  const out = new Map<string, DiscoveredRoute[]>();
  for (const r of routes) {
    const family = (r.path.split('/')[1] ?? '').replace(/[:?].*$/, '') || '/';
    const list = out.get(family) ?? [];
    list.push(r);
    out.set(family, list);
  }
  return out;
}
