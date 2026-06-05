import { describe, expect, it } from 'vitest';
import { runGoT } from './got-runner.js';
import { createStubModel } from '../shared/stub-model.js';
import type { GoTOp } from './types.js';

describe('runGoT — Graph-of-Thoughts estate reasoning', () => {
  it('rejects an empty question', async () => {
    const model = createStubModel({ rules: [], defaultResponse: 'x' }).call;
    await expect(
      runGoT({ question: '   ', ops: [] }, model),
    ).rejects.toThrow(/question must not be empty/);
  });

  it('rejects ops that produce no nodes', async () => {
    const model = createStubModel({ rules: [], defaultResponse: 'x' }).call;
    await expect(
      runGoT({ question: 'Q', ops: [] }, model),
    ).rejects.toThrow(/no nodes were produced/);
  });

  it('detects cycles in the op DAG', async () => {
    const model = createStubModel({ rules: [], defaultResponse: 'x' }).call;
    const ops: ReadonlyArray<GoTOp> = [
      { kind: 'refine', id: 'A', from: 'B', prompt: 'refine' },
      { kind: 'refine', id: 'B', from: 'A', prompt: 'refine' },
    ];
    await expect(runGoT({ question: 'Q', ops }, model)).rejects.toThrow(/cycle detected/);
  });

  it('throws when an op references an unknown node', async () => {
    const model = createStubModel({ rules: [], defaultResponse: 'x' }).call;
    const ops: ReadonlyArray<GoTOp> = [
      { kind: 'merge', id: 'M', from: ['ghost'], prompt: 'merge' },
    ];
    await expect(runGoT({ question: 'Q', ops }, model)).rejects.toThrow(/unknown node "ghost"/);
  });

  it('Scenario 1 — 12-site refinance estate (cross-region merge + jurisdiction overlay)', async () => {
    // Each site branch generates finance, then we merge by region, then
    // merge regions, then overlay regulatory, then rank.
    const stub = createStubModel({
      rules: [
        { match: 'fetch-market-GEI', respond: '[score: 0.85] Geita Q2 rates 11.5%' },
        { match: 'fetch-market-MWZ', respond: '[score: 0.82] Mwanza Q2 rates 11.8%' },
        { match: 'fetch-market-SNG', respond: '[score: 0.80] Songea Q2 rates 12.1%' },
        { match: 'finance-GEI', respond: '[score: 0.90] GEI sites 1-5: refinance saves 1.2%' },
        { match: 'finance-MWZ', respond: '[score: 0.78] MWZ sites 6-9: marginal saving' },
        { match: 'finance-SNG', respond: '[score: 0.74] SNG sites 10-12: no saving' },
        { match: 'merge-regions', respond: '[score: 0.93] GEI > MWZ > SNG by saving' },
        { match: 'regulatory-overlay', respond: '[score: 0.95] BoT cap 14% — all eligible' },
        { match: 'final-ranking', respond: '[score: 0.97] Refinance GEI 1-5 first, then MWZ 6-9' },
      ],
    });

    const ops: ReadonlyArray<GoTOp> = [
      { kind: 'generate', id: 'mkt-GEI', prompt: 'fetch-market-GEI', labels: ['region:GEI'] },
      { kind: 'generate', id: 'mkt-MWZ', prompt: 'fetch-market-MWZ', labels: ['region:MWZ'] },
      { kind: 'generate', id: 'mkt-SNG', prompt: 'fetch-market-SNG', labels: ['region:SNG'] },
      { kind: 'refine', id: 'fin-GEI', from: 'mkt-GEI', prompt: 'finance-GEI' },
      { kind: 'refine', id: 'fin-MWZ', from: 'mkt-MWZ', prompt: 'finance-MWZ' },
      { kind: 'refine', id: 'fin-SNG', from: 'mkt-SNG', prompt: 'finance-SNG' },
      { kind: 'merge', id: 'regions', from: ['fin-GEI', 'fin-MWZ', 'fin-SNG'], prompt: 'merge-regions' },
      { kind: 'refine', id: 'overlay', from: 'regions', prompt: 'regulatory-overlay' },
    ];

    const result = await runGoT(
      {
        question: 'Across my 12 sites in Geita/Mwanza/Songea, which to refinance?',
        ops,
        finalReducer: { kind: 'refine', id: 'final', from: 'overlay', prompt: 'final-ranking' },
      },
      stub.call,
    );

    // DAG correctness — every fin- depends on its mkt-, regions depends on
    // all 3 fin, overlay on regions, final on overlay
    expect(result.evaluationOrder).toEqual([
      'mkt-GEI',
      'mkt-MWZ',
      'mkt-SNG',
      'fin-GEI',
      'fin-MWZ',
      'fin-SNG',
      'regions',
      'overlay',
    ]);
    expect(result.finalNodeId).toBe('final');
    expect(result.bestNodeId).toBe('final'); // 0.97 is highest

    // Cross-site merge carries labels of all parents
    const regions = result.graph.nodes.find((n) => n.id === 'regions');
    expect(regions?.labels.sort()).toEqual(['region:GEI', 'region:MWZ', 'region:SNG']);

    // 11 ops × 1 model call each
    expect(stub.callCount()).toBe(9);
  });

  it('Scenario 2 — multi-jurisdiction TZ/KE royalty dispute interlock', async () => {
    const stub = createStubModel({
      rules: [
        { match: 'tz-rules', respond: '[score: 0.9] TZ requires mediation' },
        { match: 'ke-rules', respond: '[score: 0.88] KE allows direct notice' },
        { match: 'interlock', respond: '[score: 0.94] cross-border counterparty — apply stricter (TZ)' },
      ],
    });
    const result = await runGoT(
      {
        question: 'Counterparty has sites in both TZ and KE. How to handle outstanding royalties?',
        ops: [
          { kind: 'generate', id: 'tz', prompt: 'tz-rules', labels: ['jurisdiction:TZ'] },
          { kind: 'generate', id: 'ke', prompt: 'ke-rules', labels: ['jurisdiction:KE'] },
          { kind: 'merge', id: 'inter', from: ['tz', 'ke'], prompt: 'interlock' },
        ],
      },
      stub.call,
    );
    expect(result.bestNodeId).toBe('inter');
    expect(result.graph.edges.filter((e) => e.kind === 'merges')).toHaveLength(2);
  });

  it('Scenario 3 — split a portfolio into per-tier sub-trees', async () => {
    // Order matters — first matching rule wins. We put the more-specific
    // `split-tiers` rule before the generic `roster` rule because the split
    // prompt also contains the parent's `roster` content as a JSON-encoded
    // substring.
    const stub = createStubModel({
      rules: [
        { match: 'split-tiers', respond: '[score: 0.7] tier-A details\n\ntier-B details\n\ntier-C details' },
        { match: 'roster', respond: '[score: 0.7] tier-A sites\n\ntier-B sites\n\ntier-C sites' },
      ],
    });
    const result = await runGoT(
      {
        question: 'Split portfolio by tier and analyse separately',
        ops: [
          { kind: 'generate', id: 'roster', prompt: 'roster' },
          {
            kind: 'split',
            fromId: 'roster',
            intoIds: ['tier-A', 'tier-B', 'tier-C'],
            prompt: 'split-tiers',
          },
        ],
      },
      stub.call,
    );

    // Verify split produced 3 child nodes with `data` edges from roster
    expect(result.graph.nodes.map((n) => n.id).sort()).toEqual(
      ['roster', 'tier-A', 'tier-B', 'tier-C'].sort(),
    );
    const dataEdges = result.graph.edges.filter((e) => e.kind === 'data');
    expect(dataEdges).toHaveLength(3);
    expect(dataEdges.every((e) => e.from === 'roster')).toBe(true);
  });

  it('Scenario 4 — refinement loop converges to higher quality', async () => {
    // Rules are ordered most-specific first so the v2 prompt (which includes
    // the parent's "critique" content as part of `Refine the following...`)
    // hits the `revise` rule and not the `critique` rule.
    const stub = createStubModel({
      rules: [
        { match: 'revise', respond: '[score: 0.9] final' },
        { match: 'critique', respond: '[score: 0.7] critique' },
        { match: 'draft', respond: '[score: 0.5] draft v1' },
      ],
    });
    const result = await runGoT(
      {
        question: 'Owner-briefing for Q2 portfolio',
        ops: [
          { kind: 'generate', id: 'v1', prompt: 'draft' },
          { kind: 'refine', id: 'critique', from: 'v1', prompt: 'critique' },
          { kind: 'refine', id: 'v2', from: 'critique', prompt: 'revise' },
        ],
      },
      stub.call,
    );
    expect(result.bestNodeId).toBe('v2');
    expect(
      result.graph.edges.filter((e) => e.kind === 'refines').length,
    ).toBe(2);
  });

  it('Scenario 5 — bestNodeId picks highest score with deterministic tie-break', async () => {
    const stub = createStubModel({
      rules: [
        { match: 'A', respond: '[score: 0.5] a' },
        { match: 'B', respond: '[score: 0.5] b' },
      ],
    });
    const result = await runGoT(
      {
        question: 'tie test',
        ops: [
          { kind: 'generate', id: 'beta', prompt: 'A' },
          { kind: 'generate', id: 'alpha', prompt: 'B' },
        ],
      },
      stub.call,
    );
    // Both score 0.5 — tie broken by id alpha < beta
    expect(result.bestNodeId).toBe('alpha');
  });
});
