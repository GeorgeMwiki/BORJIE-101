import { describe, it, expect } from 'vitest';
import { normalizeInbound } from '../ingest/normalizer.js';
import { redactValue } from '../redact/pii-redactor.js';
import type { WhatsappWebhookEnvelope } from '../types.js';

const FIXED_NOW = '2026-05-26T10:00:00.000Z';

function makeEnvelope(): WhatsappWebhookEnvelope {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba_123',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: '+255700000000',
                phone_number_id: 'pn_42',
              },
              messages: [
                {
                  id: 'wamid.A',
                  from: '+255711111111',
                  timestamp: '1716711600',
                  type: 'text',
                  text: { body: 'Habari, Mr. Mwikila' },
                },
                {
                  id: 'wamid.B',
                  from: '+255722222222',
                  timestamp: '1716711700',
                  type: 'image',
                  image: {
                    id: 'media_x',
                    mime_type: 'image/jpeg',
                    sha256: 'aa',
                    caption: 'site photo',
                  },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

describe('normalizeInbound', () => {
  it('emits one canonical row per inbound message', () => {
    let counter = 0;
    const rows = normalizeInbound(makeEnvelope(), {
      tenantId: 'tenant_a',
      nowIso: () => FIXED_NOW,
      uuid: () => `uuid-${++counter}`,
    });
    expect(rows.length).toBe(2);
  });

  it('hashes PII fields and lists them under redactedFields', () => {
    const rows = normalizeInbound(makeEnvelope(), {
      tenantId: 'tenant_a',
      nowIso: () => FIXED_NOW,
      uuid: () => 'uuid',
    });
    const first = rows[0]!;
    expect(first.row.fromPhone).toBe(
      redactValue({
        tenantId: 'tenant_a',
        fieldPath: 'fromPhone',
        value: '+255711111111',
      }),
    );
    expect(first.row.text).toBe(
      redactValue({
        tenantId: 'tenant_a',
        fieldPath: 'text',
        value: 'Habari, Mr. Mwikila',
      }),
    );
    expect(first.redactedFields).toContain('fromPhone');
    expect(first.redactedFields).toContain('text');
  });

  it('extracts media projection from image messages', () => {
    const rows = normalizeInbound(makeEnvelope(), {
      tenantId: 'tenant_a',
      nowIso: () => FIXED_NOW,
      uuid: () => 'uuid',
    });
    const second = rows[1]!;
    expect(second.row.kind).toBe('image');
    expect(second.row.media?.assetId).toBe('media_x');
    expect(second.row.media?.mimeType).toBe('image/jpeg');
  });

  it('stamps audit_hash deterministically from (tenantId, wabaId, waMessageId)', () => {
    const a = normalizeInbound(makeEnvelope(), {
      tenantId: 'tenant_a',
      nowIso: () => FIXED_NOW,
      uuid: () => 'uuid',
    });
    const b = normalizeInbound(makeEnvelope(), {
      tenantId: 'tenant_a',
      nowIso: () => FIXED_NOW,
      uuid: () => 'uuid-2', // different uuid is fine; audit_hash is independent of uuid
    });
    expect(a[0]!.row.auditHash).toBe(b[0]!.row.auditHash);
  });
});
