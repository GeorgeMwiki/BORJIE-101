import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as mod from '../useApplications';
import { ApiClientError } from '../../client';
import { bootstrapTestClient, stubFetchSequence } from './test-utils';

describe('useApplications module', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    bootstrapTestClient();
  });

  it('exports route + submit hooks', () => {
    expect(typeof mod.useRouteApplication).toBe('function');
    expect(typeof mod.useSubmitApplication).toBe('function');
  });

  it('happy path — POST /applications/route', async () => {
    const result = { stationMasterId: 'sm1', score: 0.9 };
    stubFetchSequence([{ body: { success: true, data: result } }]);
    const res = await bootstrapTestClient().post('/applications/route', {
      applicationId: 'a1',
      assetType: 'residential',
      location: { city: 'Nairobi' },
    });
    expect(res.data).toEqual(result);
  });

  it('error path — 501 router not bound', async () => {
    stubFetchSequence([
      { ok: false, status: 501, body: { error: { code: 'NOT_IMPLEMENTED', message: 'x' } } },
    ]);
    await expect(
      bootstrapTestClient().post('/applications/route', {}),
    ).rejects.toBeInstanceOf(ApiClientError);
  });
});
