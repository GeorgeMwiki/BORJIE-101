import { describe, expect, it } from 'vitest';
import { createPiiRedactor } from '../redact/pii-redactor.js';
import type { Hasher } from '../types.js';

function deterministicHasher(): Hasher {
  return async (input) => {
    let h = 0;
    for (let i = 0; i < input.length; i += 1) {
      h = (h * 31 + input.charCodeAt(i)) >>> 0;
    }
    return `test-${h.toString(16).padStart(8, '0')}`;
  };
}

describe('Slack PII redactor', () => {
  it('hashes embedded email and phone but leaves benign text intact', async () => {
    const redactor = createPiiRedactor({ hasher: deterministicHasher() });
    const result = await redactor.redact({
      tenantId: 'tenant-001',
      fieldId: 'slack:T01:C01:text',
      value:
        'Email mwikila@example.com about the +255 754 123 456 incident.',
    });
    expect(result.redacted).not.toContain('mwikila@example.com');
    expect(result.redacted).not.toContain('754 123 456');
    expect(result.redacted).toMatch(/\[email:/);
    expect(result.redacted).toMatch(/\[phone:/);
    expect(result.redactedFields).toContain('email');
    expect(result.redactedFields).toContain('phone');
  });

  it('redacts both Tanzania TRA TIN and Kenya KRA PIN tax ids', async () => {
    const redactor = createPiiRedactor({ hasher: deterministicHasher() });
    const result = await redactor.redact({
      tenantId: 'tenant-001',
      fieldId: 'slack:T01:C01:text',
      value: 'TRA TIN 123-456-789 and KRA PIN A123456789B on file.',
    });
    expect(result.redacted).not.toContain('123-456-789');
    expect(result.redacted).not.toContain('A123456789B');
    expect(result.redacted).toMatch(/\[tra-tin:/);
    expect(result.redacted).toMatch(/\[kra-pin:/);
    expect(result.redactedFields).toContain('tra-tin');
    expect(result.redactedFields).toContain('kra-pin');
  });

  it('produces tenant-salted hashes — same value in different tenants are unlinkable', async () => {
    const redactor = createPiiRedactor({ hasher: deterministicHasher() });
    const a = await redactor.redact({
      tenantId: 'tenant-A',
      fieldId: 'slack:T01:C01:text',
      value: 'mwikila@example.com',
    });
    const b = await redactor.redact({
      tenantId: 'tenant-B',
      fieldId: 'slack:T01:C01:text',
      value: 'mwikila@example.com',
    });
    expect(a.redacted).not.toEqual(b.redacted);
  });
});
