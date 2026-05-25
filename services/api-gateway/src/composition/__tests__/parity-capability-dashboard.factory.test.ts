/**
 * Tests for the parity-capability-dashboard factory (Wave-K Gap C).
 *
 * We exercise the factory against a stub `db.execute` so the tests are
 * driver-agnostic and don't require a live Postgres. Each test queues a
 * sequence of result rows and asserts the factory aggregates them into
 * the shape the router + UI expect.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createParityCapabilityDashboard,
  mapCapability,
} from '../parity-capability-dashboard.factory';

const PREFIXES = {
  'rent-reconciliation': ['finance.', 'tenant.payment', 'arrears.', 'recon.'],
  'lease-renewal': ['lease.', 'renewal.', 'tenant.renew', 'leasing.'],
  'kra-mri': ['compliance.kra', 'tax.', 'mri.'],
  gepg: ['gepg.', 'gov.payment', 'public.bill'],
  'maintenance-triage': ['maintenance.', 'workorder.', 'triage.'],
  'voice-agent': ['voice.', 'call.', 'ivr.', 'whatsapp.voice'],
};

const CAPABILITIES = Object.keys(PREFIXES);

interface QueuedResult {
  readonly rows: ReadonlyArray<Record<string, unknown>>;
}

/**
 * Extract a printable SQL string from whatever Drizzle hands `db.execute`.
 *
 * `sql.raw("...")` packs the raw text into a `StringChunk` on the
 * `queryChunks` array (see drizzle-orm `Sql` class). We walk that array
 * defensively because the internal field name has churned between
 * Drizzle minor versions.
 */
function flattenSqlForAssertion(q: unknown): string {
  if (typeof q === 'string') return q;
  if (!q || typeof q !== 'object') return String(q);
  const anyq = q as { queryChunks?: unknown };
  const chunks = anyq.queryChunks;
  if (Array.isArray(chunks)) {
    return chunks
      .map((c) => {
        if (typeof c === 'string') return c;
        if (c && typeof c === 'object') {
          const v =
            (c as { value?: unknown }).value
            ?? (c as { sql?: unknown }).sql
            ?? '';
          if (Array.isArray(v)) return v.join('');
          return String(v);
        }
        return '';
      })
      .join('');
  }
  return String((anyq as { sql?: string }).sql ?? '[unprintable-sql]');
}

function createStubDb(queue: QueuedResult[]) {
  const calls: string[] = [];
  const execute = vi.fn(async (q: unknown) => {
    calls.push(flattenSqlForAssertion(q));
    if (queue.length === 0) return { rows: [] };
    return queue.shift() ?? { rows: [] };
  });
  return { db: { execute }, calls, execute };
}

const FIXED_NOW = new Date('2026-05-14T12:00:00.000Z');
const now = () => FIXED_NOW;

describe('mapCapability', () => {
  it('maps a sensor id with a known prefix to its capability bucket', () => {
    expect(mapCapability('lease.renewal-2026', PREFIXES)).toBe('lease-renewal');
    expect(mapCapability('finance.recon', PREFIXES)).toBe('rent-reconciliation');
    expect(mapCapability('voice.ivr-call', PREFIXES)).toBe('voice-agent');
  });

  it('returns null when no prefix matches', () => {
    expect(mapCapability('unknown.sensor', PREFIXES)).toBeNull();
    expect(mapCapability(null, PREFIXES)).toBeNull();
  });
});

describe('createParityCapabilityDashboard', () => {
  it('getRollup returns a zeroed tile for every capability when no prefixes match', async () => {
    // Queue one result per capability (6 totals query) + one totals query
    // — every row empty so the aggregates collapse to zero.
    const queue: QueuedResult[] = [];
    for (let i = 0; i < CAPABILITIES.length; i++) {
      queue.push({ rows: [{ runs: 0, mean_score: null, regen_rate: null }] });
    }
    queue.push({ rows: [{ prov_count: 0, cot_count: 0 }] });
    const { db } = createStubDb(queue);
    const svc = createParityCapabilityDashboard({ db, now });

    const rollup = await svc.getRollup('tenant-x', {
      capabilities: CAPABILITIES,
      capabilityPrefixes: PREFIXES,
    });
    expect(rollup.capabilities).toHaveLength(6);
    for (const tile of rollup.capabilities) {
      expect(tile.runsLast24h).toBe(0);
      expect(tile.meanJudgeScore).toBeNull();
      expect(tile.regenRateLast24h).toBeNull();
    }
    expect(rollup.totals).toEqual({ provenanceCount: 0, cotSampleCount: 0 });
    expect(rollup.generatedAt).toBe(FIXED_NOW.toISOString());
  });

  it('getRollup aggregates non-zero counts per capability bucket', async () => {
    const queue: QueuedResult[] = [];
    // 1. rent-reconciliation tile
    queue.push({ rows: [{ runs: 5n, mean_score: '0.82', regen_rate: '0.2' }] });
    // 2. lease-renewal tile
    queue.push({ rows: [{ runs: 3, mean_score: 0.91, regen_rate: 0.0 }] });
    // 3-6. remaining tiles empty
    for (let i = 0; i < 4; i++) {
      queue.push({ rows: [{ runs: 0, mean_score: null, regen_rate: null }] });
    }
    // 7. totals query
    queue.push({ rows: [{ prov_count: 8, cot_count: 4 }] });
    const { db } = createStubDb(queue);
    const svc = createParityCapabilityDashboard({ db, now });

    const rollup = await svc.getRollup('tenant-x', {
      capabilities: CAPABILITIES,
      capabilityPrefixes: PREFIXES,
    });
    const rent = rollup.capabilities.find((c) => c.id === 'rent-reconciliation')!;
    expect(rent.runsLast24h).toBe(5);
    expect(rent.meanJudgeScore).toBeCloseTo(0.82);
    expect(rent.regenRateLast24h).toBeCloseTo(0.2);
    const lease = rollup.capabilities.find((c) => c.id === 'lease-renewal')!;
    expect(lease.runsLast24h).toBe(3);
    expect(rollup.totals.provenanceCount).toBe(8);
    expect(rollup.totals.cotSampleCount).toBe(4);
  });

  it('getRollup tolerates per-capability query errors and returns a zeroed tile', async () => {
    let call = 0;
    const execute = vi.fn(async () => {
      call++;
      if (call === 1) throw new Error('drizzle-down');
      // remaining calls succeed with zeros
      if (call <= CAPABILITIES.length) return { rows: [{ runs: 0 }] };
      return { rows: [{ prov_count: 0, cot_count: 0 }] };
    });
    const svc = createParityCapabilityDashboard({ db: { execute }, now });
    const rollup = await svc.getRollup('tenant-x', {
      capabilities: CAPABILITIES,
      capabilityPrefixes: PREFIXES,
    });
    expect(rollup.capabilities).toHaveLength(6);
    expect(rollup.capabilities[0]!.runsLast24h).toBe(0);
  });

  it('listRuns forwards filters and shapes rows', async () => {
    const queue: QueuedResult[] = [
      {
        rows: [
          {
            thought_id: 't_1',
            thread_id: 'th_1',
            stakes: 'high',
            judge_score: '0.42',
            sensor_id: 'finance.recon-2026-05-12',
            model_id: 'claude-sonnet-4-6',
            produced_at: new Date('2026-05-12T08:00:00Z'),
          },
          {
            thought_id: 't_2',
            thread_id: 'th_2',
            stakes: 'medium',
            judge_score: null,
            sensor_id: 'finance.recon-other',
            model_id: 'claude-sonnet-4-6',
            produced_at: new Date('2026-05-12T09:00:00Z'),
          },
        ],
      },
      { rows: [{ total: 2 }] },
    ];
    const { db, calls } = createStubDb(queue);
    const svc = createParityCapabilityDashboard({ db, now });

    const result = await svc.listRuns('tenant-x', {
      capability: 'rent-reconciliation',
      capabilityPrefixes: PREFIXES['rent-reconciliation'],
      minScore: 0.1,
      maxScore: 0.5,
      limit: 50,
      offset: 0,
    });
    expect(result.total).toBe(2);
    expect(result.runs).toHaveLength(2);
    expect(result.runs[0]!.thoughtId).toBe('t_1');
    expect(result.runs[0]!.judgeScore).toBeCloseTo(0.42);
    expect(result.runs[0]!.capability).toBe('rent-reconciliation');
    expect(result.runs[1]!.judgeScore).toBeNull();
    // SQL should reflect score filters + LIMIT/OFFSET.
    const listSql = calls[0] ?? '';
    expect(listSql).toContain('judge_score >= 0.1');
    expect(listSql).toContain('judge_score <= 0.5');
    expect(listSql).toContain('LIMIT 50');
    expect(listSql).toContain('OFFSET 0');
  });

  it('listRuns returns empty result and total=0 when the query fails', async () => {
    const execute = vi.fn(async () => {
      throw new Error('boom');
    });
    const svc = createParityCapabilityDashboard({ db: { execute }, now });
    const result = await svc.listRuns('tenant-x', {
      limit: 50,
      offset: 0,
    });
    expect(result.runs).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('getRun returns null when the row is not found', async () => {
    const { db } = createStubDb([{ rows: [] }]);
    const svc = createParityCapabilityDashboard({ db, now });
    const out = await svc.getRun('tenant-x', 'missing-id');
    expect(out).toBeNull();
  });

  it('getRun joins provenance + cot reservoir into a detail payload', async () => {
    const queue: QueuedResult[] = [
      {
        rows: [
          {
            thought_id: 't_99',
            thread_id: 'th_99',
            stakes: 'critical',
            judge_score: '0.71',
            sensor_id: 'lease.renewal-q2',
            model_id: 'claude-sonnet-4-6',
            produced_at: new Date('2026-05-13T10:00:00Z'),
            input_hash: 'ih_99',
            output_hash: 'oh_99',
            thought_text: 'CoT body (scrubbed)',
            cot_prompt_hash: 'ph_99',
            cot_response_hash: 'rh_99',
          },
        ],
      },
    ];
    const { db } = createStubDb(queue);
    const svc = createParityCapabilityDashboard({ db, now });
    const out = await svc.getRun('tenant-x', 't_99');
    expect(out).not.toBeNull();
    expect(out!.thoughtId).toBe('t_99');
    expect(out!.judgeScore).toBeCloseTo(0.71);
    expect(out!.cotThoughtText).toBe('CoT body (scrubbed)');
    expect(out!.promptHash).toBe('ph_99');
    expect(out!.responseHash).toBe('rh_99');
    expect(out!.modelId).toBe('claude-sonnet-4-6');
    expect(out!.sensorId).toBe('lease.renewal-q2');
    expect(out!.judgeReasonText).toBeNull();
    expect(out!.judgeSuggestedFix).toBeNull();
  });

  it('rejudge returns a queued verdict without touching the DB (tier-3 stub)', async () => {
    const execute = vi.fn();
    const svc = createParityCapabilityDashboard({ db: { execute }, now });
    const verdict = await svc.rejudge('tenant-x', 't_42', {});
    expect(verdict.accepted).toBe(true);
    expect(verdict.queued).toBe(true);
    expect(verdict.thoughtId).toBe('t_42');
    expect(verdict.requestedAt).toBe(FIXED_NOW.toISOString());
    expect(execute).not.toHaveBeenCalled();
  });
});
