/**
 * `@ts-nocheck` tracking regression — HIGH 4.1 from the 2026-05-19
 * post-PR-90 data-layer sweep.
 *
 * Background:
 * Every repository under `packages/database/src/repositories/` (except
 * `base.repository.ts`) carries `// @ts-nocheck` at the top of the
 * file due to a drizzle-orm v0.36 pgEnum narrowing issue
 * (drizzle-team/drizzle-orm#2389 — eq() with a pgEnum column accepts
 * only the literal union, while repo params arrive as `string`).
 *
 * The audit doc's HIGH 4.1 concern is: with the whole file unchecked,
 * a future regression that forgets the tenant filter has no compile-
 * time gate. This test enforces TWO ratchet properties so the
 * `@ts-nocheck` exemption doesn't grow silently:
 *
 *   1. EVERY repo file carrying `@ts-nocheck` MUST also reference the
 *      tracking issue URL or number (drizzle-team/drizzle-orm#2389 or
 *      #2876) in its header comment, so the exemption is auditable and
 *      removable when the upstream lands.
 *   2. EVERY repo file carrying `@ts-nocheck` MUST have at least one
 *      `eq(<table>.tenantId, ...)` expression in its body (i.e. the
 *      repo IS tenant-aware; the exemption is not hiding a fully
 *      cross-tenant repo). Repos that are intentionally cross-tenant
 *      (admin-platform-only) should NOT carry `@ts-nocheck`; if they
 *      need it, add them to `CROSS_TENANT_REPOS` below with a reason.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPOS_DIR = fileURLToPath(new URL('..', import.meta.url));

/**
 * Allowlisted intentionally-cross-tenant repos (none today). Each entry
 * MUST carry a justification.
 */
const CROSS_TENANT_REPOS = new Map<string, string>([
  // 'super-admin.repository.ts': 'admin-only; no tenant scoping by design',
]);

const TRACKING_ISSUE_RX =
  /(drizzle-team\/drizzle-orm#\d+|drizzle-orm v0\.36)/i;

const TENANT_FILTER_RX =
  /eq\s*\(\s*[^,]+\.tenantId\s*,\s*[a-zA-Z_$][\w$.]*/;

function readRepoFiles(): Array<{ name: string; path: string; body: string }> {
  return readdirSync(REPOS_DIR)
    .filter((n) => n.endsWith('.repository.ts'))
    .map((n) => ({
      name: n,
      path: join(REPOS_DIR, n),
      body: readFileSync(join(REPOS_DIR, n), 'utf8'),
    }));
}

describe('repositories — @ts-nocheck audit ratchet (HIGH 4.1)', () => {
  const files = readRepoFiles();

  it('discovers all repository files', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const f of files) {
    const hasNoCheck = /^\/\/\s*@ts-nocheck/m.test(f.body.slice(0, 400));

    if (!hasNoCheck) continue;

    it(`${f.name} — @ts-nocheck cites a tracking issue`, () => {
      expect(
        TRACKING_ISSUE_RX.test(f.body.slice(0, 800)),
        `${f.name} carries @ts-nocheck but its top-of-file comment does not cite a tracking issue (expected reference to drizzle-orm#2389 / #2876 or drizzle-orm v0.36).`,
      ).toBe(true);
    });

    it(`${f.name} — body references a tenant filter`, () => {
      if (CROSS_TENANT_REPOS.has(f.name)) {
        return;
      }
      expect(
        TENANT_FILTER_RX.test(f.body),
        `${f.name} carries @ts-nocheck but its body has NO eq(*.tenantId, ...) expression — either the file is fully cross-tenant (add to CROSS_TENANT_REPOS) or it's missing tenant filters (CRITICAL leak).`,
      ).toBe(true);
    });
  }
});
