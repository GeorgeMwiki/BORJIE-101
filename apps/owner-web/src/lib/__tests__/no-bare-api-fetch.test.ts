/**
 * Bare-API-fetch guard — the tripwire against client islands calling the
 * gateway with a bare relative path.
 *
 * In production the api-gateway is a SEPARATE origin
 * (e.g. https://api.borjie.co.tz). owner-web has no `/api/v1` route and no
 * rewrite, so a `fetch('/api/v1/...')` from a client component 404s — and
 * even against the right origin it would 401, because a bare fetch attaches
 * no Supabase Bearer. Every gateway call MUST route through the
 * `apiRequest` / `API_BASE` helpers in `@/lib/api-client`, which prepend the
 * gateway base and attach the bearer.
 *
 * This test recursively scans the owner-web source tree and fails the build
 * if any file contains a bare `fetch('/api...')` / `fetch(`/api...`)` /
 * `fetch("/api...")` literal. The class therefore cannot silently regress.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

// Vitest runs with cwd = the owner-web package root, so the source tree is
// always ./src. Avoids import.meta (disallowed under the CJS tsc).
const SRC_ROOT = resolve(process.cwd(), 'src');

// Matches `fetch(` followed by optional whitespace and an opening quote
// (single, double, or backtick) then `/api`. Catches the three bare forms
// the gateway client is meant to replace, regardless of the rest of the path.
const BARE_API_FETCH = /fetch\(\s*['"`]\/api/;

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx']);

function listSourceFiles(dir: string): readonly string[] {
  const entries = readdirSync(dir);
  return entries.flatMap((entry) => {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      // Skip test fixtures and the guard's own directory — a test file may
      // legitimately mention the forbidden literal in a string/comment.
      if (entry === '__tests__' || entry === 'node_modules') return [];
      return listSourceFiles(full);
    }
    const dotIdx = entry.lastIndexOf('.');
    const ext = dotIdx === -1 ? '' : entry.slice(dotIdx);
    if (!SOURCE_EXTENSIONS.has(ext)) return [];
    return [full];
  });
}

function findBareApiFetches(root: string): readonly string[] {
  return listSourceFiles(root).filter((file) => {
    const contents = readFileSync(file, 'utf8');
    return BARE_API_FETCH.test(contents);
  });
}

describe('no bare /api fetch — owner-web gateway-client guard', () => {
  it('routes every gateway call through apiRequest / API_BASE (no bare fetch)', () => {
    const offenders = findBareApiFetches(SRC_ROOT).map((file) =>
      relative(SRC_ROOT, file),
    );
    expect(
      offenders,
      'These client files call the gateway with a bare relative path. In ' +
        'production the gateway is a separate origin, so these 404 (and 401 ' +
        'without the Supabase Bearer). Route them through apiRequest / ' +
        'API_BASE from @/lib/api-client:\n' +
        offenders.join('\n'),
    ).toEqual([]);
  });
});
