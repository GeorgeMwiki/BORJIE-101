import { describe, expect, it } from 'vitest';
import { createEmailNormaliser } from '../ingest/normalizer.js';
import { createPiiRedactor } from '../redact/pii-redactor.js';
import type { Hasher } from '../types.js';
import { GMAIL_GET_OK_PAYLOAD, OUTLOOK_LIST_OK_PAYLOAD } from './fixtures/email-fixtures.js';

function det(): Hasher {
  return async (input) => {
    let h = 0;
    for (let i = 0; i < input.length; i += 1) {
      h = (h * 31 + input.charCodeAt(i)) >>> 0;
    }
    return `t-${h.toString(16).padStart(8, '0')}`;
  };
}

function buildNormaliser() {
  let n = 0;
  return createEmailNormaliser({
    redactor: createPiiRedactor({ hasher: det() }),
    clock: { nowIso: () => '2026-05-26T12:00:00.000Z' },
    uuid: {
      v4: () => {
        n += 1;
        return `00000000-0000-0000-0000-${n.toString().padStart(12, '0')}`;
      },
    },
  });
}

describe('Email normaliser', () => {
  it('normalises a Gmail payload and hashes from + to addresses', async () => {
    const normaliser = buildNormaliser();
    const result = await normaliser.normaliseGmail({
      tenantId: 'tenant-001',
      account: 'mwikila@example.com',
      message: GMAIL_GET_OK_PAYLOAD,
      auditHash: 'h-1',
    });

    expect(result.provider).toBe('gmail');
    expect(result.from_addr).toMatch(/^\[email:/);
    expect(result.to_addrs[0]).toMatch(/^\[email:/);
    expect(result.thread_id).toBe('t-1');
    expect(result.body_text).not.toContain('perm@example.com');
    expect(result.body_text).toMatch(/\[email:/);
    expect(result.ingested_at).toBe('2026-05-26T12:00:00.000Z');
  });

  it('normalises an Outlook payload and redacts embedded phone', async () => {
    const normaliser = buildNormaliser();
    const m = OUTLOOK_LIST_OK_PAYLOAD.value[0];
    if (m === undefined) throw new Error('fixture missing message');
    const result = await normaliser.normaliseOutlook({
      tenantId: 'tenant-001',
      account: 'mwikila@example.com',
      message: m,
      auditHash: 'h-2',
    });

    expect(result.provider).toBe('outlook_mail');
    expect(result.body_text).toBeTruthy();
    expect(result.body_text).not.toContain('+255 754 999 888');
    expect(result.body_text).toMatch(/\[phone:/);
    expect(result.from_addr).toMatch(/^\[email:/);
  });
});
