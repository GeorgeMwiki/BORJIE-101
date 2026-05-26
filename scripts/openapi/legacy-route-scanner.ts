/**
 * Regex-based fallback scanner for the 26 mining route files still
 * marked `// TODO(openapi-migration)` (tracked in issue #60).
 *
 * Walks `services/api-gateway/src/routes/mining/**\/*.hono.ts`, ignores
 * files already migrated via `@hono/zod-openapi`, and extracts every
 * `app.<method>('<path>', ...)` registration. The matching mount
 * prefix is recovered from `mining/index.ts` by reading
 * `mining.route('<prefix>', <importName>)` lines.
 *
 * The output is intentionally lossy — the regex pass cannot recover
 * response shapes, query schemas, or request bodies. Each route gets
 * a generic envelope with an `x-openapi-migration` extension pointing
 * at the tracking issue.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

export interface LegacyRoute {
  method: HttpMethod;
  relativePath: string;
  fileRel: string;
  sourceLine: number;
  mountPrefix: string;
  tag: string;
}

export async function listHonoFiles(dir: string): Promise<string[]> {
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

export async function buildPrefixMap(
  miningRoutesDir: string,
): Promise<Map<string, string>> {
  const indexPath = join(miningRoutesDir, 'index.ts');
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
    map.set(resolve(miningRoutesDir, `${importRel}.ts`), m[1]);
  }
  return map;
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

function tagFromFile(fileBasename: string): string {
  return fileBasename.replace(/\.hono\.ts$/, '').replace(/[\\/]/g, '-');
}

function extractRoutesFromSource(
  source: string,
  fileRel: string,
  mountPrefix: string,
  tag: string,
): LegacyRoute[] {
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
    out.push({
      method,
      relativePath: pathMatch[1],
      fileRel,
      sourceLine: source.slice(0, m.index).split('\n').length,
      mountPrefix,
      tag,
    });
  }
  return out;
}

export async function scanLegacyRoutes(
  miningRoutesDir: string,
  repoRoot: string,
): Promise<LegacyRoute[]> {
  const out: LegacyRoute[] = [];
  const files = (await listHonoFiles(miningRoutesDir)).filter(
    (f) => !f.endsWith('/index.ts') && !f.endsWith('/docs.hono.ts'),
  );
  const prefixByFile = await buildPrefixMap(miningRoutesDir);
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    if (!source.includes('TODO(openapi-migration)')) continue;
    const fileRel = relative(repoRoot, file);
    const mountPrefix = prefixByFile.get(file);
    if (!mountPrefix) continue;
    const tag = tagFromFile(relative(miningRoutesDir, file));
    out.push(...extractRoutesFromSource(source, fileRel, mountPrefix, tag));
  }
  return out;
}

export function honoToOpenApiPath(p: string): string {
  return p.replace(/:([A-Za-z_][A-Za-z0-9_]*)/g, '{$1}');
}

export function pathParamNames(p: string): string[] {
  const out: string[] = [];
  const re = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(p)) !== null) out.push(m[1]);
  return out;
}
