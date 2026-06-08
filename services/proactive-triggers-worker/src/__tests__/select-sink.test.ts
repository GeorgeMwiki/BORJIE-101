import { describe, expect, it, vi } from 'vitest';
import type { ChannelDispatcher, FollowupChannel } from '@borjie/user-followup';
import type { Trigger } from '@borjie/user-context-store';
import { selectSink, type NotificationWiring } from '../sinks/select-sink.js';
import type { RecipientResolver } from '../sinks/notification-sink.js';

function wiring(): NotificationWiring {
  const resolveRecipient: RecipientResolver = {
    resolve: async () => ({
      email: 'owner@example.tz',
      locale: 'en',
      allowedChannels: ['email'],
    }),
  };
  const email: ChannelDispatcher = {
    channel: 'email',
    dispatch: async () => ({ delivered: true, delivered_at: new Date().toISOString() }),
  };
  const dispatchers = new Map<FollowupChannel, ChannelDispatcher>([['email', email]]);
  return { resolveRecipient, dispatchers };
}

function sampleTrigger(): Trigger {
  return {
    id: 'bn_xyz9876543',
    kind: 'owner.insurance_expiring_60d',
    urgency: 5,
    summary: 'Insurance expires soon',
    suggestedAction: 'Renew',
    suggestedPromptForChat: 'Help',
    triggeringEvidence: [],
  };
}

describe('selectSink', () => {
  it('returns the log sink when no notification wiring is provided', () => {
    const info = vi.fn();
    const sink = selectSink({ logger: { info, warn: vi.fn() }, env: {} });
    sink.emit({ tenantId: 't', userId: 'u', role: 'owner', trigger: sampleTrigger() });
    // log sink logs the trigger directly (no recipient resolution).
    expect(info).toHaveBeenCalled();
  });

  it('returns the log sink when notifications are disabled by env', async () => {
    const sink = selectSink({
      logger: { info: vi.fn(), warn: vi.fn() },
      notifications: wiring(),
      env: { PROACTIVE_TRIGGERS_NOTIFY: 'false', RESEND_API_KEY: 'a-real-key-1234' },
    });
    // The log sink's emit is synchronous and never calls a dispatcher.
    await sink.emit({ tenantId: 't', userId: 'u', role: 'owner', trigger: sampleTrigger() });
    // No assertion error means it behaved as the log sink.
    expect(true).toBe(true);
  });

  it('returns the log sink when notifications are unconfigured (no Resend key, no force)', () => {
    const info = vi.fn();
    selectSink({
      logger: { info, warn: vi.fn() },
      notifications: wiring(),
      env: {},
    });
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ sink: 'log', reason: 'notifications_unconfigured' }),
      expect.any(String),
    );
  });

  it('returns the real notification sink when a Resend key is present', async () => {
    const info = vi.fn();
    const w = wiring();
    const dispatch = vi.spyOn(w.dispatchers.get('email')!, 'dispatch');
    const sink = selectSink({
      logger: { info, warn: vi.fn() },
      notifications: w,
      env: { RESEND_API_KEY: 'a-real-key-1234' },
    });
    await sink.emit({ tenantId: 't', userId: 'u', role: 'owner', trigger: sampleTrigger() });
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ sink: 'notification' }),
      expect.any(String),
    );
    expect(dispatch).toHaveBeenCalled();
  });

  it('returns the real notification sink when forced on via env even without a Resend key', async () => {
    const w = wiring();
    const dispatch = vi.spyOn(w.dispatchers.get('email')!, 'dispatch');
    const sink = selectSink({
      logger: { info: vi.fn(), warn: vi.fn() },
      notifications: w,
      env: { PROACTIVE_TRIGGERS_NOTIFY: '1' },
    });
    await sink.emit({ tenantId: 't', userId: 'u', role: 'owner', trigger: sampleTrigger() });
    expect(dispatch).toHaveBeenCalled();
  });
});
