import { describe, expect, it } from 'vitest';
import {
  sendReminder,
  type ReminderDraft,
  type ReminderTransport,
  type ReminderAuditSink,
} from '../tools/send-reminder.js';
import {
  escalateToCall,
  renderCallScript,
  type CallTransport,
} from '../tools/escalate-to-call.js';
import { draftNotice } from '../tools/draft-notice.js';

const baseDraft: ReminderDraft = {
  tenantId: 'tnt-1',
  leaseId: 'lse-1',
  channel: 'sms',
  toneTag: 'soft',
  language: 'en',
  amountMinor: 50000_00,
  currency: 'KES',
  body: 'Friendly reminder: your rent is overdue. Please respond.',
};

function mkTransport(): { transport: ReminderTransport; calls: string[] } {
  const calls: string[] = [];
  const transport: ReminderTransport = {
    async sendSms({ draft }) {
      calls.push(`sms:${draft.tenantId}`);
      return { transportId: `sms-${draft.tenantId}` };
    },
    async initiateStkPush({ draft }) {
      calls.push(`stk:${draft.tenantId}`);
      return { transportId: `stk-${draft.tenantId}` };
    },
  };
  return { transport, calls };
}

function mkAudit(): { audit: ReminderAuditSink; recorded: Array<{ tid: string }> } {
  const recorded: Array<{ tid: string }> = [];
  const audit: ReminderAuditSink = {
    async record({ transportId }) {
      recorded.push({ tid: transportId });
    },
  };
  return { audit, recorded };
}

describe('sendReminder', () => {
  it('sends an SMS when channel=sms', async () => {
    const { transport, calls } = mkTransport();
    const { audit, recorded } = mkAudit();
    const r = await sendReminder({
      draft: baseDraft,
      transport,
      audit,
      correlationId: 'c-1',
    }, 1000);
    expect(r.status).toBe('sent');
    expect(r.requiresOwnerApproval).toBe(false);
    expect(calls).toEqual(['sms:tnt-1']);
    expect(recorded).toEqual([{ tid: 'sms-tnt-1' }]);
  });

  it('refuses STK push without owner pre-approval', async () => {
    const { transport } = mkTransport();
    const { audit } = mkAudit();
    const stkDraft: ReminderDraft = { ...baseDraft, channel: 'stk-push', stkAmountMinor: 50000_00 };
    const r = await sendReminder({
      draft: stkDraft,
      transport,
      audit,
      correlationId: 'c-2',
    }, 1000);
    expect(r.status).toBe('queued-for-owner-approval');
    expect(r.requiresOwnerApproval).toBe(true);
  });

  it('allows STK push when owner pre-approved', async () => {
    const { transport, calls } = mkTransport();
    const { audit } = mkAudit();
    const stkDraft: ReminderDraft = { ...baseDraft, channel: 'stk-push', stkAmountMinor: 50000_00 };
    const r = await sendReminder({
      draft: stkDraft,
      transport,
      audit,
      correlationId: 'c-3',
      ownerHasPreApprovedStk: true,
    }, 1000);
    expect(r.status).toBe('sent');
    expect(calls).toEqual(['stk:tnt-1']);
  });

  it('returns failed when transport throws', async () => {
    const transport: ReminderTransport = {
      async sendSms() { throw new Error('gateway-503'); },
    };
    const { audit } = mkAudit();
    const r = await sendReminder({ draft: baseDraft, transport, audit, correlationId: 'c-x' }, 1000);
    expect(r.status).toBe('failed');
    expect(r.reason).toContain('gateway-503');
  });

  it('records a reversible recall window when delivered', async () => {
    const { transport } = mkTransport();
    const { audit } = mkAudit();
    const r = await sendReminder({ draft: baseDraft, transport, audit, correlationId: 'c-r', recallWindowMs: 30000 }, 5000);
    expect(r.recallableUntilMs).toBe(35000);
  });
});

describe('escalateToCall', () => {
  it('refuses to place a call without owner pre-approval', async () => {
    const transport: CallTransport = {
      async placeCall() { return { callSid: 'tw-1' }; },
    };
    const script = renderCallScript({
      tenantName: 'Asha', amountMinor: 50000_00, currency: 'KES', daysOverdue: 30, language: 'en', tenantId: 't1',
    });
    const r = await escalateToCall({ script, transport, correlationId: 'c-1', ownerHasPreApprovedCalls: false });
    expect(r.status).toBe('queued-for-four-eye');
  });

  it('places call when owner pre-approved', async () => {
    const transport: CallTransport = {
      async placeCall() { return { callSid: 'tw-99' }; },
    };
    const script = renderCallScript({
      tenantName: 'Asha', amountMinor: 50000_00, currency: 'KES', daysOverdue: 30, language: 'sw', tenantId: 't1',
    });
    const r = await escalateToCall({ script, transport, correlationId: 'c-2', ownerHasPreApprovedCalls: true });
    expect(r.status).toBe('placed');
    expect(r.callSid).toBe('tw-99');
  });

  it('renderCallScript switches to Swahili', () => {
    const s = renderCallScript({
      tenantName: 'Asha', amountMinor: 50000_00, currency: 'KES', daysOverdue: 30, language: 'sw', tenantId: 't1',
    });
    expect(s.script).toContain('Habari');
    expect(s.maxDurationSeconds).toBeLessThanOrEqual(120);
  });
});

describe('draftNotice', () => {
  it('produces a draft, never auto-files', () => {
    const d = draftNotice({
      tenantName: 'Asha', leaseId: 'lse-1', propertyAddress: 'Block A 4B, Dar',
      amountMinor: 50000_00, currency: 'KES', daysOverdue: 60,
      noticeKind: 'pay-or-quit', jurisdiction: 'TZ', language: 'en', ownerSignature: 'George',
    });
    expect(d.draftStatus).toBe('queued-for-owner-review');
    expect(d.nextStepGuidance).toContain('does NOT file');
    expect(d.mandatoryReviewCheckpoints.length).toBeGreaterThan(0);
  });

  it('includes jurisdictional checkpoint for KE', () => {
    const d = draftNotice({
      tenantName: 'Asha', leaseId: 'lse-1', propertyAddress: 'Westlands',
      amountMinor: 50000_00, currency: 'KES', daysOverdue: 60,
      noticeKind: 'pay-or-quit', jurisdiction: 'KE', language: 'en', ownerSignature: 'George',
    });
    expect(d.mandatoryReviewCheckpoints.some(c => c.includes('Kenya'))).toBe(true);
  });

  it('renders Swahili body when language=sw', () => {
    const d = draftNotice({
      tenantName: 'Asha', leaseId: 'lse-1', propertyAddress: 'Block A',
      amountMinor: 50000_00, currency: 'TZS', daysOverdue: 60,
      noticeKind: 'pay-or-quit', jurisdiction: 'TZ', language: 'sw', ownerSignature: 'George',
    });
    expect(d.body).toContain('Kwa');
    expect(d.subject).toContain('rasmi');
  });
});
