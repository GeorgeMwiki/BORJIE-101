import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as mod from '../useScans';
import { ApiClientError } from '../../client';
import { bootstrapTestClient, stubFetchSequence } from './test-utils';

describe('useScans module', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    bootstrapTestClient();
  });

  it('exports list / detail / create / upload / submit hooks', () => {
    expect(typeof mod.useScanBundles).toBe('function');
    expect(typeof mod.useScanBundle).toBe('function');
    expect(typeof mod.useCreateScanBundle).toBe('function');
    expect(typeof mod.useUploadScanPage).toBe('function');
    expect(typeof mod.useSubmitScanBundle).toBe('function');
  });

  it('happy path — POST /scans/bundles creates a bundle', async () => {
    const bundle = { id: 'b1', pageCount: 0, status: 'empty' };
    stubFetchSequence([{ body: { success: true, data: bundle } }]);
    const res = await bootstrapTestClient().post('/scans/bundles', {});
    expect(res.data).toEqual(bundle);
  });

  it('error path — 400 invalid page upload', async () => {
    stubFetchSequence([
      { ok: false, status: 400, body: { error: { code: 'BAD_PAGE', message: 'x' } } },
    ]);
    await expect(
      bootstrapTestClient().post('/scans/bundles/b1/pages', {}),
    ).rejects.toBeInstanceOf(ApiClientError);
  });
});
