/**
 * Anomaly-detection repository — CRUD + audit-chain validation.
 *
 * Acceptance criterion:
 *   T18. insert chains prev_hash correctly and rows are immutable.
 */

import { describe, expect, it } from 'vitest';

import {
  computeAnomalyAuditHash,
  createInMemoryAnomalyDetectionRepository,
  GENESIS_HASH,
} from '../repositories/anomaly-detection-repository.js';

describe('anomaly-detection-repository — in-memory', () => {
  it('first insert links to GENESIS_HASH; second links to first audit_hash (T18)', async () => {
    const fixedTime = new Date('2026-05-27T12:00:00.000Z');
    let calls = 0;
    const repo = createInMemoryAnomalyDetectionRepository({
      now: () => {
        // Return monotonically increasing timestamps so list ordering
        // is unambiguous.
        const t = new Date(fixedTime.getTime() + calls * 1000);
        calls += 1;
        return t;
      },
    });
    const first = await repo.insert({
      tenantId: 'mw-1',
      detector: 'zscore',
      target: 'asset:loader-7',
      value: 66,
      score: 5.2,
      threshold: 3,
      anomalous: true,
      evidence: { unit: 'L/h', baselineN: 12 },
    });
    expect(first.prevHash).toBe(GENESIS_HASH);
    expect(first.auditHash.length).toBe(64);

    const second = await repo.insert({
      tenantId: 'mw-1',
      detector: 'mad',
      target: 'asset:loader-7',
      value: 70,
      score: 6.0,
      threshold: 3.5,
      anomalous: true,
      evidence: { unit: 'L/h' },
    });
    expect(second.prevHash).toBe(first.auditHash);
    expect(second.auditHash).not.toBe(first.auditHash);
  });

  it('listByTenant respects anomalousOnly filter and orders newest first', async () => {
    let i = 0;
    const repo = createInMemoryAnomalyDetectionRepository({
      now: () => {
        const t = new Date(1748366400000 + i * 1000);
        i += 1;
        return t;
      },
    });
    await repo.insert({
      tenantId: 'mw-1',
      detector: 'zscore',
      target: 'asset:a',
      value: 1,
      score: 1,
      threshold: 3,
      anomalous: false,
      evidence: {},
    });
    await repo.insert({
      tenantId: 'mw-1',
      detector: 'zscore',
      target: 'asset:b',
      value: 5,
      score: 5,
      threshold: 3,
      anomalous: true,
      evidence: {},
    });
    const all = await repo.listByTenant('mw-1');
    expect(all).toHaveLength(2);
    expect(all[0]!.target).toBe('asset:b');
    const onlyAnom = await repo.listByTenant('mw-1', { anomalousOnly: true });
    expect(onlyAnom).toHaveLength(1);
    expect(onlyAnom[0]!.anomalous).toBe(true);
  });

  it('rejects empty tenantId / detector / target', async () => {
    const repo = createInMemoryAnomalyDetectionRepository();
    await expect(
      repo.insert({
        tenantId: '',
        detector: 'zscore',
        target: 'x',
        value: 1,
        score: 1,
        threshold: 3,
        anomalous: false,
        evidence: {},
      }),
    ).rejects.toThrow(/tenantId/);
    await expect(
      repo.insert({
        tenantId: 't',
        detector: '',
        target: 'x',
        value: 1,
        score: 1,
        threshold: 3,
        anomalous: false,
        evidence: {},
      }),
    ).rejects.toThrow(/detector/);
    await expect(
      repo.insert({
        tenantId: 't',
        detector: 'zscore',
        target: '',
        value: 1,
        score: 1,
        threshold: 3,
        anomalous: false,
        evidence: {},
      }),
    ).rejects.toThrow(/target/);
  });

  it('rows are frozen — mutation is forbidden', async () => {
    const repo = createInMemoryAnomalyDetectionRepository();
    const row = await repo.insert({
      tenantId: 'mw-1',
      detector: 'zscore',
      target: 'asset:a',
      value: 1,
      score: 1,
      threshold: 3,
      anomalous: false,
      evidence: { unit: 'L/h' },
    });
    expect(Object.isFrozen(row)).toBe(true);
    expect(Object.isFrozen(row.evidence)).toBe(true);
  });

  it('computeAnomalyAuditHash is deterministic and stable across key order', () => {
    const base = {
      op: 'insert' as const,
      tenantId: 'mw-1',
      detector: 'zscore',
      target: 'asset:a',
      value: 1,
      score: 1,
      threshold: 3,
      anomalous: false,
      detectedAtIso: '2026-05-27T12:00:00.000Z',
    };
    const e1 = { a: 1, b: 2 } as const;
    const e2 = { b: 2, a: 1 } as const;
    const h1 = computeAnomalyAuditHash({ ...base, evidence: e1 }, '');
    const h2 = computeAnomalyAuditHash({ ...base, evidence: e2 }, '');
    expect(h1).toBe(h2);
  });

  it('findById returns null for unknown ids', async () => {
    const repo = createInMemoryAnomalyDetectionRepository();
    const missing = await repo.findById('00000000-0000-0000-0000-000000000000');
    expect(missing).toBeNull();
  });

  it('listByTarget filters and orders newest-first', async () => {
    let i = 0;
    const repo = createInMemoryAnomalyDetectionRepository({
      now: () => {
        const t = new Date(1748366400000 + i * 1000);
        i += 1;
        return t;
      },
    });
    await repo.insert({
      tenantId: 'mw-1',
      detector: 'zscore',
      target: 'asset:a',
      value: 1,
      score: 1,
      threshold: 3,
      anomalous: false,
      evidence: {},
    });
    await repo.insert({
      tenantId: 'mw-1',
      detector: 'mad',
      target: 'asset:a',
      value: 2,
      score: 2,
      threshold: 3.5,
      anomalous: false,
      evidence: {},
    });
    await repo.insert({
      tenantId: 'mw-1',
      detector: 'mad',
      target: 'asset:b',
      value: 3,
      score: 3,
      threshold: 3.5,
      anomalous: true,
      evidence: {},
    });
    const a = await repo.listByTarget('mw-1', 'asset:a');
    expect(a).toHaveLength(2);
    expect(a[0]!.detector).toBe('mad'); // newer
  });
});
