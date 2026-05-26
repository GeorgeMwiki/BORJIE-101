/**
 * Tests for the offline leak-scanner.
 *
 * Persona: Mr. Mwikila, SEC-1.
 */
import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  defaultScanOptions,
  renderMarkdownReport,
  scanRepo,
  listTypeScriptFiles,
} from '../scan/leak-scanner.js';

async function scaffoldRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'tig-scan-'));
  await mkdir(join(root, 'services', 'svc-a', 'src'), { recursive: true });
  await mkdir(join(root, 'packages', 'pkg-a', 'src'), { recursive: true });

  // P0: raw sql with interpolation, no tenant_id
  await writeFile(
    join(root, 'services', 'svc-a', 'src', 'bad-sql.ts'),
    `import { sql } from 'drizzle-orm';
export async function badSql(db: any, userInput: string) {
  return db.execute(sql\`SELECT * FROM parcels WHERE id = \${userInput}\`);
}
`,
    'utf8',
  );

  // P1: db.select without tenant_id
  await writeFile(
    join(root, 'services', 'svc-a', 'src', 'bad-select.ts'),
    `export async function badSelect(db: any, parcels: any) {
  return db.select().from(parcels).where(parcels.id);
}
`,
    'utf8',
  );

  // OK: tenant_id present in nearby lines
  await writeFile(
    join(root, 'services', 'svc-a', 'src', 'good-select.ts'),
    `import { eq } from 'drizzle-orm';
export async function goodSelect(db: any, parcels: any, tenantId: string) {
  return db.select().from(parcels).where(eq(parcels.tenant_id, tenantId));
}
`,
    'utf8',
  );

  // P1: redis op without tenant prefix
  await writeFile(
    join(root, 'services', 'svc-a', 'src', 'bad-redis.ts'),
    `export async function badRedis(redis: any) {
  await redis.set('cache_key_global', '1');
}
`,
    'utf8',
  );

  // OK: redis op uses tenantKey()
  await writeFile(
    join(root, 'services', 'svc-a', 'src', 'good-redis.ts'),
    `export async function goodRedis(redis: any, tenantId: string) {
  await redis.set(tenantKey(tenantId, 'cache_key'), '1');
}
declare function tenantKey(t: string, k: string): string;
`,
    'utf8',
  );

  // Allowlisted file (observability)
  await mkdir(join(root, 'packages', 'observability', 'src'), { recursive: true });
  await writeFile(
    join(root, 'packages', 'observability', 'src', 'log.ts'),
    `export function log(redis: any) {
  redis.set('global_log_key', 'x');
}
`,
    'utf8',
  );

  return root;
}

describe('leak-scanner', () => {
  it('detects P0 raw-sql-with-interpolation leak', async () => {
    const root = await scaffoldRepo();
    const result = await scanRepo(defaultScanOptions(root));
    const p0 = result.findings.filter((f) => f.severity === 'P0');
    expect(p0.length).toBeGreaterThanOrEqual(1);
    expect(p0[0]!.kind).toBe('drizzle-unscoped');
  });

  it('detects P1 unscoped Drizzle select', async () => {
    const root = await scaffoldRepo();
    const result = await scanRepo(defaultScanOptions(root));
    const hasDrizzleP1 = result.findings.some(
      (f) => f.kind === 'drizzle-unscoped' && f.file.endsWith('bad-select.ts'),
    );
    expect(hasDrizzleP1).toBe(true);
  });

  it('detects P1 unprefixed Redis op', async () => {
    const root = await scaffoldRepo();
    const result = await scanRepo(defaultScanOptions(root));
    const hasRedis = result.findings.some(
      (f) => f.kind === 'redis-unprefixed' && f.file.endsWith('bad-redis.ts'),
    );
    expect(hasRedis).toBe(true);
  });

  it('does not flag tenant-aware select', async () => {
    const root = await scaffoldRepo();
    const result = await scanRepo(defaultScanOptions(root));
    const hasGood = result.findings.some((f) => f.file.endsWith('good-select.ts'));
    expect(hasGood).toBe(false);
  });

  it('does not flag tenant-prefixed redis', async () => {
    const root = await scaffoldRepo();
    const result = await scanRepo(defaultScanOptions(root));
    const hasGood = result.findings.some((f) => f.file.endsWith('good-redis.ts'));
    expect(hasGood).toBe(false);
  });

  it('skips allowlisted packages (observability)', async () => {
    const root = await scaffoldRepo();
    const result = await scanRepo(defaultScanOptions(root));
    const obs = result.findings.some((f) => f.file.includes('packages/observability'));
    expect(obs).toBe(false);
  });

  it('renderMarkdownReport produces a deterministic, non-empty report', async () => {
    const root = await scaffoldRepo();
    const result = await scanRepo(defaultScanOptions(root));
    const report = renderMarkdownReport(result, {
      date: '2026-05-26',
      repoRoot: root,
    });
    expect(report).toContain('# Cross-Tenant Leak Scan');
    expect(report).toContain('## Severity summary');
    expect(report).toContain('## Findings');
  });

  it('listTypeScriptFiles excludes node_modules and dist', async () => {
    const root = await scaffoldRepo();
    const files = await listTypeScriptFiles(root, ['/node_modules/', '/dist/']);
    expect(files.every((f) => !f.includes('node_modules'))).toBe(true);
    expect(files.length).toBeGreaterThan(0);
  });
});
