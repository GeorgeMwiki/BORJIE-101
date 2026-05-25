/**
 * migrate-prod tests — dir listing + planning + sha256 stability.
 *
 * These tests exercise the pure parts (filename parsing, plan diffing,
 * sha256 hashing). The transactional DB apply path is covered by
 * integration tests that run against a real Postgres.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { loadMigrations, planMigrations } from '../migrate-prod.js';

async function makeFixture(files: readonly { name: string; sql: string }[]): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'migrate-prod-'));
  for (const f of files) await writeFile(join(dir, f.name), f.sql, 'utf8');
  return dir;
}

describe('migrate-prod.loadMigrations', () => {
  let dir: string;
  beforeAll(async () => {
    dir = await makeFixture([
      { name: '0001_initial.sql', sql: 'CREATE TABLE a (id text);' },
      { name: '0002_audit.sql', sql: 'CREATE TABLE b (id text);' },
      { name: '0010_gepg.sql', sql: 'CREATE TABLE c (id text);' },
      { name: 'README.md', sql: '# not a migration' },
    ]);
  });

  it('lists SQL migrations in version order', async () => {
    const entries = await loadMigrations(dir);
    expect(entries.map((e) => e.filename)).toEqual([
      '0001_initial.sql', '0002_audit.sql', '0010_gepg.sql',
    ]);
  });

  it('hashes each migration deterministically (sha256)', async () => {
    const entries = await loadMigrations(dir);
    const expected = createHash('sha256').update('CREATE TABLE a (id text);').digest('hex');
    expect(entries[0]!.sha256).toBe(expected);
    // Hashes are unique across files.
    const hashes = new Set(entries.map((e) => e.sha256));
    expect(hashes.size).toBe(entries.length);
  });

  it('rejects filenames that do not match the safe pattern', async () => {
    const bad = await makeFixture([
      { name: 'bad name.sql', sql: 'select 1' },
    ]);
    await expect(loadMigrations(bad)).rejects.toThrow(/unsafe migration filename/);
  });
});

describe('migrate-prod.planMigrations', () => {
  const fixture = [
    { filename: '0001_initial.sql', version: '0001_initial', sha256: 'x', sql: '' },
    { filename: '0002_audit.sql', version: '0002_audit', sha256: 'y', sql: '' },
    { filename: '0003_new.sql', version: '0003_new', sha256: 'z', sql: '' },
  ] as const;

  it('returns every migration as pending when none applied', () => {
    const plan = planMigrations(fixture, []);
    expect(plan.pending.map((m) => m.version)).toEqual([
      '0001_initial', '0002_audit', '0003_new',
    ]);
  });

  it('returns empty pending when all applied', () => {
    const plan = planMigrations(fixture, [
      '0001_initial', '0002_audit', '0003_new',
    ]);
    expect(plan.pending).toHaveLength(0);
  });

  it('returns only the tail as pending when partial', () => {
    const plan = planMigrations(fixture, ['0001_initial', '0002_audit']);
    expect(plan.pending.map((m) => m.version)).toEqual(['0003_new']);
  });

  it('preserves order from input list', () => {
    const plan = planMigrations(fixture, []);
    expect(plan.all).toBe(fixture);
    expect(plan.pending[0]!.version < plan.pending[1]!.version).toBe(true);
  });
});
