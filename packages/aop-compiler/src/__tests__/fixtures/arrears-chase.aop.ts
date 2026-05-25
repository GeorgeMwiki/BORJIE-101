/**
 * Reference fixture: monthly arrears chase.
 *
 * Owner SOP: "Every month, on day 25, look at all tenants whose rent is 7+
 * days late. Send a friendly reminder. If they don't pay within 3 days,
 * escalate to a phone call. If still no payment in 7 days, draft an eviction
 * notice and ask me to approve."
 *
 * Tools referenced (must exist in the test BrainToolRegistry):
 *   - tenant.send_reminder
 *   - tenant.voice_call
 *   - notice.draft_eviction_notice
 */

import type { AOP } from '../../types.js';

export const arrearsChase: AOP = {
  name: 'monthly-arrears-chase',
  version: '0.1.0',
  description: 'Day-25 monthly chase for tenants 7+ days in arrears.',
  trigger: {
    kind: 'cron',
    schedule: '0 9 25 * *',
    timezone: 'Africa/Nairobi',
  },
  input: {
    source: 'query',
    query: {
      table: 'leases',
      where: { rent_status: 'arrears', days_arrears_gte: 7 },
    },
  },
  steps: [
    {
      kind: 'tool',
      id: 'send-reminder',
      tool: 'tenant.send_reminder',
      args: { template: 'arrears-friendly', channel: 'sms' },
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
      tool: 'tenant.voice_call',
      args: { template: 'arrears-firm' },
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
      prompt: 'Tenant still in arrears. Approve drafting an eviction notice?',
      on_approve: 'draft-notice',
    },
    {
      kind: 'tool',
      id: 'draft-notice',
      tool: 'notice.draft_eviction_notice',
      args: { tone: 'formal' },
    },
  ],
  entry: 'send-reminder',
};
