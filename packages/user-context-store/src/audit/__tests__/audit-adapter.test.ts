import { describe, expect, it, vi } from 'vitest';
import { createWormAuditContextSink } from '../audit-adapter.js';

describe('createWormAuditContextSink', () => {
  it('appends a normalised entry to the worm store', async () => {
    const append = vi.fn(async () => undefined);
    const sink = createWormAuditContextSink({
      wormAuditStore: { append },
    });
    await sink.recordFetch({
      tenantId: 't1',
      userId: 'u1',
      role: 'tenant',
      intent: 'rent_balance',
      question: 'What do I owe?',
      snippetCount: 3,
      citations: [
        { kind: 'lease', id: 'l1' },
        { kind: 'invoice', id: 'i1' },
      ],
      consent: 'implicit',
      timestamp: '2026-05-24T00:00:00Z',
    });
    expect(append).toHaveBeenCalledTimes(1);
    const entry = append.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(entry['kind']).toBe('user_context_store.fetch_snippets');
    expect(entry['snippetCount']).toBe(3);
    expect(entry['citationDigest']).toBe('lease:l1,invoice:i1');
    // Question text itself MUST NOT be persisted.
    expect(JSON.stringify(entry)).not.toContain('What do I owe');
  });

  it('swallows append failure and logs a warning', async () => {
    const warn = vi.fn();
    const sink = createWormAuditContextSink({
      wormAuditStore: { append: async () => { throw new Error('boom'); } },
      logger: { warn },
    });
    await expect(
      sink.recordFetch({
        tenantId: 't1',
        userId: 'u1',
        role: 'tenant',
        intent: 'x',
        question: 'y',
        snippetCount: 0,
        citations: [],
        consent: 'implicit',
        timestamp: '2026-05-24T00:00:00Z',
      }),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});
