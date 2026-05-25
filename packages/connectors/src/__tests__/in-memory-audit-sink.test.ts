/**
 * Unit tests for createInMemoryAuditSink — append-only buffer suitable for
 * tests + local dev. Mirrors the contract of the AuditSink interface
 * (audit entries are append-only and snapshots are frozen).
 */

import { describe, it, expect } from 'vitest';
import { createInMemoryAuditSink } from '../in-memory-audit-sink.js';
import type { AuditSink } from '../base-connector.js';

type AuditEntry = Parameters<AuditSink['audit']>[0];

function entry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    connectorId: 'mpesa',
    path: '/payments/initiate',
    method: 'POST',
    outcome: 'ok',
    latencyMs: 42,
    ...overrides,
  };
}

describe('createInMemoryAuditSink — basics', () => {
  it('starts empty', () => {
    const sink = createInMemoryAuditSink();
    expect(sink.entries()).toEqual([]);
  });

  it('records one entry', async () => {
    const sink = createInMemoryAuditSink();
    await sink.audit(entry());

    expect(sink.entries()).toHaveLength(1);
    expect(sink.entries()[0]).toMatchObject({ connectorId: 'mpesa', outcome: 'ok' });
  });

  it('preserves call order', async () => {
    const sink = createInMemoryAuditSink();
    await sink.audit(entry({ path: '/a' }));
    await sink.audit(entry({ path: '/b' }));
    await sink.audit(entry({ path: '/c' }));

    expect(sink.entries().map((e) => e.path)).toEqual(['/a', '/b', '/c']);
  });

  it('captures every outcome variant', async () => {
    const sink = createInMemoryAuditSink();
    await sink.audit(entry({ outcome: 'ok' }));
    await sink.audit(entry({ outcome: 'failed' }));
    await sink.audit(entry({ outcome: 'circuit-open' }));
    await sink.audit(entry({ outcome: 'rate-limited' }));

    expect(sink.entries().map((e) => e.outcome)).toEqual([
      'ok',
      'failed',
      'circuit-open',
      'rate-limited',
    ]);
  });

  it('captures optional fields when provided', async () => {
    const sink = createInMemoryAuditSink();
    await sink.audit(
      entry({
        inputHash: 'hash-in',
        outputHash: 'hash-out',
        idempotencyKey: 'idem-1',
      }),
    );

    expect(sink.entries()[0]).toMatchObject({
      inputHash: 'hash-in',
      outputHash: 'hash-out',
      idempotencyKey: 'idem-1',
    });
  });
});

describe('createInMemoryAuditSink — immutability', () => {
  it('entries() returns a frozen snapshot', async () => {
    const sink = createInMemoryAuditSink();
    await sink.audit(entry());

    expect(Object.isFrozen(sink.entries())).toBe(true);
  });

  it('mutating a snapshot does not modify the underlying buffer', async () => {
    const sink = createInMemoryAuditSink();
    await sink.audit(entry());
    const snap = sink.entries();

    expect(() => {
      (snap as AuditEntry[]).push(entry({ path: '/injected' }));
    }).toThrow();

    expect(sink.entries()).toHaveLength(1);
  });

  it('snapshots taken before clear remain intact', async () => {
    const sink = createInMemoryAuditSink();
    await sink.audit(entry());
    const before = sink.entries();

    sink.clear();

    expect(before).toHaveLength(1);
    expect(sink.entries()).toHaveLength(0);
  });
});

describe('createInMemoryAuditSink — clear()', () => {
  it('empties the buffer', async () => {
    const sink = createInMemoryAuditSink();
    await sink.audit(entry());
    await sink.audit(entry());

    sink.clear();

    expect(sink.entries()).toEqual([]);
  });

  it('lets new entries be appended after clear', async () => {
    const sink = createInMemoryAuditSink();
    await sink.audit(entry({ path: '/old' }));
    sink.clear();
    await sink.audit(entry({ path: '/new' }));

    expect(sink.entries()).toHaveLength(1);
    expect(sink.entries()[0]?.path).toBe('/new');
  });
});

describe('createInMemoryAuditSink — independence', () => {
  it('two sinks do not share state', async () => {
    const a = createInMemoryAuditSink();
    const b = createInMemoryAuditSink();

    await a.audit(entry({ path: '/a' }));
    await b.audit(entry({ path: '/b' }));

    expect(a.entries().map((e) => e.path)).toEqual(['/a']);
    expect(b.entries().map((e) => e.path)).toEqual(['/b']);
  });
});
