import { describe, it, expect } from 'vitest';
import { createNotificationsRouter } from '../../src/juniors/notifications-router.js';
import type { ClaudeClient } from '../../src/juniors/_shared.js';

const VALID = {
  notification_id: 'n_1',
  dispatched_channels: [
    { channel: 'sms', composed_message: 'Hello', language: 'sw', length_chars: 5 },
  ],
  suppressed_reason: null,
  confidence: 0.75,
  rationale: 'sms only',
  evidence_ids: ['rec_x'],
  citations: [],
};

function claudeOf(payload: unknown): ClaudeClient {
  return { async complete() { return { content: JSON.stringify(payload) }; } };
}

const INPUT = {
  tenantId: 't1', recipient_user_id: 'u1', recipient_phone_e164: '+255700000000',
  recipient_locale: 'sw' as const, category: 'sales_status' as const,
  severity: 'info' as const, subject: 'Sale ready', body_long: 'Mauzo tayari',
  available_channels: ['sms' as const],
};

describe('notifications-router', () => {
  it('happy path returns dispatched_channels with evidence_ids', async () => {
    const agent = createNotificationsRouter({ claude: claudeOf(VALID) });
    const out = await agent.processInput(INPUT);
    expect(out.dispatched_channels.length).toBeGreaterThan(0);
    expect(out.evidence_ids.length).toBeGreaterThan(0);
  });

  it('rejects when evidence_ids is empty (Auditor base)', async () => {
    const agent = createNotificationsRouter({ claude: claudeOf({ ...VALID, evidence_ids: [] }) });
    await expect(agent.processInput(INPUT)).rejects.toThrow(/validation_failed/);
  });

  it('propagates Claude errors', async () => {
    const claude: ClaudeClient = { async complete() { throw new Error('sms_send_fail'); } };
    const agent = createNotificationsRouter({ claude });
    await expect(agent.processInput(INPUT)).rejects.toThrow(/sms_send_fail/);
  });
});
