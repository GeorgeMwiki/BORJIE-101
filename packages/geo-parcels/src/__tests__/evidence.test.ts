import { describe, expect, it } from 'vitest';

import { attachEvidence, listEvidence } from '../evidence.js';
import { GeoParcelsError } from '../types.js';
import { InMemoryPort } from './in-memory-port.js';

describe('attachEvidence', () => {
  it('attaches a title deed via document_id', async () => {
    const port = new InMemoryPort();
    const row = await attachEvidence(port, {
      id: 'ev1',
      tenant_id: 't1',
      parcel_id: 'p1',
      evidence_kind: 'title_deed',
      document_id: 'doc-123',
      trust_score: 0.92,
      public_visible: true,
      verified_by_user_id: 'u-officer',
      verified_at: new Date('2025-01-15T00:00:00.000Z'),
      actor_user_id: 'u-officer',
    });
    expect(row.id).toBe('ev1');
    expect(row.trust_score).toBe(0.92);
    expect(row.public_visible).toBe(true);
  });

  it('attaches via storage_path when no document_id available', async () => {
    const port = new InMemoryPort();
    const row = await attachEvidence(port, {
      id: 'ev2',
      tenant_id: 't1',
      parcel_id: 'p1',
      evidence_kind: 'photo',
      storage_path: 'tenant1/parcel1/photo1.jpg',
    });
    expect(row.storage_path).toBe('tenant1/parcel1/photo1.jpg');
  });

  it('rejects when neither document_id nor storage_path supplied', async () => {
    const port = new InMemoryPort();
    await expect(
      attachEvidence(port, {
        id: 'ev3',
        tenant_id: 't1',
        parcel_id: 'p1',
        evidence_kind: 'photo',
      }),
    ).rejects.toMatchObject({ code: 'NO_EVIDENCE_LOCATION' });
  });

  it('rejects invalid trust_score range', async () => {
    const port = new InMemoryPort();
    await expect(
      attachEvidence(port, {
        id: 'ev4',
        tenant_id: 't1',
        parcel_id: 'p1',
        evidence_kind: 'title_deed',
        document_id: 'doc1',
        trust_score: 1.5,
      }),
    ).rejects.toThrow(GeoParcelsError);
  });

  it('emits an activity-log event', async () => {
    const port = new InMemoryPort();
    await attachEvidence(port, {
      id: 'ev5',
      tenant_id: 't1',
      parcel_id: 'p1',
      evidence_kind: 'lease_agreement',
      document_id: 'doc-lease',
      actor_user_id: 'u1',
    });
    const events = await port.listActivityLog('p1', 't1');
    expect(events).toHaveLength(1);
    expect(events[0]?.event_kind).toBe('evidence_attached');
  });

  it('lists evidence for a parcel scoped by tenant', async () => {
    const port = new InMemoryPort();
    await attachEvidence(port, {
      id: 'ev6',
      tenant_id: 't1',
      parcel_id: 'p1',
      evidence_kind: 'photo',
      storage_path: 'a',
    });
    await attachEvidence(port, {
      id: 'ev7',
      tenant_id: 't2',
      parcel_id: 'p1',
      evidence_kind: 'photo',
      storage_path: 'b',
    });
    const t1Evidence = await listEvidence(port, 'p1', 't1');
    expect(t1Evidence).toHaveLength(1);
    expect(t1Evidence[0]?.tenant_id).toBe('t1');
  });
});
