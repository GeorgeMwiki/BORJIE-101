import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as mod from '../useMigration';
import { ApiClientError } from '../../client';
import { bootstrapTestClient, stubFetchSequence } from './test-utils';

describe('useMigration module', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    bootstrapTestClient();
  });

  it('exports run / upload / commit / ask hooks', () => {
    expect(typeof mod.useMigrationRun).toBe('function');
    expect(typeof mod.useMigrationUpload).toBe('function');
    expect(typeof mod.useMigrationCommit).toBe('function');
    expect(typeof mod.useMigrationAsk).toBe('function');
  });

  it('happy path — POST /migration/:runId/commit', async () => {
    const result = { ok: true, runId: 'r1', counts: {}, skipped: {} };
    stubFetchSequence([{ body: { success: true, data: result } }]);
    const res = await bootstrapTestClient().post('/migration/r1/commit', {});
    expect(res.data).toEqual(result);
  });

  it('error path — 409 conflict on commit', async () => {
    stubFetchSequence([
      { ok: false, status: 409, body: { error: { code: 'RUN_LOCKED', message: 'x' } } },
    ]);
    await expect(
      bootstrapTestClient().post('/migration/r1/commit', {}),
    ).rejects.toBeInstanceOf(ApiClientError);
  });
});
