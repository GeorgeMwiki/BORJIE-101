import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as mod from '../useStationMasterCoverage';
import { ApiClientError } from '../../client';
import { bootstrapTestClient, stubFetchSequence } from './test-utils';

describe('useStationMasterCoverage module', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    bootstrapTestClient();
  });

  it('exports get + put hooks', () => {
    expect(typeof mod.useStationMasterCoverage).toBe('function');
    expect(typeof mod.usePutStationMasterCoverage).toBe('function');
  });

  it('happy path — PUT /station-master-coverage/:id/coverage', async () => {
    const cov = { stationMasterId: 's1', coverages: [] };
    stubFetchSequence([{ body: { success: true, data: cov } }]);
    const res = await bootstrapTestClient().put(
      '/station-master-coverage/s1/coverage',
      { coverages: [] },
    );
    expect(res.data).toEqual(cov);
  });

  it('error path — 400 invalid coverage', async () => {
    stubFetchSequence([
      { ok: false, status: 400, body: { error: { code: 'VALIDATION', message: 'x' } } },
    ]);
    await expect(
      bootstrapTestClient().put('/station-master-coverage/s1/coverage', {}),
    ).rejects.toBeInstanceOf(ApiClientError);
  });
});
