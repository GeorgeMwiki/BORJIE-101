/**
 * Persona test — the Harvard-PhD persona must carry the hallmark
 * anchors every report grounds against. Asserts on the literal
 * prefix + on the evidence-norms invariants so the persona cannot
 * drift to marketing speak or away from cite-or-mark.
 */

import { describe, it, expect } from 'vitest';
import {
  buildHarvardPhdPersona,
  DISCIPLINE_PREFIX_LITERAL,
  EVIDENCE_NORMS_PARAGRAPH,
} from '../personas/harvard-phd-persona.js';

describe('Harvard-PhD persona — credential anchors', () => {
  it('discipline prefix names Harvard, MBA, JD, PhD, RICS', () => {
    expect(DISCIPLINE_PREFIX_LITERAL).toContain('Harvard');
    expect(DISCIPLINE_PREFIX_LITERAL).toContain('MBA');
    expect(DISCIPLINE_PREFIX_LITERAL).toContain('JD');
    expect(DISCIPLINE_PREFIX_LITERAL).toContain('PhD');
    expect(DISCIPLINE_PREFIX_LITERAL).toContain('RICS');
  });
});

describe('Harvard-PhD persona — evidence-norms hallmarks', () => {
  it('cite-or-mark rule appears in the evidence-norms paragraph', () => {
    // The persona file pins: "Every quantitative claim, monetary amount,
    // percentage, date, and statute reference MUST carry an inline citation"
    expect(EVIDENCE_NORMS_PARAGRAPH).toMatch(/Every quantitative claim/);
    expect(EVIDENCE_NORMS_PARAGRAPH).toMatch(/MUST carry an inline citation/);
    expect(EVIDENCE_NORMS_PARAGRAPH).toMatch(/estimate=true/);
  });

  it('do-not-invent + closed-universe-of-facts hallmarks present', () => {
    expect(EVIDENCE_NORMS_PARAGRAPH).toMatch(/Do not invent figures/);
    expect(EVIDENCE_NORMS_PARAGRAPH).toMatch(/closed universe of facts/);
  });
});

describe('Harvard-PhD persona — full prompt build', () => {
  it('produces three blank-line separated paragraphs', () => {
    const prompt = buildHarvardPhdPersona({
      type: 'leasing_financial_performance',
      audience: 'board',
      jurisdiction: 'TZ',
    });
    const paragraphs = prompt.split(/\n\n/);
    expect(paragraphs.length).toBe(3);
  });

  it('includes the discipline prefix in the first paragraph', () => {
    const prompt = buildHarvardPhdPersona({
      type: 'acquisition_deal_ic_memo',
      audience: 'board',
      jurisdiction: 'TZ',
    });
    expect(prompt).toContain(DISCIPLINE_PREFIX_LITERAL);
  });

  it('threads report-type framing into the discipline paragraph', () => {
    const ic = buildHarvardPhdPersona({
      type: 'acquisition_deal_ic_memo',
      audience: 'board',
      jurisdiction: 'TZ',
    });
    const sus = buildHarvardPhdPersona({
      type: 'sustainability_ghg_report',
      audience: 'board',
      jurisdiction: 'TZ',
    });
    expect(ic).toContain('Investment Committee Acquisition Memo');
    expect(sus).toContain('IFRS S2');
    expect(ic).not.toEqual(sus);
  });

  it('audience modulation surfaces — board vs owner differ', () => {
    const owner = buildHarvardPhdPersona({
      type: 'leasing_financial_performance',
      audience: 'owner',
      jurisdiction: 'TZ',
    });
    const board = buildHarvardPhdPersona({
      type: 'leasing_financial_performance',
      audience: 'board',
      jurisdiction: 'TZ',
    });
    expect(owner).toContain('property owner');
    expect(board).toContain('Board of Directors');
    expect(owner).not.toEqual(board);
  });

  it('jurisdiction frame surfaces — TZ vs KE differ', () => {
    const tz = buildHarvardPhdPersona({
      type: 'leasing_financial_performance',
      audience: 'board',
      jurisdiction: 'TZ',
    });
    const ke = buildHarvardPhdPersona({
      type: 'leasing_financial_performance',
      audience: 'board',
      jurisdiction: 'KE',
    });
    expect(tz).toContain('Tanzanian law');
    expect(ke).toContain('Kenyan law');
  });

  it('refuses marketing language explicitly', () => {
    const prompt = buildHarvardPhdPersona({
      type: 'leasing_financial_performance',
      audience: 'board',
      jurisdiction: 'TZ',
    });
    // Tone paragraph bans these specific words.
    expect(prompt).toMatch(/Refuse marketing language/);
    expect(prompt).toContain('exciting');
    expect(prompt).toContain('transformative');
    expect(prompt).toContain('leverage');
  });

  it('action-oriented: every section closes with a Verdict line', () => {
    const prompt = buildHarvardPhdPersona({
      type: 'rent_roll_arrears_ledger',
      audience: 'internal',
      jurisdiction: 'UG',
    });
    expect(prompt).toMatch(/Verdict:/);
  });
});
