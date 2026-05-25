import { describe, expect, it } from 'vitest';
import {
  PRE_SHIPPED_PRINCIPLES,
  findPrinciple,
  principlesFor,
} from '../principles-registry/index.js';

describe('principles-registry', () => {
  it('ships exactly 12 principles', () => {
    expect(PRE_SHIPPED_PRINCIPLES.length).toBe(12);
  });

  it('covers Asilomar, NIST RMF, IEEE P7000, EU AI Act, GDPR, Anthropic, Microsoft, Google PAIR', () => {
    const sources = PRE_SHIPPED_PRINCIPLES.map((p) => p.source).join(' ');
    expect(sources).toContain('Asilomar');
    expect(sources).toContain('NIST AI RMF');
    expect(sources).toContain('IEEE Std 7000');
    expect(sources).toContain('EU AI Act');
    expect(sources).toContain('GDPR');
    expect(sources).toContain('Anthropic Responsible Scaling Policy');
    expect(sources).toContain('Microsoft Responsible AI');
    expect(sources).toContain('Google PAIR');
  });

  it('all principles have unique ids', () => {
    const ids = PRE_SHIPPED_PRINCIPLES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('findPrinciple returns by id; undefined when missing', () => {
    expect(findPrinciple('gdpr.art-22.no-solely-automated')?.id).toBe(
      'gdpr.art-22.no-solely-automated',
    );
    expect(findPrinciple('nonexistent')).toBeUndefined();
  });

  it('principlesFor("ai-decision","GLOBAL") returns GLOBAL principles', () => {
    const result = principlesFor('ai-decision', 'GLOBAL');
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((p) => p.applicableContext.includes('ai-decision'))).toBe(true);
    expect(result.every((p) => p.jurisdiction === 'GLOBAL')).toBe(true);
  });

  it('principlesFor("ai-decision","EU") includes GDPR Art 22 + EU AI Act + GLOBAL', () => {
    const ids = principlesFor('ai-decision', 'EU').map((p) => p.id);
    expect(ids).toContain('gdpr.art-22.no-solely-automated');
    expect(ids).toContain('eu.ai-act.art-9.risk-mgmt');
    expect(ids).toContain('eu.ai-act.art-14.human-oversight');
    expect(ids).toContain('asilomar.safety');
  });

  it('principlesFor("ai-decision","UK") inherits EU principles (UK GDPR parity)', () => {
    const ids = principlesFor('ai-decision', 'UK').map((p) => p.id);
    expect(ids).toContain('gdpr.art-22.no-solely-automated');
    expect(ids).toContain('eu.ai-act.art-9.risk-mgmt');
  });

  it('GDPR Art 22 evaluator returns null with human review', () => {
    const p = findPrinciple('gdpr.art-22.no-solely-automated');
    expect(p?.evaluator?.({ hasHumanReview: true })).toBeNull();
  });

  it('GDPR Art 22 evaluator fails with no lawful basis', () => {
    const p = findPrinciple('gdpr.art-22.no-solely-automated');
    expect(p?.evaluator?.({})).toContain('GDPR Art. 22');
  });

  it('GDPR Art 12 evaluator enforces <=grade-9 readability', () => {
    const p = findPrinciple('gdpr.art-12.transparency');
    expect(p?.evaluator?.({ fleschKincaidGrade: 8 })).toBeNull();
    expect(p?.evaluator?.({ fleschKincaidGrade: 14 })).toContain('grade 9');
  });

  it('EU AI Act Art 14 evaluator demands a named overseer', () => {
    const p = findPrinciple('eu.ai-act.art-14.human-oversight');
    expect(p?.evaluator?.({ humanOverseerId: 'overseer-1' })).toBeNull();
    expect(p?.evaluator?.({})).toContain('human overseer');
  });

  it('Anthropic RSP evaluator requires harm-eval pass', () => {
    const p = findPrinciple('anthropic.rsp.harm-eval');
    expect(p?.evaluator?.({ harmEvalPassed: true })).toBeNull();
    expect(p?.evaluator?.({ harmEvalPassed: false })).toContain('harm-elicitation');
  });

  it('Google PAIR evaluator requires AI badge', () => {
    const p = findPrinciple('google.pair.ai-disclosure');
    expect(p?.evaluator?.({ aiBadgeShown: true })).toBeNull();
    expect(p?.evaluator?.({ aiBadgeShown: false })).toContain('AI');
  });
});
