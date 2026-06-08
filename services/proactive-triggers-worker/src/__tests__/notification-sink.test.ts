import { describe, expect, it, vi } from 'vitest';
import type {
  ChannelDispatcher,
  FollowupCandidate,
  FollowupChannel,
} from '@borjie/user-followup';
import type { Trigger } from '@borjie/user-context-store';
import {
  createNotificationSink,
  type NotificationRecipient,
  type RecipientResolver,
} from '../sinks/notification-sink.js';

function trigger(overrides: Partial<Trigger> = {}): Trigger {
  return {
    id: 'bn_abc1234567',
    kind: 'owner.insurance_expiring_60d',
    urgency: 5,
    summary: 'Insurance expires in 14 days',
    suggestedAction: 'Renew the policy',
    suggestedPromptForChat: 'Help me renew insurance',
    triggeringEvidence: [{ kind: 'property', id: 'p1' }],
    ...overrides,
  };
}

function resolver(
  recipient: NotificationRecipient | null,
): RecipientResolver {
  return { resolve: async () => recipient };
}

function spyDispatcher(
  channel: FollowupChannel,
  result: { delivered: boolean; error?: string } = { delivered: true },
): ChannelDispatcher & { calls: FollowupCandidate[] } {
  const calls: FollowupCandidate[] = [];
  return {
    channel,
    calls,
    async dispatch(candidate) {
      calls.push(candidate);
      return {
        delivered: result.delivered,
        delivered_at: new Date().toISOString(),
        ...(result.error ? { error: result.error } : {}),
      };
    },
  };
}

const baseRecipient: NotificationRecipient = {
  email: 'owner@example.tz',
  locale: 'en',
  allowedChannels: ['email'],
};

describe('createNotificationSink', () => {
  it('dispatches via the recipient preferred channel and passes trigger id as candidate id', async () => {
    const email = spyDispatcher('email');
    const sink = createNotificationSink({
      logger: { info: vi.fn(), warn: vi.fn() },
      resolveRecipient: resolver(baseRecipient),
      dispatchers: new Map([['email', email]]),
    });

    await sink.emit({ tenantId: 't1', userId: 'u1', role: 'owner', trigger: trigger() });

    expect(email.calls).toHaveLength(1);
    const candidate = email.calls[0]!;
    expect(candidate.id).toBe('bn_abc1234567');
    expect(candidate.tenant_id).toBe('t1');
    expect(candidate.user_id).toBe('u1');
    expect(candidate.channel).toBe('email');
    expect(candidate.payload.text).toContain('Insurance expires in 14 days');
    expect(candidate.payload.text).toContain('Renew the policy');
    expect(candidate.critical).toBe(true); // urgency 5
    expect(candidate.priority).toBe(1);
  });

  it('falls back to email when preferred channel is not allowed', async () => {
    const email = spyDispatcher('email');
    const sink = createNotificationSink({
      logger: { info: vi.fn(), warn: vi.fn() },
      resolveRecipient: resolver({
        ...baseRecipient,
        allowedChannels: ['email'],
        preferredChannel: 'whatsapp',
      }),
      dispatchers: new Map([['email', email]]),
    });

    await sink.emit({ tenantId: 't1', userId: 'u1', role: 'owner', trigger: trigger() });
    expect(email.calls).toHaveLength(1);
    expect(email.calls[0]!.channel).toBe('email');
  });

  it('suppresses when no recipient resolves', async () => {
    const email = spyDispatcher('email');
    const warn = vi.fn();
    const sink = createNotificationSink({
      logger: { info: vi.fn(), warn },
      resolveRecipient: resolver(null),
      dispatchers: new Map([['email', email]]),
    });

    await sink.emit({ tenantId: 't1', userId: 'u1', role: 'owner', trigger: trigger() });
    expect(email.calls).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
  });

  it('suppresses when recipient fails validation (bad email)', async () => {
    const email = spyDispatcher('email');
    const warn = vi.fn();
    const sink = createNotificationSink({
      logger: { info: vi.fn(), warn },
      resolveRecipient: resolver({ ...baseRecipient, email: 'not-an-email' }),
      dispatchers: new Map([['email', email]]),
    });

    await sink.emit({ tenantId: 't1', userId: 'u1', role: 'owner', trigger: trigger() });
    expect(email.calls).toHaveLength(0);
    expect(warn).toHaveBeenCalled();
  });

  it('suppresses when no dispatcher exists for the resolved channel', async () => {
    const warn = vi.fn();
    const sink = createNotificationSink({
      logger: { info: vi.fn(), warn },
      resolveRecipient: resolver({ ...baseRecipient, allowedChannels: ['inapp'] }),
      dispatchers: new Map(), // no inapp dispatcher
    });

    await sink.emit({ tenantId: 't1', userId: 'u1', role: 'owner', trigger: trigger() });
    expect(warn).toHaveBeenCalled();
  });

  it('does not throw when the dispatcher throws — logs and continues', async () => {
    const warn = vi.fn();
    const throwing: ChannelDispatcher = {
      channel: 'email',
      dispatch: async () => {
        throw new Error('resend down');
      },
    };
    const sink = createNotificationSink({
      logger: { info: vi.fn(), warn },
      resolveRecipient: resolver(baseRecipient),
      dispatchers: new Map([['email', throwing]]),
    });

    await expect(
      sink.emit({ tenantId: 't1', userId: 'u1', role: 'owner', trigger: trigger() }),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it('logs a warning when the dispatcher reports non-delivery', async () => {
    const warn = vi.fn();
    const email = spyDispatcher('email', { delivered: false, error: 'no_email_template_for_trigger' });
    const sink = createNotificationSink({
      logger: { info: vi.fn(), warn },
      resolveRecipient: resolver(baseRecipient),
      dispatchers: new Map([['email', email]]),
    });

    await sink.emit({ tenantId: 't1', userId: 'u1', role: 'owner', trigger: trigger() });
    expect(warn).toHaveBeenCalled();
  });
});
