import { describe, it, expect } from 'vitest';
import {
  createProbeRunner,
  createInMemoryProbeFeatureRepository,
  createInMemoryAuditChain,
  getPlaceholderDictionary,
} from '../index.js';
import type { ProbeContext } from '../types.js';

const fixedNow = (): Date => new Date('2026-05-26T10:00:00Z');
const ctx: ProbeContext = {
  tenant_id: 't1',
  session_id: 'sess-1',
  turn_id: 'turn-1',
  now: fixedNow,
};

describe('createProbeRunner', () => {
  it('persists every detected firing and stamps audit hashes', async () => {
    const repo = createInMemoryProbeFeatureRepository();
    const audit = createInMemoryAuditChain();
    const run = createProbeRunner({ repo, audit });

    const dict = getPlaceholderDictionary();
    // Push first axis high → drives the first category (deception).
    const activation = dict.map(() => 0);
    activation[0] = 2;

    const firings = await run(ctx, {
      activation,
      dictionary: dict,
    });
    expect(firings).toHaveLength(1);
    expect(firings[0]?.category).toBe('deception');
    expect(firings[0]?.audit_hash).toMatch(/^sae-chain-/);
    expect(audit.history().length).toBe(1);

    const inWindow = await repo.findFirings(
      't1',
      'sf-deception-v0',
      '2026-05-26T00:00:00Z',
      '2026-05-27T00:00:00Z',
    );
    expect(inWindow).toHaveLength(1);
  });

  it('persists nothing when no feature fires', async () => {
    const repo = createInMemoryProbeFeatureRepository();
    const audit = createInMemoryAuditChain();
    const run = createProbeRunner({ repo, audit });

    const dict = getPlaceholderDictionary();
    const activation = dict.map(() => 0);

    const firings = await run(ctx, {
      activation,
      dictionary: dict,
    });
    expect(firings).toHaveLength(0);
    expect(audit.history().length).toBe(0);
  });

  it('propagates tenant override into the persisted threshold', async () => {
    const repo = createInMemoryProbeFeatureRepository();
    const audit = createInMemoryAuditChain();
    const run = createProbeRunner({ repo, audit });

    const dict = getPlaceholderDictionary();
    const activation = dict.map(() => 0);
    // Half the baseline (1) → would not fire normally.
    activation[1] = 0.5;

    const firings = await run(ctx, {
      activation,
      dictionary: dict,
      overrides: [
        {
          feature_id: 'sf-hallucination-v0',
          tenant_id: 't1',
          threshold: 0.3,
        },
      ],
    });
    expect(firings).toHaveLength(1);
    expect(firings[0]?.category).toBe('hallucination');
    expect(firings[0]?.threshold_at_time).toBe(0.3);
  });
});
