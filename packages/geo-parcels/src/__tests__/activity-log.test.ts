import { describe, expect, it } from 'vitest';

import {
  appendActivity,
  canonicalJson,
  computeActivityHash,
  verifyActivityChain,
} from '../activity-log.js';
import { InMemoryPort } from './in-memory-port.js';

describe('canonicalJson', () => {
  it('sorts keys deterministically', () => {
    const a = canonicalJson({ b: 1, a: 2 });
    const b = canonicalJson({ a: 2, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":2,"b":1}');
  });

  it('renders nested objects with sorted keys', () => {
    const json = canonicalJson({ outer: { z: 1, a: 2 }, before: true });
    expect(json).toBe('{"before":true,"outer":{"a":2,"z":1}}');
  });

  it('converts Date instances to ISO strings', () => {
    const d = new Date('2026-05-22T10:00:00.000Z');
    const json = canonicalJson({ when: d });
    expect(json).toBe('{"when":"2026-05-22T10:00:00.000Z"}');
  });

  it('treats undefined as null and drops it', () => {
    // JSON spec: undefined values are dropped in object serialisation.
    const json = canonicalJson({ keep: 1, drop: undefined });
    expect(json).toBe('{"keep":1}');
  });

  it('handles arrays preserving order', () => {
    const json = canonicalJson([3, 1, 2]);
    expect(json).toBe('[3,1,2]');
  });

  it('returns null literal for null', () => {
    expect(canonicalJson(null)).toBe('null');
  });
});

describe('computeActivityHash', () => {
  it('is deterministic for the same inputs', () => {
    const args = {
      parcel_id: 'p1',
      event_kind: 'created' as const,
      event_payload_jsonb: { foo: 'bar' },
      prev_hash: null,
      created_at: '2026-05-22T10:00:00.000Z',
    };
    expect(computeActivityHash(args)).toBe(computeActivityHash(args));
  });

  it('changes when prev_hash changes', () => {
    const base = {
      parcel_id: 'p1',
      event_kind: 'created' as const,
      event_payload_jsonb: {},
      created_at: '2026-05-22T10:00:00.000Z',
    };
    const a = computeActivityHash({ ...base, prev_hash: null });
    const b = computeActivityHash({ ...base, prev_hash: 'aa' });
    expect(a).not.toBe(b);
  });
});

describe('appendActivity', () => {
  it('appends a row with prev_hash=null when it is the first event', async () => {
    const port = new InMemoryPort();
    const row = await appendActivity(port, {
      id: 'evt1',
      tenant_id: 't1',
      parcel_id: 'p1',
      event_kind: 'created',
    });
    expect(row.prev_hash).toBeNull();
    expect(row.hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('chains subsequent rows with prev_hash equal to previous hash', async () => {
    const port = new InMemoryPort();
    const first = await appendActivity(port, {
      id: 'evt1',
      tenant_id: 't1',
      parcel_id: 'p1',
      event_kind: 'created',
    });
    const second = await appendActivity(port, {
      id: 'evt2',
      tenant_id: 't1',
      parcel_id: 'p1',
      event_kind: 'status_changed',
      event_payload_jsonb: { from: 'available', to: 'reserved' },
    });
    expect(second.prev_hash).toBe(first.hash);
    expect(second.hash).not.toBe(first.hash);
  });
});

describe('verifyActivityChain', () => {
  it('returns ok for a freshly built chain', async () => {
    const port = new InMemoryPort();
    await appendActivity(port, {
      id: 'evt1',
      tenant_id: 't1',
      parcel_id: 'p1',
      event_kind: 'created',
    });
    await appendActivity(port, {
      id: 'evt2',
      tenant_id: 't1',
      parcel_id: 'p1',
      event_kind: 'status_changed',
      event_payload_jsonb: { from: 'available', to: 'reserved' },
    });
    await appendActivity(port, {
      id: 'evt3',
      tenant_id: 't1',
      parcel_id: 'p1',
      event_kind: 'listed',
      event_payload_jsonb: { listing_id: 'l1' },
    });
    const rows = await port.listActivityLog('p1', 't1');
    expect(verifyActivityChain(rows)).toEqual({ ok: true });
  });

  it('detects a tampered prev_hash', async () => {
    const port = new InMemoryPort();
    await appendActivity(port, {
      id: 'evt1',
      tenant_id: 't1',
      parcel_id: 'p1',
      event_kind: 'created',
    });
    await appendActivity(port, {
      id: 'evt2',
      tenant_id: 't1',
      parcel_id: 'p1',
      event_kind: 'status_changed',
    });
    const rows = await port.listActivityLog('p1', 't1');
    // Tamper.
    rows[1]!.prev_hash = 'baadbeef';
    const result = verifyActivityChain(rows);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.brokenAtIndex).toBe(1);
      expect(result.reason).toContain('prev_hash mismatch');
    }
  });

  it('detects a tampered payload (hash mismatch)', async () => {
    const port = new InMemoryPort();
    const a = await appendActivity(port, {
      id: 'evt1',
      tenant_id: 't1',
      parcel_id: 'p1',
      event_kind: 'created',
      event_payload_jsonb: { original: true },
    });
    const rows = await port.listActivityLog('p1', 't1');
    // Mutate payload but keep stored hash unchanged.
    rows[0]!.event_payload_jsonb = { tampered: true };
    const result = verifyActivityChain(rows);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.brokenAtIndex).toBe(0);
      expect(result.reason).toContain('hash mismatch');
    }
    // Sanity: original hash matches original payload.
    const original = computeActivityHash({
      parcel_id: 'p1',
      event_kind: 'created',
      event_payload_jsonb: { original: true },
      prev_hash: null,
      created_at: a.created_at instanceof Date ? a.created_at.toISOString() : (a.created_at ?? ''),
    });
    expect(original).toBe(a.hash);
  });

  it('detects a missing created_at on a row', async () => {
    const port = new InMemoryPort();
    await appendActivity(port, {
      id: 'evt1',
      tenant_id: 't1',
      parcel_id: 'p1',
      event_kind: 'created',
    });
    const rows = await port.listActivityLog('p1', 't1');
    delete rows[0]!.created_at;
    const result = verifyActivityChain(rows);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('missing created_at');
    }
  });
});
