/**
 * State-machine unit tests — pure transitions only.
 */

import { describe, it, expect } from 'vitest';
import {
  initialState,
  advance,
  nextStep,
  isDontGetIt,
  scoreCheckAnswer,
  pickCitationFocus,
  BUILT_IN_CONCEPTS,
} from '../index.js';

describe('state-machine: nextStep', () => {
  it('walks the linear path', () => {
    expect(nextStep('assess')).toBe('hook');
    expect(nextStep('hook')).toBe('explain');
    expect(nextStep('explain')).toBe('worked_example');
    expect(nextStep('worked_example')).toBe('check_understanding');
    expect(nextStep('check_understanding')).toBe('mastery');
    expect(nextStep('remediate')).toBe('check_understanding');
    expect(nextStep('mastery')).toBe('complete');
    expect(nextStep('complete')).toBe('complete');
  });
});

describe('state-machine: initial + advance', () => {
  it('initialises with sane defaults', () => {
    const s = initialState({
      tenantId: 't1',
      userId: 'u1',
      conceptSlug: 'net_operating_income',
    });
    expect(s.step).toBe('assess');
    expect(s.locale).toBe('en');
    expect(s.checkIndex).toBe(0);
    expect(s.attempts).toBe(0);
  });

  it('advance: assess → hook (no reply consumed)', () => {
    const concept = BUILT_IN_CONCEPTS['net_operating_income']!;
    let s = initialState({
      tenantId: 't1',
      userId: 'u1',
      conceptSlug: 'net_operating_income',
    });
    s = advance(s, null, concept);
    expect(s.step).toBe('hook');
  });

  it('check_understanding: correct answer advances to next probe', () => {
    const concept = BUILT_IN_CONCEPTS['net_operating_income']!;
    let s = initialState({
      tenantId: 't1',
      userId: 'u1',
      conceptSlug: 'net_operating_income',
    });
    // Walk to check_understanding.
    while (s.step !== 'check_understanding') {
      s = advance(s, null, concept);
    }
    expect(s.checkIndex).toBe(0);
    s = advance(s, 'no', concept); // matches `no|below`
    expect(s.correctCount).toBe(1);
    expect(s.step).toBe('check_understanding');
    expect(s.checkIndex).toBe(1);
  });

  it('check_understanding: first incorrect stays on probe; second advances', () => {
    const concept = BUILT_IN_CONCEPTS['net_operating_income']!;
    let s = initialState({
      tenantId: 't1',
      userId: 'u1',
      conceptSlug: 'net_operating_income',
    });
    while (s.step !== 'check_understanding') {
      s = advance(s, null, concept);
    }
    s = advance(s, 'maybe', concept);
    expect(s.step).toBe('check_understanding');
    expect(s.attempts).toBe(1);
    s = advance(s, 'still wrong', concept);
    expect(s.checkIndex).toBe(1);
    expect(s.incorrectCount).toBe(2);
  });

  it('check_understanding: "I dont get it" branches to remediate', () => {
    const concept = BUILT_IN_CONCEPTS['net_operating_income']!;
    let s = initialState({
      tenantId: 't1',
      userId: 'u1',
      conceptSlug: 'net_operating_income',
    });
    while (s.step !== 'check_understanding') {
      s = advance(s, null, concept);
    }
    s = advance(s, "I don't get it", concept);
    expect(s.step).toBe('remediate');
  });

  it('remediate → check_understanding', () => {
    const concept = BUILT_IN_CONCEPTS['net_operating_income']!;
    let s = initialState({
      tenantId: 't1',
      userId: 'u1',
      conceptSlug: 'net_operating_income',
    });
    while (s.step !== 'check_understanding') {
      s = advance(s, null, concept);
    }
    s = advance(s, "I don't get it", concept);
    expect(s.step).toBe('remediate');
    s = advance(s, null, concept);
    expect(s.step).toBe('check_understanding');
  });

  it('reaches mastery and complete', () => {
    const concept = BUILT_IN_CONCEPTS['arrears_aging']!;
    let s = initialState({
      tenantId: 't1',
      userId: 'u1',
      conceptSlug: 'arrears_aging',
    });
    while (s.step !== 'check_understanding') {
      s = advance(s, null, concept);
    }
    s = advance(s, '90+', concept); // matches `90|90\\+`
    expect(s.step).toBe('mastery');
    s = advance(s, null, concept);
    expect(s.step).toBe('complete');
  });
});

describe('state-machine: helpers', () => {
  it('isDontGetIt matches a few phrases', () => {
    expect(isDontGetIt("I don't get it")).toBe(true);
    expect(isDontGetIt('i dont understand')).toBe(true);
    expect(isDontGetIt('sielewi')).toBe(true);
    expect(isDontGetIt("I'm lost")).toBe(true);
    expect(isDontGetIt('confused')).toBe(true);
    expect(isDontGetIt('I think I got it')).toBe(false);
    expect(isDontGetIt('no')).toBe(false);
  });

  it('scoreCheckAnswer: regex match', () => {
    const probe = {
      question: 'q',
      expected_pattern: 'no|below',
      hint: 'h',
    };
    expect(scoreCheckAnswer('no', probe)).toBe('correct');
    expect(scoreCheckAnswer('below the line', probe)).toBe('correct');
    expect(scoreCheckAnswer('yes', probe)).toBe('incorrect');
  });

  it('scoreCheckAnswer: malformed regex falls back to substring', () => {
    const probe = {
      question: 'q',
      expected_pattern: '[invalid',
      hint: 'h',
    };
    expect(scoreCheckAnswer('contains [invalid stuff', probe)).toBe('correct');
    expect(scoreCheckAnswer('totally different', probe)).toBe('incorrect');
  });

  it('pickCitationFocus: term-map lookup', () => {
    const concept = BUILT_IN_CONCEPTS['net_operating_income']!;
    expect(pickCitationFocus('I don\'t get the gross income', concept)).toBe(
      'gross_income',
    );
    expect(pickCitationFocus('what about op-ex?', concept)).toBe('op_ex');
  });
});
