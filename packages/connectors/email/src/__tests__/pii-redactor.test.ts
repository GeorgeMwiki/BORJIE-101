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

describe('Email PII redactor', () => {
  it('redacts embedded email addresses in body text', async () => {
    const redactor = createPiiRedactor({ hasher: det() });
    const result = await redactor.redact({
      tenantId: 't-1',
      fieldId: 'gmail:mwikila@example.com:body',
      value: 'Forward to perm@example.com',
    });
    expect(result.redacted).not.toContain('perm@example.com');
    expect(result.redactedFields).toContain('email');
  });

  it('redactAddress is tenant-salted', async () => {
    const redactor = createPiiRedactor({ hasher: det() });
    const a = await redactor.redactAddress({
      tenantId: 'tenant-A',
      fieldId: 'gmail:m@e.com:from',
      address: 'mwikila@example.com',
    });
    const b = await redactor.redactAddress({
      tenantId: 'tenant-B',
      fieldId: 'gmail:m@e.com:from',
      address: 'mwikila@example.com',
    });
    expect(a).not.toEqual(b);
    expect(a).toMatch(/^\[email:/);
  });
});
