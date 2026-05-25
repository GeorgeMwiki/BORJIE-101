/**
 * Audit helpers test.
 */

import { describe, it, expect } from 'vitest';
import { createInMemoryAuditPort, recordAudit, digestString } from '../audit.js';

describe('digestString', () => {
  it('returns a stable 8-char hex digest for a given input', () => {
    const a = digestString('hello world');
    const b = digestString('hello world');
    expect(a).toBe(b);
    expect(a.length).toBe(8);
  });

  it('different inputs produce different digests (high probability)', () => {
    expect(digestString('a')).not.toBe(digestString('b'));
  });
});

describe('recordAudit + in-memory port', () => {
  it('appends entries in order', async () => {
    const port = createInMemoryAuditPort();
    await recordAudit(port, {
      at: '2026-04-01T00:00:00Z',
      action: 'advisor.ask',
      tenantId: 't',
      userId: 'u',
      role: 'tenant',
      sessionId: null,
      redactedFields: [],
      deniedSnippetIds: [],
      outcome: 'ok',
    });
    await recordAudit(port, {
      at: '2026-04-01T00:00:01Z',
      action: 'advisor.feedback',
      tenantId: 't',
      userId: 'u',
      role: 'tenant',
      sessionId: 's',
      redactedFields: [],
      deniedSnippetIds: [],
      outcome: 'ok',
    });
    expect(port.entries.length).toBe(2);
    expect((port.entries[0] as any).action).toBe('advisor.ask');
    expect((port.entries[1] as any).action).toBe('advisor.feedback');
  });
});
