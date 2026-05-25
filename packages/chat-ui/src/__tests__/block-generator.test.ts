import { describe, expect, it } from 'vitest';
import { generateBlocks, promoteInsightToConcept } from '../generative-ui/block-generator';

describe('generateBlocks', () => {
  it('produces a rent-affordability calculator when text mentions rent affordability', () => {
    const blocks = generateBlocks({
      responseText: 'Let us compute rent affordability for this tenant.',
      toolCalls: [],
    });
    expect(blocks.some((b) => b.type === 'rent_affordability_calculator')).toBe(true);
  });

  it('produces an arrears projection when text mentions arrears', () => {
    const blocks = generateBlocks({
      responseText: 'The tenant is in arrears for three months.',
      toolCalls: [],
    });
    expect(blocks.some((b) => b.type === 'arrears_projection_chart')).toBe(true);
  });

  it('produces a 5 Ps wheel when text mentions tenancy risk', () => {
    const blocks = generateBlocks({
      responseText: "Here's the tenancy risk breakdown using the 5 Ps.",
      toolCalls: [],
    });
    expect(blocks.some((b) => b.type === 'five_ps_tenancy_risk_wheel')).toBe(true);
  });

  it('produces a lease timeline on the lease lifecycle keyword', () => {
    const blocks = generateBlocks({
      responseText: 'Consider the lease lifecycle from signing through lease end.',
      toolCalls: [],
    });
    expect(blocks.some((b) => b.type === 'lease_timeline_diagram')).toBe(true);
  });

  it('produces a maintenance flow on the work-order keyword', () => {
    const blocks = generateBlocks({
      responseText: 'The work order moved through triage and was assigned.',
      toolCalls: [],
    });
    expect(blocks.some((b) => b.type === 'maintenance_case_flow_diagram')).toBe(true);
  });

  it('produces a property comparison when the response compares properties', () => {
    const blocks = generateBlocks({
      responseText: 'Let us do a property comparison between these two flats.',
      toolCalls: [],
    });
    expect(blocks.some((b) => b.type === 'property_comparison_table')).toBe(true);
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
      'Deposits protect the landlord against damage. They are refundable. Up to two months is typical.',
    );
    expect(block.type).toBe('concept_card');
    expect(block.keyPoints.length).toBeGreaterThan(1);
  });
});
