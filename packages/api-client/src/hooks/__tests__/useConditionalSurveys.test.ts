import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as mod from '../useConditionalSurveys';
import { ApiClientError } from '../../client';
import { bootstrapTestClient, stubFetchSequence } from './test-utils';

describe('useConditionalSurveys module', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    bootstrapTestClient();
  });

  it('exports list / detail / schedule / compile / approve hooks', () => {
    expect(typeof mod.useConditionalSurveys).toBe('function');
    expect(typeof mod.useConditionalSurvey).toBe('function');
    expect(typeof mod.useScheduleConditionalSurvey).toBe('function');
    expect(typeof mod.useCompileConditionalSurvey).toBe('function');
    expect(typeof mod.useApproveSurveyAction).toBe('function');
  });

  it('happy path — POST /conditional-surveys schedules one', async () => {
    const s = { id: 'cs1', status: 'scheduled' };
    stubFetchSequence([{ body: { success: true, data: s } }]);
    const res = await bootstrapTestClient().post('/conditional-surveys', {
      templateId: 't1',
      scheduledFor: '2026-05-01',
    });
    expect(res.data).toEqual(s);
  });

  it('error path — 400 template not found', async () => {
    stubFetchSequence([
      { ok: false, status: 400, body: { error: { code: 'BAD_TEMPLATE', message: 'x' } } },
    ]);
    await expect(
      bootstrapTestClient().post('/conditional-surveys/cs1/compile', {}),
    ).rejects.toBeInstanceOf(ApiClientError);
  });
});
