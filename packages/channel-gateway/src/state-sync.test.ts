import { describe, it, expect } from 'vitest';
import { createStateSync } from './state-sync.js';
import { createInMemoryConversationStore } from './in-memory-store.js';
import type { Clock } from './ports.js';
import type { ChannelEvent, ChannelKind } from './types.js';

function clockFrom(iso = '2026-06-03T10:00:00.000Z'): { clock: Clock; advance: (ms: number) => void } {
  let t = Date.parse(iso);
  return { clock: { now: () => new Date(t) }, advance: (ms) => (t += ms) };
}

function event(channel: ChannelKind, text: string, phone = '+255700111222', id = `e-${Math.random()}`): ChannelEvent {
  return {
    eventId: id,
    channel,
    sender: { raw: { phone }, tenantId: 'tenant-1', actorId: 'actor-1', tier: 'manager' },
    text,
    attachments: [],
    receivedAt: '2026-06-03T10:00:00.000Z',
    metadata: {},
    signatureVerified: true,
  };
}

describe('ingest', () => {
  it('creates a conversation and records the user turn', async () => {
    const { clock } = clockFrom();
    const sync = createStateSync({ store: createInMemoryConversationStore(), clock });
    const state = await sync.ingest('c1', event('whatsapp', 'hi'));
    expect(state.turns).toHaveLength(1);
    expect(state.turns[0]?.role).toBe('user');
    expect(state.lastChannel).toBe('whatsapp');
    expect(state.tenantId).toBe('tenant-1');
  });

  it('caps retained turns at maxTurns', async () => {
    const { clock } = clockFrom();
    const sync = createStateSync({ store: createInMemoryConversationStore(), clock, maxTurns: 3 });
    for (let i = 0; i < 5; i++) {
      await sync.ingest('c2', event('sms', `msg ${i}`, '+255700111222', `e-${i}`));
    }
    const state = await sync.get('c2');
    expect(state?.turns).toHaveLength(3);
    expect(state?.turns[2]?.text).toBe('msg 4');
  });
});

describe('appendAssistant', () => {
  it('appends an assistant turn and updates the active channel', async () => {
    const { clock } = clockFrom();
    const sync = createStateSync({ store: createInMemoryConversationStore(), clock });
    await sync.ingest('c3', event('web', 'question'));
    const state = await sync.appendAssistant('c3', 'web', 'answer');
    expect(state?.turns).toHaveLength(2);
    expect(state?.turns[1]?.role).toBe('assistant');
  });

  it('returns null for an unknown conversation', async () => {
    const sync = createStateSync({ store: createInMemoryConversationStore() });
    expect(await sync.appendAssistant('missing', 'web', 'x')).toBeNull();
  });
});

describe('WhatsApp 24h window', () => {
  it('opens on a WhatsApp ingest and closes after 24h', async () => {
    const { clock, advance } = clockFrom();
    const sync = createStateSync({ store: createInMemoryConversationStore(), clock });
    await sync.ingest('c4', event('whatsapp', 'hi'));
    expect(await sync.isWhatsAppWindowOpen('c4')).toBe(true);

    advance(24 * 60 * 60 * 1000 + 1000);
    expect(await sync.isWhatsAppWindowOpen('c4')).toBe(false);
  });

  it('is closed when there is no WhatsApp session', async () => {
    const { clock } = clockFrom();
    const sync = createStateSync({ store: createInMemoryConversationStore(), clock });
    await sync.ingest('c5', event('sms', 'hi'));
    expect(await sync.isWhatsAppWindowOpen('c5')).toBe(false);
  });
});

describe('handoff', () => {
  it('moves the active channel and tracks both sessions', async () => {
    const { clock } = clockFrom();
    const sync = createStateSync({ store: createInMemoryConversationStore(), clock });
    await sync.ingest('c6', event('whatsapp', 'started on whatsapp'));
    const result = await sync.handoff('c6', 'web', 'user-42');
    expect(result).not.toBeNull();
    expect(result?.fromChannel).toBe('whatsapp');
    expect(result?.toChannel).toBe('web');
    expect(result?.state.channelSessions.map((s) => s.channel).sort()).toEqual(['web', 'whatsapp']);
  });

  it('returns null when handing off an unknown conversation', async () => {
    const sync = createStateSync({ store: createInMemoryConversationStore() });
    expect(await sync.handoff('missing', 'web', 'x')).toBeNull();
  });
});
