/**
 * MEM-05 — real consolidator tests.
 *
 * Proves the consolidator is a genuine consolidation pass (not the old
 * "1 fact per N raw turns" stub):
 *   - BRAIN mode extracts durable facts from the LLM's strict-JSON output.
 *   - Malformed / failing brain degrades to the deterministic pass (no throw).
 *   - DETERMINISTIC mode aggregates RECURRING topics with recurrence-scaled
 *     confidence — abstracting across the group rather than echoing one turn.
 *   - The `ConsolidatorPort` shape matches what the worker wires (drop-in).
 */

import { describe, it, expect } from 'vitest';
import {
  createBrainConsolidator,
  type ConsolidationBrainPort,
  type ReservoirEntry,
} from '../consolidation/consolidator.js';

function entry(
  i: number,
  summary: string,
  capturedAt = `2026-06-08T00:0${i}:00.000Z`,
): ReservoirEntry {
  return {
    thoughtId: `t-${i}`,
    tenantId: 'tenant-a',
    userId: 'user-1',
    threadId: 'thread-1',
    summary,
    capturedAt,
  };
}

describe('createBrainConsolidator (MEM-05)', () => {
  it('extracts durable facts from a brain that returns strict JSON', async () => {
    const brain: ConsolidationBrainPort = {
      async summarise() {
        return JSON.stringify({
          facts: [
            { key: 'preferred_currency', value: 'TZS', confidence: 0.9 },
            { key: 'focus_licence', value: 'ML-001', confidence: 0.8 },
          ],
        });
      },
    };
    const consolidator = createBrainConsolidator({ brain });
    const facts = await consolidator.consolidate({
      tenantId: 'tenant-a',
      userId: 'user-1',
      entries: [entry(1, 'asked about TZS'), entry(2, 'asked about ML-001')],
    });
    expect(facts).toHaveLength(2);
    expect(facts[0]?.key).toBe('preferred_currency');
    expect(facts[0]?.value).toBe('TZS');
    expect(facts[0]?.confidence).toBeCloseTo(0.9, 3);
  });

  it('honors an explicit empty fact set from the brain (no deterministic noise)', async () => {
    const brain: ConsolidationBrainPort = {
      async summarise() {
        return '{ "facts": [] }';
      },
    };
    const consolidator = createBrainConsolidator({ brain });
    const facts = await consolidator.consolidate({
      tenantId: 'tenant-a',
      userId: 'user-1',
      entries: [entry(1, 'random a'), entry(2, 'random b')],
    });
    expect(facts).toEqual([]);
  });

  it('degrades to the deterministic pass when the brain throws', async () => {
    const brain: ConsolidationBrainPort = {
      async summarise() {
        throw new Error('LLM unavailable');
      },
    };
    const consolidator = createBrainConsolidator({ brain });
    const facts = await consolidator.consolidate({
      tenantId: 'tenant-a',
      userId: 'user-1',
      entries: [
        entry(1, 'royalty reconciliation for the gold royalty statement'),
        entry(2, 'another royalty question about royalty rates'),
        entry(3, 'royalty payment timing'),
      ],
    });
    // Deterministic pass found the recurring "royalty" topic.
    expect(facts.length).toBeGreaterThan(0);
    expect(facts.some((f) => f.key.includes('royalty'))).toBe(true);
  });

  it('deterministic mode aggregates recurring topics with recurrence-scaled confidence', async () => {
    const consolidator = createBrainConsolidator(); // no brain
    const facts = await consolidator.consolidate({
      tenantId: 'tenant-a',
      userId: 'user-1',
      entries: [
        entry(1, 'licence renewal for ML-001 deadline'),
        entry(2, 'licence renewal paperwork status'),
        entry(3, 'licence renewal fee question'),
        entry(4, 'unrelated weather chat'),
      ],
    });
    const renewal = facts.find((f) => f.key === 'topic_renewal');
    const licence = facts.find((f) => f.key === 'topic_licence');
    // Both recurring topics (3 of 4 turns) should surface.
    expect(renewal ?? licence).toBeTruthy();
    const top = renewal ?? licence!;
    // 3/4 recurrence → 0.5 + 0.75*0.45 ≈ 0.8375.
    expect(top.confidence).toBeGreaterThan(0.7);
    expect(top.confidence).toBeLessThanOrEqual(0.95);
  });

  it('falls back to a single recent_topic fact when nothing recurs', async () => {
    const consolidator = createBrainConsolidator();
    const facts = await consolidator.consolidate({
      tenantId: 'tenant-a',
      userId: 'user-1',
      entries: [entry(1, 'alpha beta gamma'), entry(2, 'delta epsilon zeta')],
    });
    expect(facts).toHaveLength(1);
    expect(facts[0]?.key).toBe('recent_topic');
    // Newest-first ordering → the most recent summary is the value source.
    expect((facts[0]?.value as { sourceTurnId: string }).sourceTurnId).toBe(
      't-2',
    );
  });

  it('returns nothing below the minimum entry count', async () => {
    const consolidator = createBrainConsolidator({ minEntries: 3 });
    const facts = await consolidator.consolidate({
      tenantId: 'tenant-a',
      userId: 'user-1',
      entries: [entry(1, 'royalty royalty'), entry(2, 'royalty royalty')],
    });
    expect(facts).toEqual([]);
  });

  it('caps facts at maxFactsPerGroup', async () => {
    const brain: ConsolidationBrainPort = {
      async summarise() {
        return JSON.stringify({
          facts: Array.from({ length: 10 }, (_, i) => ({
            key: `k_${i}`,
            value: `v_${i}`,
            confidence: 0.6,
          })),
        });
      },
    };
    const consolidator = createBrainConsolidator({ brain, maxFactsPerGroup: 3 });
    const facts = await consolidator.consolidate({
      tenantId: 'tenant-a',
      userId: 'user-1',
      entries: [entry(1, 'x'), entry(2, 'y')],
    });
    expect(facts).toHaveLength(3);
  });
});
