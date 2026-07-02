/**
 * audit-service-role-tenant-scope scanner — unit tests.
 *
 * Spawns the scanner against a synthetic monorepo tree so the real repo layout
 * doesn't influence the outcome. Proves:
 *   • RED on the historical offender class (a `withServiceRoleContext` block
 *     querying a tenant-scoped table with NO tenantId bind — the reminders /
 *     dispatch RLS-darkness bug).
 *   • GREEN when the same query carries an `eq(table.tenantId, …)` bind.
 *   • allowlist ratchet drains a deliberate cross-tenant sweep.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const SCANNER = resolve(
  __filename,
  '..',
  '..',
  'ci',
  'audit-service-role-tenant-scope.mjs',
);

function runScanner(root: string): { code: number; report: any } {
  const res = spawnSync('node', [SCANNER, '--root', root, '--json'], {
    encoding: 'utf8',
  });
  let report: any = null;
  try {
    report = JSON.parse(res.stdout);
  } catch {
    report = { parseError: res.stdout, stderr: res.stderr };
  }
  return { code: res.status ?? 2, report };
}

const TENANT_SCHEMA = `
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';
export const reminders = pgTable('reminders', {
  id: text('id').primaryKey(),
  tenant_id: text('tenant_id').notNull(),
  dueAt: timestamp('due_at'),
});
`;

function scaffold(root: string): void {
  const schemasDir = join(root, 'packages', 'database', 'src', 'schemas');
  mkdirSync(schemasDir, { recursive: true });
  writeFileSync(join(schemasDir, 'reminders.schema.ts'), TENANT_SCHEMA);
}

describe('audit-service-role-tenant-scope scanner', () => {
  let tmp: string;

  beforeAll(() => {
    tmp = mkdtempSync(join(tmpdir(), 'srts-'));
    scaffold(tmp);
  });

  afterAll(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('is RED on the historical offender (service-role query, no tenant bind)', () => {
    const svcDir = join(tmp, 'services', 'reminders-worker', 'src');
    mkdirSync(svcDir, { recursive: true });
    // The reminders-darkness bug: withServiceRoleContext + query on a
    // tenant-scoped table with NO tenantId filter → spans/darkens all tenants.
    writeFileSync(
      join(svcDir, 'dark-worker.ts'),
      `
import { reminders } from '@borjie/database/schemas/reminders.schema.js';
export async function drainDue(db: any) {
  return withServiceRoleContext(db, async (tx) => {
    return tx.select().from(reminders).where(lt(reminders.dueAt, now()));
  });
}
`,
    );
    const { code, report } = runScanner(tmp);
    expect(code).toBe(1);
    expect(report.violations.length).toBe(1);
    expect(report.violations[0].file).toContain('dark-worker.ts');
    expect(report.violations[0].tables).toContain('reminders');
  });

  it('is GREEN once the query carries a tenantId bind', () => {
    const svc2 = mkdtempSync(join(tmpdir(), 'srts-ok-'));
    scaffold(svc2);
    const svcDir = join(svc2, 'services', 'reminders-worker', 'src');
    mkdirSync(svcDir, { recursive: true });
    writeFileSync(
      join(svcDir, 'bound-worker.ts'),
      `
import { reminders } from '@borjie/database/schemas/reminders.schema.js';
export async function drainDue(db: any, tenantId: string) {
  return withServiceRoleContext(db, async (tx) => {
    return tx.select().from(reminders).where(eq(reminders.tenant_id, tenantId));
  });
}
`,
    );
    const { code, report } = runScanner(svc2);
    rmSync(svc2, { recursive: true, force: true });
    expect(code).toBe(0);
    expect(report.violations.length).toBe(0);
  });

  it('ignores service-role queries on non-tenant-scoped (spine) tables', () => {
    const svc3 = mkdtempSync(join(tmpdir(), 'srts-spine-'));
    const schemasDir = join(svc3, 'packages', 'database', 'src', 'schemas');
    mkdirSync(schemasDir, { recursive: true });
    // A spine table with NO tenant_id column — global by design.
    writeFileSync(
      join(schemasDir, 'spine.schema.ts'),
      `
import { pgTable, text } from 'drizzle-orm/pg-core';
export const corpusChunks = pgTable('intelligence_corpus_chunks', {
  id: text('id').primaryKey(),
  body: text('body'),
});
`,
    );
    const svcDir = join(svc3, 'services', 'ingest', 'src');
    mkdirSync(svcDir, { recursive: true });
    writeFileSync(
      join(svcDir, 'ingest.ts'),
      `
import { corpusChunks } from '@borjie/database/schemas/spine.schema.js';
export async function readAll(db: any) {
  return withServiceRoleContext(db, async (tx) => tx.select().from(corpusChunks));
}
`,
    );
    const { code, report } = runScanner(svc3);
    rmSync(svc3, { recursive: true, force: true });
    expect(code).toBe(0);
    expect(report.violations.length).toBe(0);
  });
});
