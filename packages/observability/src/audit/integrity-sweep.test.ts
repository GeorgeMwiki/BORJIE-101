/**
 * Live audit-chain integrity SWEEP tests.
 *
 * Proves the previously CLI-only verify + record path now runs as a reusable
 * consumer over flat `audit_trail_entries` rows:
 *   (1) a clean multi-tenant row set verifies + records a PASS per tenant,
 *   (2) a tampered row is DETECTED and RECORDED (metric + alert) — the core
 *       born-dark closure: a tamper is now observable, not just test-only,
 *   (3) interleaved / out-of-order rows are grouped + sorted correctly,
 *   (4) the recorder is fan-ned every verdict (pass + fail).
 */

import { describe, it, expect, vi } from 'vitest';
import {
  runAuditChainIntegritySweep,
  groupRowsIntoExports,
  type AuditTrailRow,
} from './integrity-sweep.js';
import {
  recomputeThisHash,
  GENESIS_PREV_HASH_V2,
  type SerializedAuditEvent,
} from './offline-chain-verify.js';
import { createAuditIntegrityRecorder } from './integrity-metric.js';

/** Build a valid, hash-linked chain of `count` rows for one tenant. */
function buildChain(tenantId: string, count: number): AuditTrailRow[] {
  const rows: AuditTrailRow[] = [];
  let prevHash = GENESIS_PREV_HASH_V2;
  for (let seq = 1; seq <= count; seq++) {
    const event: SerializedAuditEvent = {
      sequenceId: seq,
      prevHash,
      tenantId,
      occurredAt: `2026-07-0${seq}T00:00:00.000Z`,
      actorKind: 'ai_execution',
      actionKind: 'offtake.accept',
      actionCategory: 'offtake',
      decision: 'executed',
      evidence: { note: `row ${seq}` },
      thisHash: '',
      signature: null,
    };
    const thisHash = recomputeThisHash(event);
    rows.push({ ...event, thisHash });
    prevHash = thisHash;
  }
  return rows;
}

describe('runAuditChainIntegritySweep', () => {
  it('records a PASS per tenant for a clean multi-tenant row set', () => {
    const rows = [...buildChain('tnt_estate_1', 3), ...buildChain('tnt_estate_2', 2)];
    const onIntegrityFailure = vi.fn();
    const recorder = createAuditIntegrityRecorder({ onIntegrityFailure });

    const summary = runAuditChainIntegritySweep(rows, { recorder });

    expect(summary.chainsChecked).toBe(2);
    expect(summary.chainsBroken).toBe(0);
    expect(summary.results.every((r) => r.valid)).toBe(true);
    expect(onIntegrityFailure).not.toHaveBeenCalled();
  });

  it('DETECTS and RECORDS a tampered row (metric + alert fire in the live sweep)', () => {
    const rows = buildChain('tnt_estate_1', 3);
    // Tamper the payload of row 2 WITHOUT recomputing its hash — exactly the
    // post-hoc mutation the chain must catch.
    const tampered = rows.map((r, i) =>
      i === 1 ? { ...r, evidence: { note: 'MUTATED' } } : r,
    );

    const onIntegrityFailure = vi.fn();
    const recorder = createAuditIntegrityRecorder({ onIntegrityFailure });

    const summary = runAuditChainIntegritySweep(tampered, { recorder });

    expect(summary.chainsBroken).toBe(1);
    const broken = summary.results.find((r) => !r.valid);
    expect(broken?.reason).toBe('payload-mutated');
    expect(broken?.brokenAt).toBe(2);
    expect(onIntegrityFailure).toHaveBeenCalledTimes(1);
    expect(onIntegrityFailure).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tnt_estate_1', reason: 'payload-mutated' }),
    );
  });

  it('groups + sorts interleaved out-of-order rows per tenant', () => {
    const a = buildChain('tnt_estate_1', 2);
    const b = buildChain('tnt_estate_2', 2);
    // Interleave + shuffle: t2#2, t1#1, t2#1, t1#2
    const shuffled = [b[1]!, a[0]!, b[0]!, a[1]!];

    const exports = groupRowsIntoExports(shuffled);
    expect(exports).toHaveLength(2);
    for (const exp of exports) {
      expect(exp.events.map((e) => e.sequenceId)).toEqual([1, 2]);
      expect(exp.head).toBe(exp.events[exp.events.length - 1]!.thisHash);
    }

    // And the shuffled set still verifies clean once grouped/sorted.
    const summary = runAuditChainIntegritySweep(shuffled);
    expect(summary.chainsBroken).toBe(0);
  });

  it('fans every verdict (pass + fail) through the recorder', () => {
    const clean = buildChain('tnt_estate_1', 2);
    const brokenChain = buildChain('tnt_estate_2', 2).map((r, i) =>
      i === 0 ? { ...r, sequenceId: 5 } : r,
    );
    const recordSpy = vi.fn((v) => v);
    const recorder = { record: recordSpy, recordBatch: (rs: readonly unknown[]) => rs };

    const summary = runAuditChainIntegritySweep([...clean, ...brokenChain], {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      recorder: recorder as any,
    });

    expect(recordSpy).toHaveBeenCalledTimes(2); // one verdict per tenant chain
    expect(summary.chainsChecked).toBe(2);
    expect(summary.chainsBroken).toBe(1);
  });
});
