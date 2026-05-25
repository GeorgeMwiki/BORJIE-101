/**
 * Reference fixture: 60-day lease renewal.
 *
 * Owner SOP: "60 days before any lease ends, draft a renewal offer. Ask me
 * to approve. If approved, send to the tenant. If they sign within 30 days,
 * record the new lease. If they don't sign in 30 days, escalate."
 *
 * Tools referenced:
 *   - lease.draft_renewal
 *   - lease.send_to_tenant
 *   - lease.record_signature
 *   - tenant.voice_call
 */

import type { AOP } from '../../types.js';

export const leaseRenewal: AOP = {
  name: 'lease-renewal-60d',
  version: '0.1.0',
  description: '60-day-pre-expiry lease renewal workflow.',
  trigger: {
    kind: 'event',
    event: 'lease.t_minus_60d',
  },
  input: {
    source: 'event-payload',
  },
  steps: [
    {
      kind: 'tool',
      id: 'draft-renewal',
      tool: 'lease.draft_renewal',
      args: { auto_index_to_cpi: true },
      on_success: 'ask-owner',
    },
    {
      kind: 'hook',
      id: 'ask-owner',
      hook: 'ask-owner',
      prompt: 'Renewal draft ready. Approve to send to tenant?',
      on_approve: 'send-to-tenant',
    },
    {
      kind: 'tool',
      id: 'send-to-tenant',
      tool: 'lease.send_to_tenant',
      args: { channel: 'email_then_sms' },
      on_success: 'wait-30d',
    },
    {
      kind: 'monitor',
      id: 'wait-30d',
      monitor: {
        kind: 'wait',
        until_event: 'lease.signed',
        OR: { kind: 'timer', duration: '30d' },
        timeout: '30d',
      },
      on_trigger: 'record-or-escalate',
    },
    {
      kind: 'tool',
      id: 'record-or-escalate',
      tool: 'lease.record_signature',
      args: { fallback_action: 'escalate' },
      on_failure: 'escalate-call',
    },
    {
      kind: 'tool',
      id: 'escalate-call',
      tool: 'tenant.voice_call',
      args: { template: 'renewal-followup' },
    },
  ],
  entry: 'draft-renewal',
};
