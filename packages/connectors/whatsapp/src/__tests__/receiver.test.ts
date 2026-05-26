import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { receiveWhatsappWebhook } from '../ingest/webhook-receiver.js';
import type { ConnectorLogger } from '../types.js';

const APP_SECRET = 'unit-test-app-secret';
const noopLogger: ConnectorLogger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

function sign(body: string): string {
  return 'sha256=' + createHmac('sha256', APP_SECRET).update(body, 'utf8').digest('hex');
}

describe('receiveWhatsappWebhook', () => {
  const validBody = JSON.stringify({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba_T',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '+255700000000',
                phone_number_id: 'pn_test',
              },
              messages: [
                {
                  id: 'wamid.AAA',
                  from: '+255711111111',
                  timestamp: '1716711600',
                  type: 'text',
                  text: { body: 'mining update' },
                },
              ],
            },
          },
        ],
      },
    ],
  });

  it('returns ok with normalised rows for a correctly-signed payload', () => {
    const result = receiveWhatsappWebhook(validBody, sign(validBody), {
      tenantId: 'tenant_a',
      nowIso: () => '2026-05-26T10:00:00.000Z',
      uuid: () => 'uuid-1',
      logger: noopLogger,
      appSecret: APP_SECRET,
    });
    expect(result.outcome).toBe('ok');
    expect(result.rows.length).toBe(1);
    expect(result.rows[0]!.kind).toBe('text');
  });

  it('returns invalid-signature on a tampered body', () => {
    const tampered = validBody + '{"injection":true}';
    const result = receiveWhatsappWebhook(tampered, sign(validBody), {
      tenantId: 'tenant_a',
      nowIso: () => '2026-05-26T10:00:00.000Z',
      uuid: () => 'uuid-1',
      logger: noopLogger,
      appSecret: APP_SECRET,
    });
    expect(result.outcome).toBe('invalid-signature');
    expect(result.rows.length).toBe(0);
  });

  it('returns malformed-payload on non-JSON body with a valid signature', () => {
    const bogus = 'not-json';
    const result = receiveWhatsappWebhook(bogus, sign(bogus), {
      tenantId: 'tenant_a',
      nowIso: () => '2026-05-26T10:00:00.000Z',
      uuid: () => 'uuid-1',
      logger: noopLogger,
      appSecret: APP_SECRET,
    });
    expect(result.outcome).toBe('malformed-payload');
  });
});
