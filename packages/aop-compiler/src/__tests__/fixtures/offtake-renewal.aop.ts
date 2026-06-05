/**
 * Reference fixture: 60-day offtake-agreement renewal.
 *
 * Owner SOP: "60 days before any offtake agreement ends, draft a renewal
 * offer. Ask me to approve. If approved, send to the buyer. If they sign
 * within 30 days, record the new agreement. If they don't sign in 30 days,
 * escalate."
 *
 * Tools referenced:
 *   - offtake.draft_renewal
 *   - offtake.send_to_buyer
 *   - offtake.record_signature
 *   - buyer.voice_call
 */

import type { AOP } from '../../types.js';

export const offtakeRenewal: AOP = {
  name: 'offtake-renewal-60d',
  version: '0.1.0',
  description: '60-day-pre-expiry offtake-agreement renewal workflow.',
  trigger: {
    kind: 'event',
    event: 'offtake.t_minus_60d',
  },
  input: {
    source: 'event-payload',
  },
  steps: [
    {
      kind: 'tool',
      id: 'draft-renewal',
      tool: 'offtake.draft_renewal',
      args: { auto_index_to_lbma: true },
      on_success: 'ask-owner',
    },
    {
      kind: 'hook',
      id: 'ask-owner',
      hook: 'ask-owner',
      prompt: 'Renewal draft ready. Approve to send to buyer?',
      on_approve: 'send-to-buyer',
    },
    {
      kind: 'tool',
      id: 'send-to-buyer',
      tool: 'offtake.send_to_buyer',
      args: { channel: 'email_then_sms' },
      on_success: 'wait-30d',
    },
    {
      kind: 'monitor',
      id: 'wait-30d',
      monitor: {
        kind: 'wait',
        until_event: 'offtake.signed',
        OR: { kind: 'timer', duration: '30d' },
        timeout: '30d',
      },
      on_trigger: 'record-or-escalate',
    },
    {
      kind: 'tool',
      id: 'record-or-escalate',
      tool: 'offtake.record_signature',
      args: { fallback_action: 'escalate' },
      on_failure: 'escalate-call',
    },
    {
      kind: 'tool',
      id: 'escalate-call',
      tool: 'buyer.voice_call',
      args: { template: 'renewal-followup' },
    },
  ],
  entry: 'draft-renewal',
};
