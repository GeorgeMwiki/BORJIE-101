/**
 * Composer tests — verify each blueprint maps a gatherer's output to
 * a structured-output LLM request shape, and that the structured-
 * output parser turns the brain's response back into ReportSection[].
 */

import { describe, it, expect } from 'vitest';
import {
  buildUserPrompt,
  parseSections,
  buildCitations,
  BLUEPRINT_FOR,
  composerFor,
} from '../composers/index.js';
import { REPORT_TYPES, type EvidencePack } from '../types.js';
import {
  buildSpec,
  createFakeBrain,
  fixtureAdvisorPorts,
} from './fixtures.js';
import { gathererFor } from '../gatherers/index.js';
import { buildHarvardPhdPersona } from '../personas/harvard-phd-persona.js';

describe('composer blueprints — every type carries the required structure', () => {
  for (const type of REPORT_TYPES) {
    it(`BLUEPRINT_FOR.${type} declares ≥1 section blueprint and ≥5 action items`, () => {
      const bp = BLUEPRINT_FOR[type];
      expect(bp.sectionBlueprints.length).toBeGreaterThanOrEqual(1);
      const ctx = {
        evidence: emptyEvidence(type),
        persona: 'p',
        spec: buildSpec(type),
      };
      expect(bp.executiveSummary(ctx).length).toBeGreaterThan(0);
      expect(bp.actionPlan(ctx).length).toBeGreaterThanOrEqual(5);
      // Each blueprint section declares at least one fragment prefix.
      for (const s of bp.sectionBlueprints) {
        expect(s.fragmentPrefixes.length).toBeGreaterThanOrEqual(1);
      }
    });
  }
});

describe('buildUserPrompt — structured-output LLM request shape', () => {
  it('emits a citation key + a required-sections block', async () => {
    const spec = buildSpec('leasing_financial_performance');
    const evidence = await gathererFor(spec.type, fixtureAdvisorPorts)({ spec, now: () => new Date('2026-05-24T00:00:00Z') });
    const userPrompt = buildUserPrompt(evidence, BLUEPRINT_FOR[spec.type]);
    expect(userPrompt).toContain('# Caller request');
    expect(userPrompt).toContain('# Citation key');
    expect(userPrompt).toContain('# Required sections');
    expect(userPrompt).toContain('# Output format');
    expect(userPrompt).toContain('id=trend-headline');
  });

  it('falls back to a placeholder when caller-supplied prompt is missing', async () => {
    const spec = buildSpec('leasing_financial_performance', { prompt: undefined });
    const evidence = await gathererFor(spec.type, fixtureAdvisorPorts)({ spec, now: () => new Date() });
    const userPrompt = buildUserPrompt(evidence, BLUEPRINT_FOR[spec.type]);
    expect(userPrompt).toContain('(no caller-supplied prompt)');
  });
});

describe('parseSections — structured output parser', () => {
  it('extracts every section the brain emits', async () => {
    const spec = buildSpec('leasing_financial_performance');
    const evidence = await gathererFor(spec.type, fixtureAdvisorPorts)({ spec, now: () => new Date() });
    const bp = BLUEPRINT_FOR[spec.type];
    const brainContent = bp.sectionBlueprints
      .map((s) => `### section-id:${s.id}\n#### Heading\nNarrative body. Verdict: ok.`)
      .join('\n\n');
    const parsed = parseSections(brainContent, bp, evidence);
    expect(parsed.length).toBe(bp.sectionBlueprints.length);
    for (let i = 0; i < parsed.length; i++) {
      expect(parsed[i]!.id).toBe(bp.sectionBlueprints[i]!.id);
      expect(parsed[i]!.body.length).toBeGreaterThan(0);
    }
  });

  it('marks unmatched sections as evidenceUnavailable rather than dropping them', async () => {
    const spec = buildSpec('leasing_financial_performance');
    const evidence = await gathererFor(spec.type, fixtureAdvisorPorts)({ spec, now: () => new Date() });
    const bp = BLUEPRINT_FOR[spec.type];
    // Brain emits ONE section only.
    const brainContent = `### section-id:trend-headline\nbody\nVerdict: ok.`;
    const parsed = parseSections(brainContent, bp, evidence);
    expect(parsed.length).toBe(bp.sectionBlueprints.length);
    const headline = parsed.find((s) => s.id === 'trend-headline');
    expect(headline!.evidenceUnavailable).toBeUndefined();
    const other = parsed.find((s) => s.id !== 'trend-headline');
    expect(other!.evidenceUnavailable).toBe(true);
  });
});

describe('buildCitations — every fragment becomes a Citation', () => {
  it('returns one citation per fragment', async () => {
    const spec = buildSpec('leasing_financial_performance');
    const evidence = await gathererFor(spec.type, fixtureAdvisorPorts)({ spec, now: () => new Date() });
    const citations = buildCitations(evidence);
    expect(citations.length).toBe(evidence.fragments.length);
    for (let i = 0; i < citations.length; i++) {
      expect(citations[i]!.id).toBe(evidence.fragments[i]!.id);
      expect(citations[i]!.source).toEqual(evidence.fragments[i]!.source);
    }
  });
});

describe('composerFor — end-to-end composer behaves per the blueprint', () => {
  it('produces a StrategicReport with the right title + executive summary', async () => {
    const spec = buildSpec('refinancing_strategy_memo');
    const evidence = await gathererFor(spec.type, fixtureAdvisorPorts)({ spec, now: () => new Date() });
    const persona = buildHarvardPhdPersona({ type: spec.type, audience: spec.audience, jurisdiction: spec.jurisdiction });
    const compose = composerFor(createFakeBrain());
    const report = await compose({ evidence, persona, spec });
    const bp = BLUEPRINT_FOR[spec.type];
    expect(report.title).toBe(bp.title({ evidence, persona, spec }));
    expect(report.executiveSummary).toBe(bp.executiveSummary({ evidence, persona, spec }));
    expect(report.actionPlan.length).toBeGreaterThanOrEqual(5);
    expect(report.synthesis.synthesizerId).toMatch(/fake-synthesizer/);
  });
});

function emptyEvidence(type: import('../types.js').ReportType): EvidencePack {
  const spec = buildSpec(type);
  return {
    type,
    spec,
    fragments: [],
    charts: [],
    tables: [],
    sourceHealth: [],
  };
}
