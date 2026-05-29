/**
 * Dispatcher — retry + DLQ + preference gate (SCAFFOLDED 8 + NEW 21)
 */

import { describe, it, expect } from 'vitest';
import { enqueueNotification, type DispatcherDeps } from '../dispatcher.js';
import type { INotificationProvider } from '../providers/provider.interface.js';
import type { NotificationChannel, SendResult, TenantId } from '../types/index.js';

function buildMockProvider(
  channel: NotificationChannel,
  sequence: Array<SendResult | Error>
): INotificationProvider {
  let idx = 0;
  return {
    channel,
    name: `mock-${channel}`,
    isConfigured: () => true,
    async send(): Promise<SendResult> {
      const next = sequence[Math.min(idx++, sequence.length - 1)];
      if (next === undefined) throw new Error('mock sequence exhausted');
      if (next instanceof Error) throw next;
      return next;
    },
  };
}

const input = {
  tenantId: 'tenant-1' as TenantId,
  userId: 'user-a',
  channel: 'sms' as const,
  templateId: 'rent_due' as const,
  recipient: '+254700000000',
  body: 'Hello',
};

describe('enqueueNotification', () => {
  it('returns accepted on first successful provider call', async () => {
    const provider = buildMockProvider('sms', [
      { success: true, externalId: 'ext-1' },
    ]);
    const result = await enqueueNotification(input, {
      providers: {
        sms: [provider],
        email: [],
        push: [],
        whatsapp: [],
      },
      preferences: {
        checkAllowed: () => ({ allowed: true }),
      } as unknown as DispatcherDeps['preferences'],
      sleep: async () => undefined,
    });
    expect(result.accepted).toBe(true);
    expect(result.externalId).toBe('ext-1');
    expect(result.attempts).toBe(1);
  });

  it('retries on failure with exponential backoff and eventually succeeds', async () => {
    const provider = buildMockProvider('sms', [
      { success: false, error: 'transient' },
      { success: false, error: 'transient' },
      { success: true, externalId: 'ext-2' },
    ]);
    const sleeps: number[] = [];
    const result = await enqueueNotification(input, {
      providers: { sms: [provider], email: [], push: [], whatsapp: [] },
      preferences: {
        checkAllowed: () => ({ allowed: true }),
      } as unknown as DispatcherDeps['preferences'],
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    expect(result.accepted).toBe(true);
    expect(result.attempts).toBe(3);
    // Round-3 audit H4 — exponential backoff WITH ±25% jitter, so
    // the sleeps fall inside [750, 1250] and [1500, 2500].
    expect(sleeps).toHaveLength(2);
    expect(sleeps[0]).toBeGreaterThanOrEqual(750);
    expect(sleeps[0]).toBeLessThanOrEqual(1250);
    expect(sleeps[1]).toBeGreaterThanOrEqual(1500);
    expect(sleeps[1]).toBeLessThanOrEqual(2500);
  });

  it('dead-letters after 3 failed attempts and emits event', async () => {
    const provider = buildMockProvider('sms', [
      { success: false, error: 'fail1' },
      { success: false, error: 'fail2' },
      { success: false, error: 'fail3' },
    ]);
    const dlq: unknown[] = [];
    const events: Array<{ type: string; payload: unknown }> = [];
    const result = await enqueueNotification(input, {
      providers: { sms: [provider], email: [], push: [], whatsapp: [] },
      preferences: {
        checkAllowed: () => ({ allowed: true }),
      } as unknown as DispatcherDeps['preferences'],
      sleep: async () => undefined,
      deadLetterSink: { push: (r) => { dlq.push(r); } },
      eventBus: {
        publish: async (type, payload) => {
          events.push({ type, payload });
        },
      },
    });
    expect(result.accepted).toBe(false);
    expect(result.deadLettered).toBe(true);
    expect(result.attempts).toBe(3);
    expect(dlq.length).toBe(1);
    expect(events[0]?.type).toBe('NotificationDeliveryFailed');
  });

  it('respects preference gate — returns channel_disabled without touching provider', async () => {
    let called = false;
    const provider: INotificationProvider = {
      channel: 'sms',
      name: 'mock',
      isConfigured: () => true,
      async send() {
        called = true;
        return { success: true };
      },
    };
    const result = await enqueueNotification(input, {
      providers: { sms: [provider], email: [], push: [], whatsapp: [] },
      preferences: {
        checkAllowed: () => ({ allowed: false, reason: 'channel_disabled' }),
      } as unknown as DispatcherDeps['preferences'],
    });
    expect(result.accepted).toBe(false);
    expect(result.suppressedReason).toBe('channel_disabled');
    expect(called).toBe(false);
  });

  it('dead-letters immediately when no provider configured for channel', async () => {
    const dlq: unknown[] = [];
    const result = await enqueueNotification(input, {
      providers: { sms: [], email: [], push: [], whatsapp: [] },
      preferences: {
        checkAllowed: () => ({ allowed: true }),
      } as unknown as DispatcherDeps['preferences'],
      deadLetterSink: { push: (r) => { dlq.push(r); } },
    });
    expect(result.accepted).toBe(false);
    expect(result.deadLettered).toBe(true);
    expect(dlq.length).toBe(1);
  });

  it('cross-tenant denial — tenant-B provider must NOT serve tenant-A notification', async () => {
    // Round-3 audit H2 guarantees `selectProvider` returns null when no
    // tenant-matched provider exists, instead of falling back to
    // providers[0]. Here we register a provider whose `isConfigured` only
    // recognises tenant-B; a dispatch for tenant-A must dead-letter
    // instead of routing through B's provider (which would bill B for
    // A's traffic and leak credentials across tenants).
    const tenantBProvider: INotificationProvider = {
      channel: 'sms',
      name: 'tenant-b-only-twilio',
      isConfigured: (tid) => (tid as string) === 'tenant-b',
      async send(): Promise<SendResult> {
        throw new Error('tenant-B provider should never be reached for tenant-A');
      },
    };
    const dlq: Array<Record<string, unknown>> = [];
    const result = await enqueueNotification(
      {
        ...input,
        tenantId: 'tenant-a' as TenantId,
      },
      {
        providers: {
          sms: [tenantBProvider],
          email: [],
          push: [],
          whatsapp: [],
        },
        preferences: {
          checkAllowed: () => ({ allowed: true }),
        } as unknown as DispatcherDeps['preferences'],
        deadLetterSink: { push: (r) => { dlq.push(r as Record<string, unknown>); } },
      },
    );
    expect(result.accepted).toBe(false);
    expect(result.deadLettered).toBe(true);
    expect(dlq.length).toBe(1);
    expect(String(dlq[0]?.lastError)).toContain('No provider configured');
    expect(String(dlq[0]?.lastError)).toContain('tenant-a');
  });
});
