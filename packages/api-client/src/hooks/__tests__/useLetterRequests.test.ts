import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as mod from '../useLetterRequests';
import { ApiClientError } from '../../client';
import { bootstrapTestClient, stubFetchSequence } from './test-utils';

describe('useLetterRequests module', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    bootstrapTestClient();
  });

  it('exports detail / create / approve / download hooks', () => {
    expect(typeof mod.useLetterRequest).toBe('function');
    expect(typeof mod.useCreateLetterRequest).toBe('function');
    expect(typeof mod.useApproveLetterRequest).toBe('function');
    expect(typeof mod.useDownloadLetter).toBe('function');
  });

  it('happy path — POST /letters', async () => {
    const letter = { id: 'l1', letterType: 'residency_proof', status: 'draft' };
    stubFetchSequence([{ body: { success: true, data: letter } }]);
    const res = await bootstrapTestClient().post('/letters', {
      letterType: 'residency_proof',
    });
    expect(res.data).toEqual(letter);
  });

  it('error path — 501 not implemented surfaces as ApiClientError', async () => {
    stubFetchSequence([
      { ok: false, status: 501, body: { error: { code: 'NOT_IMPLEMENTED', message: 'x' } } },
    ]);
    await expect(bootstrapTestClient().get('/letters/l1')).rejects.toBeInstanceOf(
      ApiClientError,
    );
  });
});
