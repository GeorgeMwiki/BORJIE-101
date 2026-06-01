/**
 * Reference fixture: monthly outstanding-royalty chase.
 *
 * Owner SOP: "Every month, on day 25, look at all buyers whose royalty
 * payment is 7+ days outstanding. Send a friendly reminder. If they don't
 * pay within 3 days, escalate to a phone call. If still no payment in 7 days,
 * draft a supply-suspension notice and ask me to approve."
 *
 * Tools referenced (must exist in the test BrainToolRegistry):
 *   - buyer.send_reminder
 *   - buyer.voice_call
 *   - notice.draft_supply_suspension
 */

import type { AOP } from '../../types.js';

export const royaltyArrearsChase: AOP = {
  name: 'monthly-royalty-arrears-chase',
  version: '0.1.0',
  description: 'Day-25 monthly chase for buyers 7+ days in outstanding royalties.',
  trigger: {
    kind: 'cron',
    schedule: '0 9 25 * *',
    timezone: 'Africa/Dar_es_Salaam',
  },
  input: {
    source: 'query',
    query: {
      table: 'offtake_agreements',
      where: { royalty_status: 'outstanding', days_outstanding_gte: 7 },
    },
  },
  steps: [
    {
      kind: 'tool',
      id: 'send-reminder',
      tool: 'buyer.send_reminder',
      args: { template: 'outstanding-friendly', channel: 'sms' },
      on_success: 'wait-3d',
    },
    {
      kind: 'monitor',
      id: 'wait-3d',
      monitor: {
        kind: 'wait',
        until_event: 'payment.received',
        OR: { kind: 'timer', duration: '3d' },
        timeout: '3d',
      },
      on_trigger: 'escalate-call',
    },
    {
      kind: 'tool',
      id: 'escalate-call',
      tool: 'buyer.voice_call',
      args: { template: 'outstanding-firm' },
      on_success: 'wait-7d',
    },
    {
      kind: 'monitor',
      id: 'wait-7d',
      monitor: {
        kind: 'wait',
        until_event: 'payment.received',
        OR: { kind: 'timer', duration: '7d' },
        timeout: '7d',
      },
      on_trigger: 'ask-owner-approval',
    },
    {
      kind: 'hook',
      id: 'ask-owner-approval',
      hook: 'ask-owner',
      prompt: 'Buyer still in arrears. Approve drafting a supply-suspension notice?',
      on_approve: 'draft-notice',
    },
    {
      kind: 'tool',
      id: 'draft-notice',
      tool: 'notice.draft_supply_suspension',
      args: { tone: 'formal' },
    },
  ],
  entry: 'send-reminder',
};
