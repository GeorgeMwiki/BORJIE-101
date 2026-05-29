/**
 * boundary-tagger tests — Chinese-wall guarantees.
 *
 * Pins the cross-tenant filter + numeric-synthesis guard described in
 * `Docs/RESEARCH/unified-personal-kb.md` §3.3 / §5 / §10.6.
 */

import { describe, expect, it } from 'vitest';
import {
  CrossTenantNumericSynthesisError,
  DEFAULT_K_ANONYMITY,
  assertNoCrossTenantNumeric,
  checkCrossTenantNumericSynthesis,
  extractCandidateNumbers,
  filterByActiveContext,
  kAnonymisedCount,
  type TaggedChunk,
} from '../boundary-tagger.js';

interface Chunk {
  readonly text: string;
}

const ACTIVE_TENANT = 'mine-a';
const FOREIGN_TENANT = 'mine-b';

const ctx = { tenantId: ACTIVE_TENANT, role: 'owner' } as const;

describe('filterByActiveContext', () => {
  it('keeps chunks whose tenant matches the active tenant', () => {
    const chunks: TaggedChunk<Chunk>[] = [
      { origin: { kind: 'tenant', tenantId: ACTIVE_TENANT }, chunk: { text: 'A' } },
      { origin: { kind: 'tenant', tenantId: FOREIGN_TENANT }, chunk: { text: 'B' } },
    ];
    const kept = filterByActiveContext(chunks, ctx);
    expect(kept.length).toBe(1);
    expect(kept[0]?.chunk.text).toBe('A');
  });

  it('always keeps person.public chunks', () => {
    const chunks: TaggedChunk<Chunk>[] = [
      { origin: { kind: 'person.public' }, chunk: { text: 'my language: sw' } },
    ];
    expect(filterByActiveContext(chunks, ctx).length).toBe(1);
  });

  it('keeps person.role chunks only when both tenant + role match', () => {
    const chunks: TaggedChunk<Chunk>[] = [
      { origin: { kind: 'person.role', tenantId: ACTIVE_TENANT, role: 'owner' }, chunk: { text: 'A-own' } },
      { origin: { kind: 'person.role', tenantId: ACTIVE_TENANT, role: 'manager' }, chunk: { text: 'A-mgr' } },
      { origin: { kind: 'person.role', tenantId: FOREIGN_TENANT, role: 'owner' }, chunk: { text: 'B-own' } },
    ];
    const kept = filterByActiveContext(chunks, ctx);
    expect(kept.length).toBe(1);
    expect(kept[0]?.chunk.text).toBe('A-own');
  });

  it('always keeps platform chunks (cross-tenant by design)', () => {
    const chunks: TaggedChunk<Chunk>[] = [
      { origin: { kind: 'platform' }, chunk: { text: 'gold global rate' } },
    ];
    expect(filterByActiveContext(chunks, ctx).length).toBe(1);
  });

  it('returns an empty array when no chunks match (immutable result)', () => {
    const chunks: TaggedChunk<Chunk>[] = [
      { origin: { kind: 'tenant', tenantId: FOREIGN_TENANT }, chunk: { text: 'foreign' } },
    ];
    expect(filterByActiveContext(chunks, ctx)).toEqual([]);
  });
});

describe('extractCandidateNumbers', () => {
  it('finds simple integers', () => {
    expect(extractCandidateNumbers('I have 42 mines')).toEqual(['42']);
  });

  it('finds decimals + thousands separators', () => {
    expect(extractCandidateNumbers('Sold 1,234 tonnes at TZS 2.5M')).toEqual(['1,234', '2.5']);
  });

  it('de-duplicates while preserving first-occurrence order', () => {
    expect(extractCandidateNumbers('5 here, 7 there, 5 again')).toEqual(['5', '7']);
  });

  it('returns empty array when no numbers are present', () => {
    expect(extractCandidateNumbers('all words no digits')).toEqual([]);
  });
});

describe('checkCrossTenantNumericSynthesis', () => {
  it('returns ok when there are no numbers in the candidate', () => {
    const result = checkCrossTenantNumericSynthesis(
      'You have 3 mines, all doing well.',
      [],
      ctx,
    );
    // 3 is in the text but no foreign chunks contribute → ok
    expect(result.ok).toBe(true);
  });

  it('returns ok when no foreign-tenant chunks exist', () => {
    const chunks: TaggedChunk<Chunk>[] = [
      { origin: { kind: 'tenant', tenantId: ACTIVE_TENANT }, chunk: { text: 'Production: 1,234 t' } },
    ];
    const result = checkCrossTenantNumericSynthesis('Output was 1,234 t today', chunks, ctx);
    expect(result.ok).toBe(true);
  });

  it('FAILS when a number from a FOREIGN tenant appears in the candidate', () => {
    const chunks: TaggedChunk<Chunk>[] = [
      // Mine A — current tenant, owns this number for its own reply.
      { origin: { kind: 'tenant', tenantId: ACTIVE_TENANT }, chunk: { text: 'My output is 500 t' } },
      // Mine B — foreign tenant, its output appears in the candidate.
      { origin: { kind: 'tenant', tenantId: FOREIGN_TENANT }, chunk: { text: 'Output 750 t' } },
    ];
    const result = checkCrossTenantNumericSynthesis(
      "Mine A produced 500 t and Mine B produced 750 t — you're ahead.",
      chunks,
      ctx,
    );
    expect(result.ok).toBe(false);
    expect(result.violations.length).toBe(1);
    expect(result.violations[0]?.number).toBe('750');
    expect(result.violations[0]?.foreignTenantId).toBe(FOREIGN_TENANT);
  });

  it('allows existence-claims about cross-tenant data when numbers do not leak', () => {
    const chunks: TaggedChunk<Chunk>[] = [
      { origin: { kind: 'tenant', tenantId: FOREIGN_TENANT }, chunk: { text: 'Secret: 999' } },
    ];
    const result = checkCrossTenantNumericSynthesis(
      "You operate at multiple sites; switch to each tenant's view for specifics.",
      chunks,
      ctx,
    );
    expect(result.ok).toBe(true);
  });
});

describe('assertNoCrossTenantNumeric', () => {
  it('throws when the check fails', () => {
    const chunks: TaggedChunk<Chunk>[] = [
      { origin: { kind: 'tenant', tenantId: FOREIGN_TENANT }, chunk: { text: 'foreign 750' } },
    ];
    expect(() =>
      assertNoCrossTenantNumeric('leaked 750', chunks, ctx),
    ).toThrow(CrossTenantNumericSynthesisError);
  });

  it('returns silently when the check passes', () => {
    expect(() => assertNoCrossTenantNumeric('all good', [], ctx)).not.toThrow();
  });
});

describe('kAnonymisedCount', () => {
  it('returns the raw count when above the threshold', () => {
    const result = kAnonymisedCount(5);
    expect(result.ok).toBe(true);
    expect(result.count).toBe(5);
    expect(result.suppressed).toBe(false);
  });

  it('suppresses the count when below the threshold', () => {
    const result = kAnonymisedCount(2);
    expect(result.ok).toBe(true);
    expect(result.count).toBeNull();
    expect(result.suppressed).toBe(true);
  });

  it('the default threshold matches the research-doc constant (k = 3)', () => {
    expect(DEFAULT_K_ANONYMITY).toBe(3);
    expect(kAnonymisedCount(3).count).toBe(3);
    expect(kAnonymisedCount(2).suppressed).toBe(true);
  });

  it('rejects negative + non-finite counts', () => {
    expect(kAnonymisedCount(-1).ok).toBe(false);
    expect(kAnonymisedCount(Number.NaN).ok).toBe(false);
  });

  it('respects a custom threshold', () => {
    expect(kAnonymisedCount(4, 5).suppressed).toBe(true);
    expect(kAnonymisedCount(5, 5).count).toBe(5);
  });
});
