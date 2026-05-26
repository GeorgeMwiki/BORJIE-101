/**
 * Redactor — plaintext removed, salted-hash applied, cross-tenant
 * isolation, allow-list honoured.
 */

import { describe, expect, it } from 'vitest';
import { findLeakedSecrets, redactTrace } from '../pipeline/redactor.js';
import type { RedactionConfig, RlvrTrace } from '../types.js';

const SECRETS = ['12345678901', '+255700123456', 'mwikila@example.com'];

function traceWithPii(): RlvrTrace {
  return Object.freeze({
    id: 'trace-pii-1',
    runId: 'run-pii-1',
    tenantId: 'tenant-A',
    prompt: 'Hi I am 12345678901 ring me at +255700123456',
    completion: 'Forward to mwikila@example.com',
    toolCalls: [
      Object.freeze({
        name: 'send_sms',
        args: Object.freeze({ to: '+255700123456' }),
        result: Object.freeze({ delivered: true }),
      }),
    ],
    metadata: Object.freeze({
      synthetic: true,
      regulation_section: '87',
      mineral: 'gold',
    }),
    capturedAt: '2026-05-26T00:00:00.000Z',
  });
}

describe('redactor', () => {
  it('removes all plaintext PII from the redacted trace', () => {
    const config: RedactionConfig = {
      tenantId: 'tenant-A',
      allowlist: ['metadata.regulation_section', 'metadata.mineral'],
    };
    const original = traceWithPii();
    const redacted = redactTrace(original, config);
    const leaked = findLeakedSecrets(redacted, SECRETS);
    expect(leaked).toHaveLength(0);
  });

  it('preserves allow-listed fields in plaintext', () => {
    const config: RedactionConfig = {
      tenantId: 'tenant-A',
      allowlist: ['metadata.regulation_section', 'metadata.mineral'],
    };
    const redacted = redactTrace(traceWithPii(), config);
    expect(
      (redacted.metadata as Record<string, unknown>)['regulation_section'],
    ).toBe('87');
    expect((redacted.metadata as Record<string, unknown>)['mineral']).toBe(
      'gold',
    );
  });

  it('same plaintext under two tenants produces different hashes', () => {
    const sharedSecret = 'shared-tenant-id-123';
    const traceA: RlvrTrace = Object.freeze({
      id: 'ta',
      runId: 'ra',
      tenantId: 'tenant-A',
      prompt: sharedSecret,
      completion: '',
      toolCalls: [],
      metadata: {},
      capturedAt: '2026-05-26T00:00:00.000Z',
    });
    const traceB: RlvrTrace = Object.freeze({
      ...traceA,
      tenantId: 'tenant-B',
    });
    const redA = redactTrace(traceA, {
      tenantId: 'tenant-A',
      allowlist: [],
    });
    const redB = redactTrace(traceB, {
      tenantId: 'tenant-B',
      allowlist: [],
    });
    expect(redA.prompt).not.toBe(redB.prompt);
  });

  it('does not mutate the input trace', () => {
    const config: RedactionConfig = {
      tenantId: 'tenant-A',
      allowlist: [],
    };
    const original = traceWithPii();
    const originalSnapshot = JSON.stringify(original);
    redactTrace(original, config);
    expect(JSON.stringify(original)).toBe(originalSnapshot);
  });
});
