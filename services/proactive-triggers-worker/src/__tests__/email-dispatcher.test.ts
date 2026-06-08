import { describe, expect, it, vi } from 'vitest';
import type { FollowupCandidate } from '@borjie/user-followup';
import { createEmailChannelDispatcher } from '../sinks/email-dispatcher.js';

function candidate(): FollowupCandidate {
  return {
    id: 'bn_abc1234567',
    tenant_id: 't1',
    user_id: 'u1',
    source: 'user_flag',
    payload: { text: 'Insurance expires in 14 days — Renew the policy' },
    priority: 1,
    channel: 'email',
    scheduled_for: new Date().toISOString(),
    status: 'pending',
    sent_at: null,
    audit_hash: '',
    created_at: new Date().toISOString(),
    critical: true,
  };
}

describe('createEmailChannelDispatcher', () => {
  it('declines (non-delivery) when the trigger has no matching template facts', async () => {
    const send = vi.fn();
    const dispatcher = createEmailChannelDispatcher({
      to: 'owner@example.tz',
      lang: 'en',
      recipientName: 'Asha',
      send: send as never,
    });
    const result = await dispatcher.dispatch(candidate());
    expect(result.delivered).toBe(false);
    expect(result.error).toBe('no_email_template_for_trigger');
    expect(send).not.toHaveBeenCalled();
  });

  it('sends the licence-expiry template with truthful facts and threads the idempotency key', async () => {
    const send = vi.fn().mockResolvedValue({
      message_id: 'm1',
      provider: 'resend',
      to: ['owner@example.tz'],
      subject: 's',
    });
    const dispatcher = createEmailChannelDispatcher({
      to: 'owner@example.tz',
      lang: 'sw',
      recipientName: 'Asha',
      licenceExpiry: {
        licenceNumber: 'PML-001',
        licenceType: 'PML',
        expiryDate: '2026-08-01',
        daysRemaining: 14,
        renewUrl: 'https://cockpit.borjie.com/licences',
      },
      send: send as never,
    });

    const result = await dispatcher.dispatch(candidate());
    expect(result.delivered).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    const params = send.mock.calls[0]![0] as Record<string, unknown>;
    expect(params['template']).toBe('licence-expiry-warning');
    expect(params['lang']).toBe('sw');
    expect(params['idempotencyKey']).toBe('bn_abc1234567');
  });

  it('reports non-delivery when the sender throws', async () => {
    const send = vi.fn().mockRejectedValue(new Error('resend rejected'));
    const dispatcher = createEmailChannelDispatcher({
      to: 'owner@example.tz',
      lang: 'en',
      recipientName: 'Asha',
      licenceExpiry: {
        licenceNumber: 'PML-001',
        licenceType: 'PML',
        expiryDate: '2026-08-01',
        daysRemaining: 14,
        renewUrl: 'https://cockpit.borjie.com/licences',
      },
      send: send as never,
    });
    const result = await dispatcher.dispatch(candidate());
    expect(result.delivered).toBe(false);
    expect(result.error).toContain('resend rejected');
  });
});
