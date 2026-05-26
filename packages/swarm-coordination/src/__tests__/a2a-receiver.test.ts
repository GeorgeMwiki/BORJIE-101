import { describe, it, expect } from 'vitest';
import { createA2AReceiver } from '../messaging/a2a-receiver.js';
import { createA2ASender } from '../messaging/a2a-sender.js';
import { classifyRouting } from '../messaging/message-router.js';
import { createInMemoryAgentMessagesRepository } from '../storage/agent-messages-repository.js';

describe('a2a-receiver', () => {
  it('pulls unacked direct messages for an agent', async () => {
    const repo = createInMemoryAgentMessagesRepository();
    const sender = createA2ASender(repo);
    const receiver = createA2AReceiver(repo);
    await sender.send({
      tenantId: 't1',
      fromAgentId: 'a',
      toAgentId: 'b',
      messageKind: 'request',
      payload: { task: 'investigate' },
    });
    const pulled = await receiver.pullForAgent('t1', 'b');
    expect(pulled.length).toBe(1);
    expect(pulled[0]?.messageKind).toBe('request');
  });

  it('does not re-deliver acked messages', async () => {
    const repo = createInMemoryAgentMessagesRepository();
    const sender = createA2ASender(repo);
    const receiver = createA2AReceiver(repo);
    const sent = await sender.send({
      tenantId: 't1',
      fromAgentId: 'a',
      toAgentId: 'b',
      messageKind: 'inform',
      payload: {},
    });
    await receiver.ack('t1', sent.id);
    const pulled = await receiver.pullForAgent('t1', 'b');
    expect(pulled.length).toBe(0);
  });

  it('pulls subject-scoped messages', async () => {
    const repo = createInMemoryAgentMessagesRepository();
    const sender = createA2ASender(repo);
    const receiver = createA2AReceiver(repo);
    await sender.send({
      tenantId: 't1',
      fromAgentId: 'a',
      toSubject: { kind: 'parcel', id: 'X' },
      messageKind: 'conflict',
      payload: {},
    });
    const pulled = await receiver.pullForSubject('t1', {
      kind: 'parcel',
      id: 'X',
    });
    expect(pulled.length).toBe(1);
  });
});

describe('message-router classifier', () => {
  it('classifies direct correctly', () => {
    expect(
      classifyRouting({
        tenantId: 't',
        fromAgentId: 'a',
        toAgentId: 'b',
        messageKind: 'inform',
        payload: {},
      }),
    ).toBe('direct');
  });

  it('classifies broadcast correctly', () => {
    expect(
      classifyRouting({
        tenantId: 't',
        fromAgentId: 'a',
        messageKind: 'inform',
        payload: {},
      }),
    ).toBe('broadcast');
  });

  it('classifies subject-scoped correctly', () => {
    expect(
      classifyRouting({
        tenantId: 't',
        fromAgentId: 'a',
        toSubject: { kind: 'k', id: 'i' },
        messageKind: 'conflict',
        payload: {},
      }),
    ).toBe('subject_scoped');
  });

  it('rejects direct + subject mixed routing', () => {
    expect(() =>
      classifyRouting({
        tenantId: 't',
        fromAgentId: 'a',
        toAgentId: 'b',
        toSubject: { kind: 'k', id: 'i' },
        messageKind: 'inform',
        payload: {},
      }),
    ).toThrow();
  });
});
