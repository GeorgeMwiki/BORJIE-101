import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as mod from '../useInteractiveReports';
import { ApiClientError } from '../../client';
import { bootstrapTestClient, stubFetchSequence } from './test-utils';

describe('useInteractiveReports module', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    bootstrapTestClient();
  });

  it('exports get + ack hooks', () => {
    expect(typeof mod.useInteractiveReport).toBe('function');
    expect(typeof mod.useAckActionPlan).toBe('function');
  });

  it('happy path — GET /interactive-reports/:id/interactive', async () => {
    const v = { id: 'v1', version: 1, sections: [], actionPlans: [] };
    stubFetchSequence([{ body: { success: true, data: v } }]);
    const res = await bootstrapTestClient().get(
      '/interactive-reports/r1/interactive',
    );
    expect(res.data).toEqual(v);
  });

  it('error path — 501 service not bound', async () => {
    stubFetchSequence([
      { ok: false, status: 501, body: { error: { code: 'NOT_IMPLEMENTED', message: 'x' } } },
    ]);
    await expect(
      bootstrapTestClient().post('/interactive-reports/v1/action-plans/a1/ack', {}),
    ).rejects.toBeInstanceOf(ApiClientError);
  });
});
