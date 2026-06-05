import { describe, expect, it } from 'vitest';
import { generateBlocks, promoteInsightToConcept } from '../generative-ui/block-generator';

describe('generateBlocks', () => {
  it('produces a royalty-affordability calculator when text mentions royalty affordability', () => {
    const blocks = generateBlocks({
      responseText: 'Let us compute royalty affordability for this operator.',
      toolCalls: [],
    });
    expect(blocks.some((b) => b.type === 'royalty_affordability_calculator')).toBe(true);
  });

  it('produces an outstanding-royalty projection when text mentions outstanding royalties', () => {
    const blocks = generateBlocks({
      responseText: 'The operator has outstanding royalties for three months.',
      toolCalls: [],
    });
    expect(blocks.some((b) => b.type === 'outstanding_royalty_projection_chart')).toBe(true);
  });

  it('produces a 5 Ps wheel when text mentions operator risk', () => {
    const blocks = generateBlocks({
      responseText: "Here's the operator risk breakdown using the 5 Ps.",
      toolCalls: [],
    });
    expect(blocks.some((b) => b.type === 'five_ps_operator_risk_wheel')).toBe(true);
  });

  it('produces an offtake timeline on the offtake lifecycle keyword', () => {
    const blocks = generateBlocks({
      responseText: 'Consider the offtake lifecycle from signing through offtake end.',
      toolCalls: [],
    });
    expect(blocks.some((b) => b.type === 'offtake_timeline_diagram')).toBe(true);
  });

  it('produces a maintenance flow on the work-order keyword', () => {
    const blocks = generateBlocks({
      responseText: 'The work order moved through triage and was assigned.',
      toolCalls: [],
    });
    expect(blocks.some((b) => b.type === 'maintenance_case_flow_diagram')).toBe(true);
  });

  it('produces an asset comparison when the response compares assets', () => {
    const blocks = generateBlocks({
      responseText: 'Let us do an asset comparison between these two sites.',
      toolCalls: [],
    });
    expect(blocks.some((b) => b.type === 'asset_comparison_table')).toBe(true);
  });

  it('produces no blocks on neutral text', () => {
    const blocks = generateBlocks({
      responseText: 'The weather in Nairobi is pleasant today.',
      toolCalls: [],
    });
    expect(blocks.length).toBe(0);
  });
});

describe('promoteInsightToConcept', () => {
  it('extracts short sentences as key points', () => {
    const block = promoteInsightToConcept(
      'Security deposits',
      'Deposits protect the owner against damage. They are refundable. Up to two months is typical.',
    );
    expect(block.type).toBe('concept_card');
    expect(block.keyPoints.length).toBeGreaterThan(1);
  });
});
