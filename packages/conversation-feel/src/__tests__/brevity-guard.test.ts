import { describe, it, expect } from 'vitest';
import {
  checkBrevity,
  countWords,
  countBullets,
  isJustifiedLength,
  inferTurnKind,
} from '../guards/brevity-guard.js';

describe('countWords / countBullets', () => {
  it('counts words ignoring extra whitespace', () => {
    expect(countWords('  one   two three ')).toBe(3);
    expect(countWords('')).toBe(0);
  });

  it('counts bullet markers', () => {
    expect(countBullets('- a\n- b\n* c')).toBe(3);
    expect(countBullets('no bullets here')).toBe(0);
  });
});

describe('checkBrevity', () => {
  it('flags a long unjustified question turn', () => {
    const long = Array.from({ length: 120 }, (_, i) => `word${i}`).join(' ');
    const r = checkBrevity(long, 'question', 'en');
    expect(r.within_limit).toBe(false);
    expect(r.regen_instruction).toContain('Tighten');
  });

  it('allows a long reply when it earns its length (en)', () => {
    const taught =
      'Because the royalty is assessed on gross value, the trade-off is cash now versus a higher net later. ' +
      Array.from({ length: 160 }, (_, i) => `point${i}`).join(' ');
    const r = checkBrevity(taught, 'explanation', 'en');
    expect(r.justified).toBe(true);
    expect(r.regen_instruction).toBeNull();
  });

  it('flags a 2-bullet list as mechanical', () => {
    const r = checkBrevity('- one\n- two', 'explanation', 'en');
    expect(r.bullet_violation).toBe(true);
    expect(r.regen_instruction).toContain('prose');
  });
});

describe('isJustifiedLength — Swahili', () => {
  it('recognises Swahili teaching markers', () => {
    const sw =
      'Kwa sababu mrabaha unakokotolewa kwa thamani ghafi, faida na hasara ni fedha sasa dhidi ya faida zaidi baadaye.';
    expect(isJustifiedLength(sw, 'sw')).toBe(true);
  });
});

describe('inferTurnKind', () => {
  it('detects English smalltalk and questions', () => {
    expect(inferTurnKind('hello', 'hi there')).toBe('smalltalk');
    expect(inferTurnKind('what is the royalty rate?', 'x')).toBe('question');
    expect(inferTurnKind('should i renew now?', 'x')).toBe('decision');
  });

  it('detects Swahili smalltalk and questions', () => {
    expect(inferTurnKind('habari', 'salama')).toBe('smalltalk');
    expect(inferTurnKind('nini kiwango cha mrabaha?', 'x')).toBe('question');
    expect(inferTurnKind('nifanye nini sasa?', 'x')).toBe('decision');
  });
});
