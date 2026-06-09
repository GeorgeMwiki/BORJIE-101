/**
 * module-spawning/artifact-writer.ts — the real filesystem
 * `MigrationArtifactWriter`.
 *
 * Persists an APPLIED migration's SQL as a forensic audit artifact under
 * `packages/database/src/migrations/tenant-modules/<tenantId>/`. This is
 * a SEPARATE, governed, tenant-namespaced runtime class — it is NOT part
 * of the immutable forward-only CORE migration chain (03xx). Nothing in
 * this directory is replayed by the core migration runner.
 *
 * Tests inject a fake writer instead, so the real `fs` is never touched
 * under test.
 *
 * The root is resolved relative to this module via `__dirname` (the
 * api-gateway service compiles to CommonJS, so `import.meta` is not
 * available — the codebase pattern, see `routes/mining/docs.hono.ts`).
 * It walks up to the repo `packages/database/src/migrations/tenant-modules`
 * root.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, normalize, sep } from 'node:path';
import type { MigrationArtifactWriter } from './shared.js';

/**
 * Resolve the tenant-modules artifact root. The api-gateway service and
 * the `packages/database` package live under the same monorepo root, so
 * we anchor on the known absolute env override first, else fall back to a
 * monorepo-relative resolution from this file.
 */
function resolveArtifactRoot(): string {
  const override = process.env.BORJIE_TENANT_MODULES_DIR;
  if (override && override.length > 0) return resolve(override);
  // …/services/api-gateway/dist|src/composition/module-spawning/… → repo root.
  const repoRoot = resolve(__dirname, '../../../../../');
  return join(
    repoRoot,
    'packages',
    'database',
    'src',
    'migrations',
    'tenant-modules',
  );
}

export function createFsArtifactWriter(): MigrationArtifactWriter {
  const root = resolveArtifactRoot();
  return {
    async write(relativePath, migrationSql) {
      // `safeJoin` asserts the resolved target stays inside the
      // tenant-modules root (rejects any `..`-escape), so the dynamic
      // path is bounded — the fs sink is path-traversal-safe here.
      const target = safeJoin(root, relativePath);
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      await mkdir(dirname(target), { recursive: true });
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      await writeFile(target, migrationSql, { encoding: 'utf-8', flag: 'wx' });
    },
  };
}

/**
 * Join + assert the resolved target stays INSIDE `root` — defence in
 * depth against a `..`-bearing relative path escaping the artifact dir.
 */
function safeJoin(root: string, relativePath: string): string {
  const target = normalize(join(root, relativePath));
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  if (target !== root && !target.startsWith(rootWithSep)) {
    throw new Error('module-spawning: artifact path escapes the tenant-modules root');
  }
  return target;
}
