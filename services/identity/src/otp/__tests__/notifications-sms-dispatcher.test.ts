/**
 * Unit tests for NotificationsSmsDispatcher.
 *
 * Covers:
 *   - enqueue is called with the correct payload (channel, category, priority)
 *   - emergency priority is set so quiet-hours are bypassed by the notifications layer
 *   - template substitution / body pass-through preserves the numeric code
 *   - enqueue failure (thrown) surfaces as a dispatcher error
 *   - enqueue rejection (accepted: false) surfaces as a dispatcher error
 *   - tenantId is required
 */

import { describe, it, expect, vi } from 'vitest';
import {
  NotificationsSmsDispatcher,
  OTP_TEMPLATE_ID,
  OTP_SMS_TEMPLATE,
  type EnqueueNotificationFn,
  type EnqueueNotificationPayload,
  type EnqueueNotificationResult,
} from '../notifications-sms-dispatcher.js';

function silentLogger() {
  return { warn: vi.fn() };
}

function capturedEnqueue(
  overrides?: Partial<EnqueueNotificationResult>
): {
  enqueue: EnqueueNotificationFn;
  calls: EnqueueNotificationPayload[];
} {
  const calls: EnqueueNotificationPayload[] = [];
  const enqueue: EnqueueNotificationFn = async (input) => {
    calls.push(input);
    return {
      accepted: true,
      ...overrides,
    };
  };
  return { enqueue, calls };
}

const OTP_MESSAGE =
  'Your BORJIE verification code is 123456. It expires in 5 minutes.';

describe('NotificationsSmsDispatcher', () => {
  it('forwards to notifications.enqueue with the correct payload', async () => {
    const { enqueue, calls } = capturedEnqueue();
    const sms = new NotificationsSmsDispatcher({
      enqueue,
      tenantId: 'tenant_1',
      userId: 'user_42',
      correlationId: 'corr-abc',
      logger: silentLogger(),
    });

    await sms.send('+255712345678', OTP_MESSAGE);

    expect(calls).toHaveLength(1);
    const payload = calls[0];
    expect(payload.channel).toBe('sms');
    expect(payload.templateId).toBe(OTP_TEMPLATE_ID);
    expect(payload.tenantId).toBe('tenant_1');
    expect(payload.userId).toBe('user_42');
    expect(payload.recipient).toBe('+255712345678');
    expect(payload.correlationId).toBe('corr-abc');
  });

  it('uses emergency priority so notifications bypasses quiet hours', async () => {
    const { enqueue, calls } = capturedEnqueue();
    const sms = new NotificationsSmsDispatcher({
      enqueue,
      tenantId: 'tenant_1',
      logger: silentLogger(),
    });

    await sms.send('+255712345678', OTP_MESSAGE);

    expect(calls[0].priority).toBe('emergency');
  });

  it('substitutes the numeric code into the canonical template', async () => {
    const { enqueue, calls } = capturedEnqueue();
    const sms = new NotificationsSmsDispatcher({
      enqueue,
      tenantId: 'tenant_1',
      logger: silentLogger(),
    });

    await sms.send('+255712345678', OTP_MESSAGE);

    const payload = calls[0];
    const expectedBody = OTP_SMS_TEMPLATE.replace('{{code}}', '123456');
    expect(payload.body).toBe(expectedBody);
    expect(payload.data).toEqual({ code: '123456' });
    expect(payload.idempotencyKey).toBe('otp:tenant_1:+255712345678:123456');
  });

  it('passes the raw message through when no 6-digit code is present', async () => {
    const { enqueue, calls } = capturedEnqueue();
    const sms = new NotificationsSmsDispatcher({
      enqueue,
      tenantId: 'tenant_1',
      logger: silentLogger(),
    });

    await sms.send('+255712345678', 'free-form text with no code');

    const payload = calls[0];
    expect(payload.body).toBe('free-form text with no code');
    expect(payload.data).toBeUndefined();
    expect(payload.idempotencyKey).toBeUndefined();
  });

  it('throws when the notifications service throws', async () => {
    const enqueue: EnqueueNotificationFn = async () => {
      throw new Error('network down');
    };
    const warn = vi.fn();
    const sms = new NotificationsSmsDispatcher({
      enqueue,
      tenantId: 'tenant_1',
      logger: { warn },
    });

    await expect(sms.send('+255712345678', OTP_MESSAGE)).rejects.toThrow(
      /notifications service unavailable/
    );
    expect(warn).toHaveBeenCalledWith(
      'notifications service threw on enqueue',
      expect.objectContaining({ error: 'network down' })
    );
  });

  it('throws when the notifications dispatcher rejects (accepted=false)', async () => {
    const { enqueue } = capturedEnqueue({
      accepted: false,
      deadLettered: true,
      lastError: 'no provider configured',
    });
    const warn = vi.fn();
    const sms = new NotificationsSmsDispatcher({
      enqueue,
      tenantId: 'tenant_1',
      logger: { warn },
    });

    await expect(sms.send('+255712345678', OTP_MESSAGE)).rejects.toThrow(
      /enqueue rejected: no provider configured/
    );
    expect(warn).toHaveBeenCalled();
  });

  it('throws when the notifications layer suppresses by preferences', async () => {
    const { enqueue } = capturedEnqueue({
      accepted: false,
      suppressedReason: 'channel_disabled',
    });
    const warn = vi.fn();
    const sms = new NotificationsSmsDispatcher({
      enqueue,
      tenantId: 'tenant_1',
      logger: { warn },
    });

    await expect(sms.send('+255712345678', OTP_MESSAGE)).rejects.toThrow(
      /OTP suppressed \(channel_disabled\)/
    );
  });

  it('requires a non-empty tenantId', () => {
    const { enqueue } = capturedEnqueue();
    expect(
      () =>
        new NotificationsSmsDispatcher({
          enqueue,
          tenantId: '',
        })
    ).toThrow(/tenantId.*required/);
  });

  it('requires the enqueue function', () => {
    expect(
      () =>
        new NotificationsSmsDispatcher({
          // deliberate cast to exercise the guard clause
          enqueue: undefined as unknown as EnqueueNotificationFn,
          tenantId: 'tenant_1',
        })
    ).toThrow(/enqueue.*required/);
  });

  it('requires a non-empty phone at send time', async () => {
    const { enqueue } = capturedEnqueue();
    const sms = new NotificationsSmsDispatcher({
      enqueue,
      tenantId: 'tenant_1',
      logger: silentLogger(),
    });
    await expect(sms.send('', OTP_MESSAGE)).rejects.toThrow(/phone is required/);
  });
});
