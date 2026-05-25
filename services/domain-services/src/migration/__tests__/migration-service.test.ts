/**
 * MigrationService commit-path unit tests.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { MigrationService } from '../migration-service.js';
import type { IMigrationRepository } from '../migration-repository.interface.js';
import type {
  MigrationRun,
  MigrationRunStatus,
  MigrationCommittedEvent,
} from '../migration-run.js';

function makeRun(overrides: Partial<MigrationRun> = {}): MigrationRun {
  return {
    id: 'run_1',
    tenantId: 'tenant_1',
    createdBy: 'user_1',
    status: 'approved',
    uploadFilename: 'roster.csv',
    uploadMimeType: 'text/csv',
    uploadSizeBytes: 1024,
    extractionSummary: null,
    diffSummary: null,
    committedSummary: null,
    errorMessage: null,
    createdAt: '2025-01-01T00:00:00Z',
    updatedAt: '2025-01-01T00:00:00Z',
    approvedAt: '2025-01-01T00:00:00Z',
    committedAt: null,
    bundle: {
      properties: [{ name: 'Eden Heights' }],
      units: [],
      tenants: [],
      employees: [],
      departments: [],
      teams: [],
    } as unknown as Record<string, unknown>,
    ...overrides,
  };
}

class FakeRepo implements IMigrationRepository {
  runs = new Map<string, MigrationRun>();
  transactionCalled = 0;
  shouldFail = false;

  async createRun(): Promise<MigrationRun> {
    throw new Error('not used');
  }
  async findRun(runId: string, tenantId: string): Promise<MigrationRun | null> {
    return this.runs.get(`${tenantId}::${runId}`) ?? null;
  }
  async updateStatus(
    runId: string,
    tenantId: string,
    status: MigrationRunStatus,
    patch?: Partial<MigrationRun>
  ): Promise<MigrationRun> {
    const key = `${tenantId}::${runId}`;
    const existing = this.runs.get(key);
    if (!existing) throw new Error('missing');
    const merged = { ...existing, ...patch, status };
    this.runs.set(key, merged);
    return merged;
  }
  async runInTransaction() {
    this.transactionCalled += 1;
    if (this.shouldFail) throw new Error('boom');
    return {
      counts: {
        properties: 1,
        units: 0,
        tenants: 0,
        employees: 0,
        departments: 0,
        teams: 0,
      },
      skipped: { properties: [], units: [], tenants: [], employees: [], departments: [], teams: [] },
    };
  }
}

describe('MigrationService.commit', () => {
  let repo: FakeRepo;
  let events: MigrationCommittedEvent[];
  let service: MigrationService;

  beforeEach(() => {
    repo = new FakeRepo();
    events = [];
    service = new MigrationService({
      repository: repo,
      eventBus: { emit: (e) => void events.push(e) },
      now: () => new Date('2025-06-01T00:00:00Z'),
    });
  });

  it('commits when run is approved', async () => {
    const run = makeRun();
    repo.runs.set(`${run.tenantId}::${run.id}`, run);

    const result = await service.commit({
      tenantId: run.tenantId,
      runId: run.id,
      actorId: 'user_1',
    });

    expect(result.ok).toBe(true);
    expect(repo.transactionCalled).toBe(1);
    const final = repo.runs.get(`${run.tenantId}::${run.id}`)!;
    expect(final.status).toBe('committed');
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('migration.committed');
  });

  it('rejects when status !== approved', async () => {
    const run = makeRun({ status: 'diffed' });
    repo.runs.set(`${run.tenantId}::${run.id}`, run);

    const result = await service.commit({
      tenantId: run.tenantId,
      runId: run.id,
      actorId: 'user_1',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('INVALID_STATUS');
  });

  it('returns RUN_NOT_FOUND for unknown runs', async () => {
    const result = await service.commit({
      tenantId: 't',
      runId: 'nope',
      actorId: 'u',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('RUN_NOT_FOUND');
  });

  it('marks run failed + surfaces error on repository failure', async () => {
    const run = makeRun();
    repo.runs.set(`${run.tenantId}::${run.id}`, run);
    repo.shouldFail = true;

    const result = await service.commit({
      tenantId: run.tenantId,
      runId: run.id,
      actorId: 'user_1',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('WRITE_FAILED');
    const final = repo.runs.get(`${run.tenantId}::${run.id}`)!;
    expect(final.status).toBe('failed');
    expect(final.errorMessage).toBe('boom');
  });

  it('rejects when bundle is missing', async () => {
    const run = makeRun({ bundle: null });
    repo.runs.set(`${run.tenantId}::${run.id}`, run);

    const result = await service.commit({
      tenantId: run.tenantId,
      runId: run.id,
      actorId: 'user_1',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('BUNDLE_MISSING');
  });
});
