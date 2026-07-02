/**
 * Tests for the audit-chain integrity SWEEP cron wiring (Tier-1 integrity-sweep).
 *
 * `@borjie/observability`'s `runAuditChainIntegritySweep` had ZERO production
 * callers — a real tamper in `audit_trail_entries` was never detected in a live
 * scheduled path. This cron is that caller. Here we drive it with a fake
 * `execute(q)` DB that returns canned audit-trail rows and assert:
 *   - a CLEAN hash-linked chain records a PASS (no alert),
 *   - a TAMPERED row is DETECTED + RECORDED (the integrity recorder alert +
 *     metric fire) — the core born-dark closure,
 *   - a DB read error degrades to a logged no-op (zero chains checked, no throw),
 *   - the cron is actually STARTED from the consolidation-worker `index.ts`
 *     (source guard — a revert of the start wiring goes RED).
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  recomputeThisHash,
  GENESIS_PREV_HASH_V2,
  type SerializedAuditEvent,
  type AuditIntegrityRecorder,
} from '@borjie/observability';
import {
  buildAuditIntegritySweepCronDeps,
  runAuditIntegritySweepTick,
  resolveAuditSweepIntervalMs,
  type AuditSweepDbLike,
} from '../tasks/audit-integrity-sweep-cron.js';

/**
 * Build a valid, hash-linked chain of `count` rows for one tenant, in the flat
 * `audit_trail_entries` DB shape (snake_case columns, `evidence_json`).
 */
function buildDbRows(
  tenantId: string,
  count: number,
): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  let prevHash = GENESIS_PREV_HASH_V2;
  for (let seq = 1; seq <= count; seq++) {
    const evidence = { note: `row ${seq}` };
    const event: SerializedAuditEvent = {
      sequenceId: seq,
      prevHash,
      tenantId,
      occurredAt: `2026-07-0${seq}T00:00:00.000Z`,
      actorKind: 'ai_execution',
      actionKind: 'offtake.accept',
      actionCategory: 'offtake',
      decision: 'executed',
      evidence,
      thisHash: '',
      signature: null,
    };
    const thisHash = recomputeThisHash(event);
    rows.push({
      tenant_id: tenantId,
      sequence_id: seq,
      prev_hash: prevHash,
      occurred_at: event.occurredAt,
      actor_kind: event.actorKind,
      action_kind: event.actionKind,
      action_category: event.actionCategory,
      decision: event.decision,
      evidence_json: evidence,
      this_hash: thisHash,
      signature: null,
    });
    prevHash = thisHash;
  }
  return rows;
}

/** A fake DB whose `execute` returns canned audit-trail rows (or throws). */
function fakeDb(
  rows: ReadonlyArray<Record<string, unknown>>,
  opts: { fail?: boolean } = {},
): AuditSweepDbLike {
  return {
    async execute(): Promise<unknown> {
      if (opts.fail) throw new Error('audit_trail read boom');
      return { rows };
    },
  };
}

/** A spy recorder capturing every verdict handed to it. */
function spyRecorder(): {
  recorder: AuditIntegrityRecorder;
  records: Array<{ valid: boolean; tenantId: string; reason?: string }>;
} {
  const records: Array<{ valid: boolean; tenantId: string; reason?: string }> =
    [];
  const recorder: AuditIntegrityRecorder = {
    record(result) {
      records.push({
        valid: result.valid,
        tenantId: result.tenantId,
        ...(result.reason ? { reason: result.reason } : {}),
      });
      return result;
    },
    recordBatch(results) {
      for (const r of results) recorder.record(r);
      return results;
    },
  };
  return { recorder, records };
}

describe('runAuditIntegritySweepTick', () => {
  it('records a PASS for a clean multi-tenant row set (no tamper)', async () => {
    const rows = [...buildDbRows('tnt_estate_1', 3), ...buildDbRows('tnt_estate_2', 2)];
    const { recorder, records } = spyRecorder();

    const summary = await runAuditIntegritySweepTick({
      db: fakeDb(rows),
      recorder,
    });

    expect(summary.chainsChecked).toBe(2);
    expect(summary.chainsBroken).toBe(0);
    expect(records.every((r) => r.valid)).toBe(true);
  });

  it('DETECTS + RECORDS a tampered row (the born-dark closure)', async () => {
    const rows = buildDbRows('tnt_estate_1', 3);
    // Mutate row 2's payload WITHOUT recomputing its hash — the exact post-hoc
    // tamper the chain must catch. The stored `this_hash` no longer matches.
    const tampered = rows.map((r) =>
      r.sequence_id === 2 ? { ...r, evidence_json: { note: 'MUTATED' } } : r,
    );

    const { recorder, records } = spyRecorder();
    const summary = await runAuditIntegritySweepTick({
      db: fakeDb(tampered),
      recorder,
    });

    expect(summary.chainsBroken).toBe(1);
    const broken = records.find((r) => !r.valid);
    expect(broken?.tenantId).toBe('tnt_estate_1');
    expect(broken?.reason).toBe('payload-mutated');
  });

  it('the DEFAULT recorder built by the cron deps flags a real tamper', async () => {
    // Prove the metric + pager path is genuinely reachable from the WIRED cron
    // (its own recorder), not only from a test-injected recorder.
    const rows = buildDbRows('tnt_estate_9', 2);
    const tampered = rows.map((r) =>
      r.sequence_id === 2 ? { ...r, this_hash: 'forged-hash' } : r,
    );
    const deps = buildAuditIntegritySweepCronDeps(fakeDb(tampered));
    const summary = await runAuditIntegritySweepTick(deps);
    // Only rises because the default recorder ran over the tampered chain.
    expect(summary.chainsBroken).toBeGreaterThanOrEqual(1);
  });

  it('a DB read error degrades to zero chains checked (never throws)', async () => {
    const { recorder } = spyRecorder();
    const summary = await runAuditIntegritySweepTick({
      db: fakeDb([], { fail: true }),
      recorder,
    });
    expect(summary.chainsChecked).toBe(0);
    expect(summary.chainsBroken).toBe(0);
  });
});

describe('resolveAuditSweepIntervalMs', () => {
  it('defaults to 1h and clamps to [5min, 24h]', () => {
    const prev = process.env.AUDIT_INTEGRITY_SWEEP_INTERVAL_MS;
    delete process.env.AUDIT_INTEGRITY_SWEEP_INTERVAL_MS;
    expect(resolveAuditSweepIntervalMs()).toBe(60 * 60 * 1000);
    process.env.AUDIT_INTEGRITY_SWEEP_INTERVAL_MS = '1000'; // below floor
    expect(resolveAuditSweepIntervalMs()).toBe(5 * 60 * 1000);
    process.env.AUDIT_INTEGRITY_SWEEP_INTERVAL_MS = String(48 * 60 * 60 * 1000); // above ceil
    expect(resolveAuditSweepIntervalMs()).toBe(24 * 60 * 60 * 1000);
    if (prev === undefined) delete process.env.AUDIT_INTEGRITY_SWEEP_INTERVAL_MS;
    else process.env.AUDIT_INTEGRITY_SWEEP_INTERVAL_MS = prev;
  });
});

describe('SOURCE: consolidation-worker index.ts starts the sweep cron', () => {
  function readIndexSource(): string {
    const here = fileURLToPath(import.meta.url);
    const indexPath = here.replace(
      '__tests__/audit-integrity-sweep-cron.test.ts',
      'index.ts',
    );
    return readFileSync(indexPath, 'utf8');
  }

  it('imports + schedules runAuditIntegritySweepTick', () => {
    const src = readIndexSource();
    expect(src).toContain('runAuditIntegritySweepTick');
    expect(src).toContain('buildAuditIntegritySweepCronDeps');
    // Scheduled on an interval AND fired once on boot.
    expect(src).toMatch(/setInterval\(\s*\(\)\s*=>\s*void runAuditSweepTick\(\)/);
    expect(src).toMatch(/void runAuditSweepTick\(\);/);
  });

  it('clears the sweep interval on shutdown', () => {
    const src = readIndexSource();
    expect(src).toContain('clearInterval(auditSweepHandle)');
  });
});
