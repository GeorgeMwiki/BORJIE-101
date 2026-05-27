/**
 * migration-manager tests — verify ordered apply, idempotent re-run,
 * down rollback, and tenant requirement.
 */
import { describe, expect, it } from 'vitest';
import {
  createInMemoryMigrationLog,
  createMigrationManager,
  type CypherMigration,
} from '../schema/migration-manager.js';
import { GraphDatabaseError, type GraphDriverPort } from '../types.js';

function recordingDriver(): {
  readonly driver: GraphDriverPort;
  readonly runs: ReadonlyArray<string>;
} {
  const seen: string[] = [];
  return {
    runs: seen,
    driver: {
      id: 'neo4j',
      async run(q) {
        seen.push(q.cypher);
        return { driver: 'neo4j', tenantId: q.tenantId, records: [], latencyMs: 0 };
      },
      async healthCheck() {
        return { ok: true, latencyMs: 0 };
      },
      async close() {
        // noop
      },
    },
  };
}

const MIGRATIONS: ReadonlyArray<CypherMigration> = [
  {
    version: 1,
    name: 'create-mine-constraint',
    description: 'unique on Mine.id per tenant',
    up:
      'MATCH (m:Mine {tenantId: $tenantId}) WITH m LIMIT 0 ' +
      'CREATE CONSTRAINT mine_id_unique IF NOT EXISTS ' +
      'FOR (m2:Mine {tenantId: $tenantId}) REQUIRE m2.id IS UNIQUE',
    down:
      'MATCH (m:Mine {tenantId: $tenantId}) WITH m LIMIT 0 ' +
      'DROP CONSTRAINT mine_id_unique IF EXISTS',
  },
  {
    version: 2,
    name: 'create-worker-index',
    description: 'index Worker.id per tenant',
    up:
      'CREATE INDEX worker_id IF NOT EXISTS FOR (w:Worker {tenantId: $tenantId}) ON (w.id)',
  },
];

describe('createMigrationManager', () => {
  it('applies migrations in order and is idempotent', async () => {
    const { driver, runs } = recordingDriver();
    const log = createInMemoryMigrationLog();
    const mgr = createMigrationManager({ driver, log });
    const first = await mgr.applyUp(MIGRATIONS, '__global__');
    expect(first).toHaveLength(2);
    expect(runs).toHaveLength(2);
    expect(first[0]?.version).toBe(1);
    expect(first[1]?.version).toBe(2);
    // Re-running is a no-op
    const second = await mgr.applyUp(MIGRATIONS, '__global__');
    expect(second).toHaveLength(0);
    expect(runs).toHaveLength(2);
  });

  it('applyDown removes the recorded migration', async () => {
    const { driver } = recordingDriver();
    const log = createInMemoryMigrationLog();
    const mgr = createMigrationManager({ driver, log });
    await mgr.applyUp(MIGRATIONS, '__global__');
    const m1 = MIGRATIONS[0];
    if (!m1) throw new Error('test fixture broken');
    await mgr.applyDown(m1, '__global__');
    const after = await log.listApplied('__global__');
    expect(after.map((r) => r.version)).toEqual([2]);
  });

  it('rejects empty tenant', async () => {
    const { driver } = recordingDriver();
    const log = createInMemoryMigrationLog();
    const mgr = createMigrationManager({ driver, log });
    await expect(mgr.applyUp(MIGRATIONS, '')).rejects.toThrow(
      GraphDatabaseError,
    );
  });

  it('rejects down without a down script', async () => {
    const { driver } = recordingDriver();
    const log = createInMemoryMigrationLog();
    const mgr = createMigrationManager({ driver, log });
    const m2 = MIGRATIONS[1];
    if (!m2) throw new Error('test fixture broken');
    await mgr.applyUp(MIGRATIONS, '__global__');
    await expect(mgr.applyDown(m2, '__global__')).rejects.toThrow(
      GraphDatabaseError,
    );
  });

  it('round-trip: up → down → up keeps the log consistent', async () => {
    const { driver } = recordingDriver();
    const log = createInMemoryMigrationLog();
    const mgr = createMigrationManager({ driver, log });
    await mgr.applyUp(MIGRATIONS, '__global__');
    const m1 = MIGRATIONS[0];
    if (!m1) throw new Error('test fixture broken');
    await mgr.applyDown(m1, '__global__');
    expect((await log.listApplied('__global__')).map((r) => r.version)).toEqual([2]);
    // Re-applying brings v1 back
    const reapplied = await mgr.applyUp(MIGRATIONS, '__global__');
    expect(reapplied).toHaveLength(1);
    expect(reapplied[0]?.version).toBe(1);
  });
});
