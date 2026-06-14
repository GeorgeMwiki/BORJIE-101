/**
 * CI SHAPE GUARD — every brain-tool loopback route literal must resolve to a
 * route mounted in the gateway.
 *
 * The whole "born-dark loopback route" class of bug (an `entity.*` /
 * `borjie.ask` / `documents.*` / `jurisdiction.discover` tool POSTing to a
 * `/internal/...` path that NOTHING mounts → 404 in prod → silent stub
 * fallback) is invisible to the type checker and to unit tests of the tool in
 * isolation. This static test is the guard that catches it: it scans EVERY
 * `client.post/get('/...')` (and `ctx.httpClient.post/get('/...')`) literal in
 * `composition/brain-tools/*.ts` and asserts each one is covered by an
 * `api.route('<prefix>', …)` mount in `index.ts` (accounting for the `/api/v1`
 * loopback prefix and nested route prefixes).
 *
 * If this test fails, a brain tool is calling a path the gateway does not
 * serve — wire the route (or repoint the tool) before shipping.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BRAIN_TOOLS_DIR = join(HERE, '..');
const INDEX_TS = join(HERE, '..', '..', '..', 'index.ts');

// The loopback client prepends this prefix to every tool path (see
// loopback-http-client.ts → `apiPrefix: '/api/v1'`). A literal that already
// starts with `/api/v1` is an absolute path; one that does not is relative to
// the `/api/v1` base.
const API_PREFIX = '/api/v1';

/**
 * Extract every static path literal passed as the first argument to a
 * `.post(` / `.get(` (optionally generic `.post<...>(`) call. Template-literal
 * paths are truncated at the first `${` interpolation so only the static
 * leading segment is matched against the mounted prefix.
 */
function extractRouteLiterals(source: string): string[] {
  const out = new Set<string>();
  // Step 1: locate each `.post` / `.get` call site. The generic type argument
  // (`<{ … Array<…> … }>`) can span many lines and contain nested `>`, so we
  // do NOT try to match it with a regex — we just anchor on the method name.
  const callSiteRe = /\.(?:post|get)\b/g;
  // Step 2: from each call site, the FIRST string literal whose content begins
  // with `/` is the path argument. We scan a bounded window forward so a later
  // unrelated literal never gets mis-attributed.
  const pathRe = /([`'"])(\/[^`'"$]*)/;
  let m: RegExpExecArray | null;
  while ((m = callSiteRe.exec(source)) !== null) {
    const window = source.slice(m.index, m.index + 600);
    const pm = pathRe.exec(window);
    if (!pm) continue;
    const raw = pm[2] ?? '';
    // Drop a trailing slash artifact (e.g. `/owner/threads/` from `…/${id}`).
    const cleaned = raw.length > 1 && raw.endsWith('/') ? raw.slice(0, -1) : raw;
    if (cleaned.startsWith('/')) out.add(cleaned);
  }
  return [...out];
}

/** Collect every `api.route('<prefix>', …)` mount prefix from index.ts. */
function collectMountedPrefixes(indexSource: string): string[] {
  const out = new Set<string>();
  const mountRe = /\bapi\.route\(\s*(['"`])(\/[^'"`]*)\1/g;
  let m: RegExpExecArray | null;
  while ((m = mountRe.exec(indexSource)) !== null) {
    const prefix = m[2] ?? '';
    if (prefix.startsWith('/')) out.add(prefix);
  }
  return [...out];
}

/** True when `path` is served by `prefix` (exact or nested under it). */
function coveredBy(path: string, prefix: string): boolean {
  if (prefix === '/') return true;
  return path === prefix || path.startsWith(`${prefix}/`);
}

describe('brain-tool loopback routes are all mounted (CI shape guard)', () => {
  const indexSource = readFileSync(INDEX_TS, 'utf8');
  const mounted = collectMountedPrefixes(indexSource);

  const toolFiles = readdirSync(BRAIN_TOOLS_DIR).filter(
    (f) => f.endsWith('.ts') && !f.endsWith('.d.ts'),
  );

  it('discovers the brain-tool sources + the index mounts', () => {
    expect(toolFiles.length).toBeGreaterThan(5);
    expect(mounted.length).toBeGreaterThan(20);
    // Sanity: the broad /internal mount + the new specific ones are present.
    expect(mounted).toContain('/internal');
    expect(mounted).toContain('/internal/entity-legibility');
    expect(mounted).toContain('/internal/brain');
    expect(mounted).toContain('/internal/documents');
    expect(mounted).toContain('/internal/jurisdiction-discovery');
  });

  // Build the full literal inventory once.
  const allLiterals: Array<{ file: string; path: string }> = [];
  for (const file of toolFiles) {
    const src = readFileSync(join(BRAIN_TOOLS_DIR, file), 'utf8');
    for (const lit of extractRouteLiterals(src)) {
      allLiterals.push({ file, path: lit });
    }
  }

  it('found a non-trivial set of route literals to check', () => {
    expect(allLiterals.length).toBeGreaterThan(10);
    // The specific born-dark routes this fix wired must be in the inventory.
    const paths = new Set(allLiterals.map((l) => l.path));
    expect(paths).toContain('/internal/entity-legibility/resolve');
    expect(paths).toContain('/internal/brain/ask');
    expect(paths).toContain('/internal/documents/upload-url');
    expect(paths).toContain('/internal/jurisdiction-discovery/discover');
  });

  it('every brain-tool route literal resolves to a mounted gateway route', () => {
    const unmounted: Array<{ file: string; path: string }> = [];
    for (const { file, path } of allLiterals) {
      // Normalise: a literal already under /api/v1 is absolute; otherwise it
      // is relative to the /api/v1 base. Strip the prefix so it can be matched
      // against the `api.route()` prefixes (which are relative to that base).
      const rel = path.startsWith(`${API_PREFIX}/`)
        ? path.slice(API_PREFIX.length)
        : path === API_PREFIX
          ? '/'
          : path;
      const isCovered = mounted.some((prefix) => coveredBy(rel, prefix));
      if (!isCovered) unmounted.push({ file, path });
    }
    expect(
      unmounted,
      `These brain-tool route literals 404 — no api.route() mount serves them:\n${unmounted
        .map((u) => `  ${u.path}  (${u.file})`)
        .join('\n')}`,
    ).toEqual([]);
  });
});
