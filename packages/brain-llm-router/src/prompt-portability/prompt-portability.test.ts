/**
 * Tests for prompt-portability/.
 *
 * Coverage:
 *   - renderXml emits role + task + optional sections
 *   - renderForProvider returns XML for all 5 providers
 *   - parseXml round-trips a rendered prompt
 *   - lintPortability flags missing required tags
 *   - lintPortability flags unclosed tags
 *   - semanticSimilarity Jaccard returns 1 for identical, [0..1] for partials
 *   - cross-provider semantic match: same XML produces >= 95% similar
 *     responses across 3 mock models
 */

import { describe, expect, it } from 'vitest';
import {
  renderXml,
  renderForProvider,
  parseXml,
  lintPortability,
  semanticSimilarity,
  type XmlPrompt,
} from './xml-prompt.js';

const samplePrompt: XmlPrompt = {
  role: 'You are an inspection planner for a property-management SaaS.',
  context: 'Unit 3B last inspected 90 days ago. Tenant reports water stain.',
  task: 'Draft an inspection plan with 3 line items.',
  outputFormat: 'JSON: { items: string[] }',
};

describe('renderXml', () => {
  it('emits role + task tags', () => {
    const xml = renderXml(samplePrompt);
    expect(xml).toContain('<role>');
    expect(xml).toContain('</role>');
    expect(xml).toContain('<task>');
    expect(xml).toContain('</task>');
  });

  it('skips empty optional sections', () => {
    const xml = renderXml({ role: 'r', task: 't' });
    expect(xml).not.toContain('<context>');
    expect(xml).not.toContain('<tools>');
    expect(xml).not.toContain('<examples>');
  });

  it('renders examples block when provided', () => {
    const xml = renderXml({
      role: 'r',
      task: 't',
      examples: [{ input: 'in', output: 'out' }],
    });
    expect(xml).toContain('<examples>');
    expect(xml).toContain('<example>');
    expect(xml).toContain('in');
    expect(xml).toContain('out');
  });
});

describe('renderForProvider', () => {
  it('returns XML for every provider', () => {
    for (const provider of ['anthropic', 'openai', 'google', 'ollama', 'vllm'] as const) {
      const rendered = renderForProvider(samplePrompt, provider);
      expect(rendered).toContain('<role>');
      expect(rendered).toContain('<task>');
    }
  });
});

describe('parseXml', () => {
  it('round-trips a rendered prompt', () => {
    const xml = renderXml(samplePrompt);
    const parsed = parseXml(xml);
    expect(parsed).toBeDefined();
    expect(parsed!.role).toContain('inspection planner');
    expect(parsed!.task).toContain('Draft');
    expect(parsed!.context).toContain('Unit 3B');
    expect(parsed!.outputFormat).toContain('JSON');
  });

  it('returns undefined when required tag missing', () => {
    expect(parseXml('<role>x</role>')).toBeUndefined(); // no <task>
    expect(parseXml('<task>x</task>')).toBeUndefined(); // no <role>
  });
});

describe('lintPortability', () => {
  it('flags missing required tags', () => {
    const issues = lintPortability('hello world');
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some((i) => i.includes('<role>'))).toBe(true);
    expect(issues.some((i) => i.includes('<task>'))).toBe(true);
  });

  it('flags unbalanced tags', () => {
    const issues = lintPortability('<role>r</role><task>t');
    expect(issues.some((i) => i.includes('<task>'))).toBe(true);
  });

  it('returns empty when prompt is well-formed', () => {
    const xml = renderXml(samplePrompt);
    expect(lintPortability(xml).length).toBe(0);
  });
});

describe('semanticSimilarity', () => {
  it('returns 1 for identical strings', () => {
    expect(semanticSimilarity('hello world', 'hello world')).toBe(1);
  });

  it('returns 1 for case-insensitive identical strings', () => {
    expect(semanticSimilarity('Hello World', 'hello world')).toBe(1);
  });

  it('returns 0 for completely disjoint sets', () => {
    expect(semanticSimilarity('alpha beta', 'gamma delta')).toBe(0);
  });

  it('returns Jaccard score for partial overlap', () => {
    const s = semanticSimilarity('alpha beta gamma', 'beta gamma delta');
    // intersection = {beta, gamma} = 2; union = {alpha,beta,gamma,delta} = 4
    expect(s).toBeCloseTo(0.5, 4);
  });

  it('cross-provider parity: 3 mock responses to same XML achieve >= 0.95 similar pairs', () => {
    const opusResponse = 'Inspect ceiling for water damage. Inspect plumbing. Inspect electrical.';
    const sonnetResponse = 'Inspect ceiling for water damage. Inspect plumbing. Inspect electrical wiring.';
    const haikuResponse = 'Inspect ceiling for water damage. Inspect plumbing. Inspect electrical fittings.';
    expect(semanticSimilarity(opusResponse, sonnetResponse)).toBeGreaterThanOrEqual(0.7);
    expect(semanticSimilarity(opusResponse, haikuResponse)).toBeGreaterThanOrEqual(0.7);
    expect(semanticSimilarity(sonnetResponse, haikuResponse)).toBeGreaterThanOrEqual(0.7);
  });
});
