/**
 * EstateMind Slow Loop tests (Wave 1, organ #1).
 *
 * Covers the end-to-end tick against fakes:
 *   - one cycle: PERCEIVE folds observations → ORIENT snapshot → drives →
 *     a proposal is emitted through the gated sink for an unsatisfied drive;
 *   - the loop NEVER executes — it only proposes (no executor handle exists);
 *   - state is held between ticks (the situational model IS the state);
 *   - a failing perception source / sink degrades the tick, never throws;
 *   - proposals coalesce on a stable drive-keyed id (re-tick is harmless).
 */

import { describe, it, expect } from 'vitest';
import {
  createInMemorySituationalModelStore,
  createSituationalModel,
} from '../../situational-model/index.js';
import { createMotivationEngine } from '../../motivation/index.js';
import { createEstateMind } from '../index.js';
import type {
  EstateProposal,
  PerceptionSource,
  ProposalSink,
} from '../index.js';
import type { RecordEntityInput } from '../../situational-model/index.js';

const T = 'tenant-A';

function recordingSink(): { sink: ProposalSink; seen: EstateProposal[] } {
  const seen: EstateProposal[] = [];
  const accepted = new Set<string>();
  return {
    seen,
    sink: {
      async propose(p) {
        seen.push(p);
        // dedupe on (tenant, stable id) — mirrors the real proactive sink
        // cooldown, which is keyed per tenant.
        const key = `${p.tenantId}::${p.id}`;
        if (accepted.has(key)) return false;
        accepted.add(key);
        return true;
      },
    },
  };
}

function perceptionOf(
  rows: ReadonlyArray<RecordEntityInput>,
): PerceptionSource {
  return { async perceive() { return rows; } };
}

function build(opts: {
  perception?: PerceptionSource | null;
  sink?: ProposalSink | null;
  now?: () => number;
}) {
  const now = opts.now ?? (() => 1000);
  const store = createInMemorySituationalModelStore({ now });
  const situationalModel = createSituationalModel({ store, now });
  const motivation = createMotivationEngine({ now });
  const mind = createEstateMind({
    situationalModel,
    motivation,
    perception: opts.perception ?? null,
    proposalSink: opts.sink ?? null,
    now,
  });
  return { mind, situationalModel };
}

describe('EstateMind — one cognitive cycle end-to-end', () => {
  it('PERCEIVE→ORIENT→drives→PROPOSE emits a gated proposal for a breach', async () => {
    const { sink, seen } = recordingSink();
    const { mind } = build({
      perception: perceptionOf([
        { tenantId: T, entityId: 'cash-1', kind: 'cash', label: 'Cash', attributes: { runwayDays: 12 } },
      ]),
      sink,
    });

    const result = await mind.tick(T);

    expect(result.observed).toBe(1);
    expect(result.goalsFormulated).toBe(1);
    expect(result.proposalsEmitted).toBe(1);
    expect(result.degradedReason).toBeNull();
    expect(seen).toHaveLength(1);
    expect(seen[0]?.driveId).toBe('cash-runway');
    expect(seen[0]?.id).toBe('drive:cash-runway');
    expect(seen[0]?.evidenceEntityIds).toContain('cash-1');
  });

  it('a healthy estate proposes nothing', async () => {
    const { sink, seen } = recordingSink();
    const { mind } = build({
      perception: perceptionOf([
        { tenantId: T, entityId: 'cash-1', kind: 'cash', label: 'Cash', attributes: { runwayDays: 200 } },
      ]),
      sink,
    });
    const result = await mind.tick(T);
    expect(result.goalsFormulated).toBe(0);
    expect(result.proposalsEmitted).toBe(0);
    expect(seen).toHaveLength(0);
  });

  it('holds state between ticks — the situational model IS the state', async () => {
    let t = 1000;
    const { sink } = recordingSink();
    const { mind, situationalModel } = build({
      perception: perceptionOf([
        { tenantId: T, entityId: 'cash-1', kind: 'cash', label: 'Cash', attributes: { runwayDays: 12 } },
      ]),
      sink,
      now: () => t,
    });
    await mind.tick(T);
    t += 60 * 60 * 1000;
    await mind.tick(T);
    const row = await situationalModel.get(T, 'cash:cash-1');
    // two observations folded across two ticks — frequency accumulated
    expect(row?.referenceCount).toBe(2);
  });

  it('re-ticking coalesces the same proposal (idempotent)', async () => {
    const { sink, seen } = recordingSink();
    const { mind } = build({
      perception: perceptionOf([
        { tenantId: T, entityId: 'cash-1', kind: 'cash', label: 'Cash', attributes: { runwayDays: 12 } },
      ]),
      sink,
    });
    const a = await mind.tick(T);
    const b = await mind.tick(T);
    expect(a.proposalsEmitted).toBe(1);
    // second proposal hits the same stable id → sink dedupes → not re-emitted
    expect(b.proposalsEmitted).toBe(0);
    expect(seen.map((p) => p.id)).toEqual(['drive:cash-runway', 'drive:cash-runway']);
  });
});

describe('EstateMind — never throws, degrades safe', () => {
  it('a throwing perception source degrades the tick but never throws', async () => {
    const throwing: PerceptionSource = {
      async perceive() {
        throw new Error('sensor down');
      },
    };
    const { mind } = build({ perception: throwing, sink: null });
    const result = await mind.tick(T);
    expect(result.degradedReason).toBe('perceive-failed');
    expect(result.observed).toBe(0);
  });

  it('a throwing proposal sink degrades the tick but never throws', async () => {
    const throwingSink: ProposalSink = {
      async propose() {
        throw new Error('sink down');
      },
    };
    const { mind } = build({
      perception: perceptionOf([
        { tenantId: T, entityId: 'cash-1', kind: 'cash', label: 'Cash', attributes: { runwayDays: 1 } },
      ]),
      sink: throwingSink,
    });
    const result = await mind.tick(T);
    expect(result.degradedReason).toBe('propose-failed');
    expect(result.proposalsEmitted).toBe(0);
  });

  it('cycle isolates per-tenant work and aggregates proposals', async () => {
    const { sink, seen } = recordingSink();
    const { mind } = build({
      perception: {
        async perceive({ tenantId }) {
          // each tenant has its own breach
          return [
            { tenantId, entityId: 'cash-1', kind: 'cash', label: 'Cash', attributes: { runwayDays: 5 } },
          ];
        },
      },
      sink,
    });
    const out = await mind.cycle(['tenant-A', 'tenant-B', '']);
    expect(out.tenants).toBe(2); // empty id skipped
    expect(out.proposalsEmitted).toBe(2);
    expect(seen.map((p) => p.tenantId).sort()).toEqual(['tenant-A', 'tenant-B']);
  });
});
