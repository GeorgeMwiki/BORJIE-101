import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as mod from '../useOccupancyTimeline';
import { ApiClientError } from '../../client';
import { bootstrapTestClient, stubFetchSequence } from './test-utils';

describe('useOccupancyTimeline module', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    bootstrapTestClient();
  });

  it('exports the unit timeline hook', () => {
    expect(typeof mod.useUnitOccupancyTimeline).toBe('function');
  });

  it('happy path — GET /occupancy-timeline/:id/occupancy-timeline', async () => {
    const page = { items: [], page: 1, limit: 20, totalItems: 0, hasNextPage: false };
    stubFetchSequence([{ body: { success: true, data: page } }]);
    const res = await bootstrapTestClient().get(
      '/occupancy-timeline/u1/occupancy-timeline',
    );
    expect(res.data).toEqual(page);
  });

  it('error path — 500', async () => {
    stubFetchSequence([
      { ok: false, status: 500, body: { error: { code: 'INTERNAL', message: 'x' } } },
    ]);
    await expect(
      bootstrapTestClient().get('/occupancy-timeline/u1/occupancy-timeline'),
    ).rejects.toBeInstanceOf(ApiClientError);
  });
});
