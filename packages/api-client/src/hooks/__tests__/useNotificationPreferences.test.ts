import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as mod from '../useNotificationPreferences';
import { ApiClientError } from '../../client';
import { bootstrapTestClient, stubFetchSequence } from './test-utils';

describe('useNotificationPreferences module', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    bootstrapTestClient();
  });

  it('exports get + update hooks', () => {
    expect(typeof mod.useNotificationPreferences).toBe('function');
    expect(typeof mod.useUpdateNotificationPreferences).toBe('function');
  });

  it('happy path — PUT /me/notification-preferences', async () => {
    const prefs = {
      userId: 'u1',
      tenantId: 't1',
      channels: { email: true },
      templates: {},
    };
    stubFetchSequence([{ body: { success: true, data: prefs } }]);
    const res = await bootstrapTestClient().put('/me/notification-preferences', {
      channels: { email: true },
    });
    expect(res.data).toEqual(prefs);
  });

  it('error path — 400 invalid quiet hours', async () => {
    stubFetchSequence([
      { ok: false, status: 400, body: { error: { code: 'INVALID', message: 'x' } } },
    ]);
    await expect(
      bootstrapTestClient().put('/me/notification-preferences', {}),
    ).rejects.toBeInstanceOf(ApiClientError);
  });
});
