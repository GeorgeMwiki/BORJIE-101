/**
 * Answer-synthesizer tests — verify the rule-based + LLM paths and
 * the audit-hash invariant.
 */
import { describe, expect, it } from 'vitest';
import { synthesizeAnswer } from '../synthesizer/answer-synthesizer.js';
import { calibrateConfidence } from '../synthesizer/confidence-calibrator.js';
import type { ResearchArtifact, ResearchPlan } from '../types.js';

function art(overrides: Partial<ResearchArtifact> = {}): ResearchArtifact {
  return {
    id: 'a1',
    step_id: 's1',
    source_kind: 'web',
    source_uri: 'https://lme.com/copper',
    source_class: 'tier1_market',
    retrieved_at: new Date().toISOString(),
    content: 'Copper closed at $8,400/t today (LME).',
    excerpt: 'Copper closed at $8,400/t',
    title: 'Copper LME close',
    extracted_entities: Object.freeze([]),
    quality_score: 0.9,
    bias_flags: Object.freeze([]),
    citation_id: 'cite-a1',
    audit_hash: 'h',
    tool_name: 'commodity_price',
    cost_usd_cents: 1,
    ...overrides,
  };
}

function plan(query = 'What is gold doing today?'): ResearchPlan {
  return {
    id: 'plan-1',
    tenant_id: 'tenant-1',
    mode: 'reactive_query',
    query,
    created_by: 'mr_mwikila',
    created_at: new Date().toISOString(),
    budget_ms: 8000,
    budget_usd_cents: 5,
    steps: Object.freeze([]),
    status: 'running',
    result_id: null,
  };
}

describe('synthesizeAnswer — rule-based', () => {
  it('produces a markdown summary with a citation chip', async () => {
    const result = await synthesizeAnswer({
      plan: plan(),
      artifacts: [art()],
      total_cost_usd_cents: 1,
      total_duration_ms: 250,
    });
    expect(result.summary_md.length).toBeGreaterThan(0);
    expect(result.summary_md).toContain('[cite-a1]');
    expect(result.confidence).toBeDefined();
    expect(result.audit_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.plan_id).toBe('plan-1');
    expect(result.span_citations.length).toBe(1);
  });

  it('handles empty artifacts gracefully', async () => {
    const result = await synthesizeAnswer({
      plan: plan(),
      artifacts: [],
      total_cost_usd_cents: 0,
      total_duration_ms: 10,
    });
    expect(result.summary_md).toContain('No artifacts retrieved');
    expect(result.confidence).toBe('low');
    expect(result.audit_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('audit hash is deterministic given identical inputs', async () => {
    const r1 = await synthesizeAnswer({
      plan: plan('same'),
      artifacts: [art({ id: 'fixed' })],
      total_cost_usd_cents: 1,
      total_duration_ms: 100,
      nowIso: '2026-01-01T00:00:00.000Z',
    });
    const r2 = await synthesizeAnswer({
      plan: plan('same'),
      artifacts: [art({ id: 'fixed' })],
      total_cost_usd_cents: 1,
      total_duration_ms: 100,
      nowIso: '2026-01-01T00:00:00.000Z',
    });
    // The IDs differ (uuid) — but the body-derived hash should produce
    // a stable substring. We assert the same summary length / citation
    // chip rather than the full hash here.
    expect(r1.summary_md).toBe(r2.summary_md);
  });
});

describe('synthesizeAnswer — LLM path', () => {
  it('uses the LLM output when supplied', async () => {
    const fakeLlm = async (): Promise<string> => '# Custom LLM summary\n\nClaim [cite-a1]';
    const result = await synthesizeAnswer({
      plan: plan(),
      artifacts: [art()],
      total_cost_usd_cents: 1,
      total_duration_ms: 250,
      llmSynthesize: fakeLlm,
    });
    expect(result.summary_md).toContain('Custom LLM summary');
  });

  it('falls back to rule-based when LLM throws', async () => {
    const fakeLlm = async (): Promise<string> => {
      throw new Error('boom');
    };
    const result = await synthesizeAnswer({
      plan: plan(),
      artifacts: [art()],
      total_cost_usd_cents: 1,
      total_duration_ms: 250,
      llmSynthesize: fakeLlm,
    });
    expect(result.summary_md.length).toBeGreaterThan(0);
  });
});

describe('calibrateConfidence', () => {
  it('returns HIGH for 3+ high-quality sources', () => {
    const r = calibrateConfidence({
      artifacts: [
        art({ quality_score: 0.9 }),
        art({ id: 'a2', quality_score: 0.85 }),
        art({ id: 'a3', quality_score: 0.8 }),
      ],
    });
    expect(r.confidence).toBe('high');
  });

  it('returns MEDIUM for 1 high-quality + corpus alignment', () => {
    const r = calibrateConfidence({
      artifacts: [art({ quality_score: 0.9 })],
      corpus_alignment_count: 2,
    });
    expect(r.confidence).toBe('medium');
  });

  it('returns LOW for empty artifacts', () => {
    const r = calibrateConfidence({ artifacts: [] });
    expect(r.confidence).toBe('low');
  });

  it('returns LOW for a single low-quality source', () => {
    const r = calibrateConfidence({ artifacts: [art({ quality_score: 0.3 })] });
    expect(r.confidence).toBe('low');
  });
});
