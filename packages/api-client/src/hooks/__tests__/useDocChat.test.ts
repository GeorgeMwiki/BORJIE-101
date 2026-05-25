import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as mod from '../useDocChat';
import { ApiClientError } from '../../client';
import { bootstrapTestClient, stubFetchSequence } from './test-utils';

describe('useDocChat module', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    bootstrapTestClient();
  });

  it('exports session / messages / start / ask / post hooks', () => {
    expect(typeof mod.useDocChatSession).toBe('function');
    expect(typeof mod.useDocChatMessages).toBe('function');
    expect(typeof mod.useStartDocChatSession).toBe('function');
    expect(typeof mod.useAskDocChat).toBe('function');
    expect(typeof mod.usePostDocChatMessage).toBe('function');
  });

  it('happy path — POST /doc-chat/sessions starts a session', async () => {
    const session = { id: 's1', scope: 'single_document', documentIds: ['d1'] };
    stubFetchSequence([{ body: { success: true, data: session } }]);
    const res = await bootstrapTestClient().post('/doc-chat/sessions', {
      documentIds: ['d1'],
    });
    expect(res.data).toEqual(session);
  });

  it('error path — 502 missing citations rejects an ask', async () => {
    stubFetchSequence([
      { ok: false, status: 502, body: { error: { code: 'MISSING_CITATIONS', message: 'x' } } },
    ]);
    await expect(
      bootstrapTestClient().post('/doc-chat/sessions/s1/ask', { question: 'q' }),
    ).rejects.toBeInstanceOf(ApiClientError);
  });
});
