/**
 * DAG builder — LLM-proposed DAG parse + refutation gate.
 *
 * `passesRefutation` is the keep/drop gate; `buildCausalDag` wires the
 * injected LLM (DAG proposer) + sidecar (refuter) and returns the verdict.
 */
import { describe, it, expect } from 'vitest';
import { buildCausalDag, passesRefutation } from '../causal-fusion/dag-builder.js';
import type {
  HypothesisSeed,
  LLMClient,
  SidecarClient,
  SidecarRefuteResponse,
} from '../types.js';

const SEED: HypothesisSeed = {
  id: 'pricing-99',
  area: 'pricing',
  statement: 'Higher royalty rate increases offtake delay.',
  variables: ['royalty_rate', 'offtake_delay_days', 'season'],
  suggestedTreatmentVar: 'royalty_rate',
  suggestedOutcomeVar: 'offtake_delay_days',
  suggestedConfounders: ['season'],
  suggestedEstimator: 'dowhy_linear',
  owningPerspective: 'owner',
  tags: [],
};

function llmReturning(text: string): LLMClient {
  return { complete: async () => ({ text }) };
}

function sidecarWith(scores: SidecarRefuteResponse['scores']): SidecarClient {
  return {
    refute: async () => ({ scores, diagnostics: 'stub diagnostics' }),
    pcmciplus: async () => {
      throw new Error('not used');
    },
    health: async () => ({ ok: true, version: 'test' }),
  };
}

const VALID_DAG_JSON = JSON.stringify({
  nodes: ['royalty_rate', 'offtake_delay_days', 'season'],
  edges: [
    { from: 'royalty_rate', to: 'offtake_delay_days' },
    { from: 'season', to: 'offtake_delay_days' },
  ],
  candidateEdges: [],
});

describe('passesRefutation', () => {
  it('keeps when all required scores meet the threshold', () => {
    expect(
      passesRefutation(
        { placebo: 0.6, bootstrap: 0.6, unobservedConfounder: 0.6 },
        0.5,
      ),
    ).toBe(true);
  });

  it('drops when any required score is below the threshold', () => {
    expect(
      passesRefutation(
        { placebo: 0.9, bootstrap: 0.1, unobservedConfounder: 0.9 },
        0.5,
      ),
    ).toBe(false);
  });

  it('includes the optional conditional-independence score when present', () => {
    expect(
      passesRefutation(
        {
          placebo: 0.9,
          bootstrap: 0.9,
          unobservedConfounder: 0.9,
          conditionalIndependence: 0.2,
        },
        0.5,
      ),
    ).toBe(false);
  });
});

describe('buildCausalDag', () => {
  it('parses fenced LLM JSON and keeps a strong DAG', async () => {
    const fusion = await buildCausalDag({
      seed: SEED,
      dataRef: 'rows://[]',
      llm: llmReturning('```json\n' + VALID_DAG_JSON + '\n```'),
      sidecar: sidecarWith({ placebo: 0.8, bootstrap: 0.8, unobservedConfounder: 0.7 }),
    });
    expect(fusion.kept).toBe(true);
    expect(fusion.dag.nodes).toContain('royalty_rate');
    expect(fusion.rationale).toContain('KEPT');
  });

  it('drops a DAG that fails refutation', async () => {
    const fusion = await buildCausalDag({
      seed: SEED,
      dataRef: 'rows://[]',
      llm: llmReturning(VALID_DAG_JSON),
      sidecar: sidecarWith({ placebo: 0.2, bootstrap: 0.8, unobservedConfounder: 0.7 }),
    });
    expect(fusion.kept).toBe(false);
    expect(fusion.rationale).toContain('DROPPED');
  });

  it('throws when the LLM returns non-JSON', async () => {
    await expect(
      buildCausalDag({
        seed: SEED,
        dataRef: 'rows://[]',
        llm: llmReturning('I cannot help with that.'),
        sidecar: sidecarWith({ placebo: 0.8, bootstrap: 0.8, unobservedConfounder: 0.8 }),
      }),
    ).rejects.toThrow(/non-JSON|schema-invalid/);
  });
});
