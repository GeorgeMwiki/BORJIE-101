import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as mod from '../useCompliance';
import { ApiClientError } from '../../client';
import { bootstrapTestClient, stubFetchSequence } from './test-utils';

describe('useCompliance module', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    bootstrapTestClient();
  });

  it('exports list / schedule / download hooks', () => {
    expect(typeof mod.useComplianceExports).toBe('function');
    expect(typeof mod.useScheduleComplianceExport).toBe('function');
    expect(typeof mod.useDownloadComplianceExport).toBe('function');
  });

  it('happy path — POST /compliance/exports schedules', async () => {
    const manifest = { id: 'e1', status: 'scheduled' };
    stubFetchSequence([{ body: { success: true, data: manifest } }]);
    const res = await bootstrapTestClient().post('/compliance/exports', {
      exportType: 'tz_tra',
      periodStart: '2026-01-01',
      periodEnd: '2026-01-31',
    });
    expect(res.data).toEqual(manifest);
  });

  it('error path — 400 invalid period', async () => {
    stubFetchSequence([
      { ok: false, status: 400, body: { error: { code: 'BAD_PERIOD', message: 'x' } } },
    ]);
    await expect(
      bootstrapTestClient().post('/compliance/exports', {}),
    ).rejects.toBeInstanceOf(ApiClientError);
  });
});
