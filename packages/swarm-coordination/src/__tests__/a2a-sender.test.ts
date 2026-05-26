import { describe, it, expect } from 'vitest';
import { createA2ASender } from '../messaging/a2a-sender.js';
import { createInMemoryAgentMessagesRepository } from '../storage/agent-messages-repository.js';

describe('a2a-sender', () => {
  it('sends a direct inform message', async () => {
    const repo = createInMemoryAgentMessagesRepository();
    const sender = createA2ASender(repo);
    const msg = await sender.send({
      tenantId: 't1',
      fromAgentId: 'mr-mwikila',
      toAgentId: 'safety-officer',
      messageKind: 'inform',
      payload: { topic: 'new-cell-71a3' },
    });
    expect(msg.toAgentId).toBe('safety-officer');
    expect(msg.toSubject).toBeNull();
    expect(msg.ackAt).toBeNull();
  });

  it('sends a subject-scoped conflict message', async () => {
    const repo = createInMemoryAgentMessagesRepository();
    const sender = createA2ASender(repo);
    const msg = await sender.send({
      tenantId: 't1',
      fromAgentId: 'junior-A',
      toSubject: { kind: 'parcel', id: 'KAH-088-A' },
      messageKind: 'conflict',
      payload: { reason: 'duplicate-mutation' },
    });
    expect(msg.toAgentId).toBeNull();
    expect(msg.toSubject?.id).toBe('KAH-088-A');
    expect(msg.messageKind).toBe('conflict');
  });

  it('rejects an unknown message kind', async () => {
    const repo = createInMemoryAgentMessagesRepository();
    const sender = createA2ASender(repo);
    await expect(
      sender.send({
        tenantId: 't1',
        fromAgentId: 'mr-mwikila',
        // @ts-expect-error — testing invalid input rejection.
        messageKind: 'bogus',
        payload: {},
      }),
    ).rejects.toThrow();
  });
});
