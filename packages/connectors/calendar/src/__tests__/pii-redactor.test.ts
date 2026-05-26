import { describe, expect, it } from 'vitest';
import { createPiiRedactor } from '../redact/pii-redactor.js';
import type { Hasher } from '../types.js';

function det(): Hasher {
  return async (input) => {
    let h = 0;
    for (let i = 0; i < input.length; i += 1) {
      h = (h * 31 + input.charCodeAt(i)) >>> 0;
    }
    return `t-${h.toString(16).padStart(8, '0')}`;
  };
}

describe('Calendar PII redactor', () => {
  it('strips embedded password / token query params from join URLs', async () => {
    const redactor = createPiiRedactor({ hasher: det() });
    const result = await redactor.redact({
      tenantId: 'tenant-001',
      fieldId: 'google_calendar:primary:description',
      value: 'Join: https://teams.microsoft.com/m?token=topsecret&pwd=highsecret',
    });
    expect(result.redacted).not.toContain('topsecret');
    expect(result.redacted).not.toContain('highsecret');
    expect(result.redactedFields).toContain('join-url-token');
  });

  it('redactAddress is tenant-salted', async () => {
    const redactor = createPiiRedactor({ hasher: det() });
    const a = await redactor.redactAddress({
      tenantId: 'tenant-A',
      fieldId: 'attendee',
      address: 'mwikila@example.com',
    });
    const b = await redactor.redactAddress({
      tenantId: 'tenant-B',
      fieldId: 'attendee',
      address: 'mwikila@example.com',
    });
    expect(a).not.toEqual(b);
  });
});
