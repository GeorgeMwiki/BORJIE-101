/**
 * Tests for skill-promotion/promoter.
 *
 * Coverage:
 *   - promote inserts a registry row from a CandidateSkill
 *   - promote is idempotent — second call with the same candidate does
 *     NOT insert a duplicate row (key invariant for nightly worker)
 *   - PromotionRecord shape matches what `skill_registry` expects
 *   - promoter rejects empty tool sequences
 *   - in-memory registry isolates tenant-scoped from global skills
 *   - end-to-end: traces → extractor → gate → promote yields ≥1 row
 */

import { describe, it, expect } from 'vitest';
import {
  buildPromotionRecord,
  createInMemorySkillRegistry,
  promoteSkill,
} from '../promoter.js';
import { extractCandidates } from '../pattern-extractor.js';
import { evaluateCandidate } from '../significance-gate.js';
import type { CandidateSkill, ProceduralTrace } from '../types.js';

function candidate(overrides: Partial<CandidateSkill> = {}): CandidateSkill {
  return {
    codeHash: 'sha-abc',
    tenantId: null,
    toolSequence: [
      { toolName: 'ledger.fetch' },
      { toolName: 'mpesa.match' },
      { toolName: 'ledger.post' },
    ],
    occurrences: 8,
    successCount: 8,
    failureCount: 0,
    firstSeenAt: '2026-05-20T00:00:00.000Z',
    lastSeenAt: '2026-05-24T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildPromotionRecord', () => {
  it('builds a stable PromotionRecord shape from a CandidateSkill', () => {
    const record = buildPromotionRecord(candidate());
    expect(record.tenantId).toBeNull();
    expect(record.codeHash).toBe('sha-abc');
    expect(record.name).toBe(
      'skill__ledger.fetch_to_mpesa.match_to_ledger.post',
    );
    expect(record.nlDescription).toContain('ledger.fetch');
    expect(record.nlDescription).toContain('mpesa.match');
    expect(record.toolCallTemplate).toEqual({
      kind: 'voyager_skill_v1',
      steps: [
        { toolName: 'ledger.fetch', inputShape: null },
        { toolName: 'mpesa.match', inputShape: null },
        { toolName: 'ledger.post', inputShape: null },
      ],
    });
    expect(record.initialSuccessCount).toBe(8);
    expect(record.initialFailureCount).toBe(0);
  });

  it('preserves inputShape when present on tool calls', () => {
    const c = candidate({
      toolSequence: [
        { toolName: 'a', inputShape: { x: 'string' } },
        { toolName: 'b', inputShape: { y: 'number' } },
      ],
    });
    const record = buildPromotionRecord(c);
    const tpl = record.toolCallTemplate as {
      readonly steps: ReadonlyArray<{
        readonly toolName: string;
        readonly inputShape: Record<string, string> | null;
      }>;
    };
    expect(tpl.steps[0]?.inputShape).toEqual({ x: 'string' });
    expect(tpl.steps[1]?.inputShape).toEqual({ y: 'number' });
  });
});

describe('promoteSkill — idempotency', () => {
  it('inserts on first call, returns {promoted:true}', async () => {
    const { writer, snapshot } = createInMemorySkillRegistry();
    const result = await promoteSkill(candidate(), { registry: writer });
    expect(result).not.toBeNull();
    expect(result?.promoted).toBe(true);
    expect(snapshot()).toHaveLength(1);
  });

  it('returns {promoted:false} on second call with the same candidate', async () => {
    const { writer, snapshot } = createInMemorySkillRegistry();
    const c = candidate();
    const first = await promoteSkill(c, { registry: writer });
    const second = await promoteSkill(c, { registry: writer });
    expect(first?.promoted).toBe(true);
    expect(second?.promoted).toBe(false);
    // CRITICAL: registry still has exactly one row.
    expect(snapshot()).toHaveLength(1);
  });

  it('does not insert again even if counts have changed (codeHash is the key)', async () => {
    const { writer, snapshot } = createInMemorySkillRegistry();
    await promoteSkill(candidate({ successCount: 5 }), { registry: writer });
    const second = await promoteSkill(
      candidate({ successCount: 100, failureCount: 7 }),
      { registry: writer },
    );
    expect(second?.promoted).toBe(false);
    expect(snapshot()).toHaveLength(1);
  });

  it('returns null for an empty tool sequence (not eligible)', async () => {
    const { writer, snapshot } = createInMemorySkillRegistry();
    const result = await promoteSkill(
      candidate({ toolSequence: [] }),
      { registry: writer },
    );
    expect(result).toBeNull();
    expect(snapshot()).toHaveLength(0);
  });
});

describe('promoteSkill — tenant scoping', () => {
  it('treats global (tenantId=null) and per-tenant skills as separate rows', async () => {
    const { writer, snapshot } = createInMemorySkillRegistry();
    await promoteSkill(candidate({ tenantId: null }), { registry: writer });
    await promoteSkill(
      candidate({ tenantId: 'tenant_a', codeHash: 'sha-abc' }),
      { registry: writer },
    );
    await promoteSkill(
      candidate({ tenantId: 'tenant_b', codeHash: 'sha-abc' }),
      { registry: writer },
    );
    expect(snapshot()).toHaveLength(3);
  });
});

describe('end-to-end pipeline (extractor → gate → promote)', () => {
  it('promotes recurring successful patterns and rejects rare ones', async () => {
    const recurring = ['ledger.fetch', 'mpesa.match', 'ledger.post'];
    const traces: ProceduralTrace[] = [
      // Recurring pattern appears in 8 traces, all success.
      ...Array.from({ length: 8 }, (_, i) =>
        ({
          traceId: `r-${i}`,
          tenantId: null,
          toolSequence: recurring.map((name) => ({ toolName: name })),
          outcome: 'success' as const,
          observedAt: '2026-05-24T00:00:00.000Z',
        }),
      ),
      // Rare pattern appears in 2 traces only.
      {
        traceId: 'rare-1',
        tenantId: null,
        toolSequence: [{ toolName: 'rare.x' }, { toolName: 'rare.y' }],
        outcome: 'success',
        observedAt: '2026-05-24T00:00:00.000Z',
      },
      {
        traceId: 'rare-2',
        tenantId: null,
        toolSequence: [{ toolName: 'rare.x' }, { toolName: 'rare.y' }],
        outcome: 'success',
        observedAt: '2026-05-24T00:00:00.000Z',
      },
    ];

    const candidates = extractCandidates(traces);
    const decisions = candidates.map((c) => evaluateCandidate(c));
    const promoted = decisions.filter((d) => d.verdict === 'promote');

    expect(promoted.length).toBeGreaterThan(0);
    expect(
      promoted.every((d) => d.candidate.occurrences >= 5),
    ).toBe(true);

    // Run promotion through in-memory registry.
    const { writer, snapshot } = createInMemorySkillRegistry();
    for (const decision of promoted) {
      await promoteSkill(decision.candidate, { registry: writer });
    }
    // At least one row promoted; none for the rare pattern.
    expect(snapshot().length).toBeGreaterThan(0);
    for (const row of snapshot()) {
      expect(row.name).not.toContain('rare.x');
    }
  });
});
