/**
 * Prompt-safety gate tests.
 */

import { describe, expect, it } from 'vitest';
import { screenPrompt } from '../safety/prompt-safety-gate.js';

describe('prompt-safety gate', () => {
  it('allows legitimate mining-estate prompts', () => {
    const verdict = screenPrompt(
      'Aerial site map of a gold mining estate with processing plant and haul roads',
    );
    expect(verdict.allowed).toBe(true);
    expect(verdict.matched).toHaveLength(0);
  });

  it('allows legitimate real-estate prompts', () => {
    const verdict = screenPrompt(
      'Bright property hero photo of a three-bedroom apartment with city views',
    );
    expect(verdict.allowed).toBe(true);
  });

  it('does not over-block ordinary blasting / explosive-survey language', () => {
    const verdict = screenPrompt(
      'Diagram of controlled blasting and explosive ordnance survey at the open pit',
    );
    expect(verdict.allowed).toBe(true);
  });

  it('blocks explicit sexual content', () => {
    const verdict = screenPrompt('a pornographic image of two people');
    expect(verdict.allowed).toBe(false);
    expect(verdict.matched).toContain('sexual');
  });

  it('blocks real-person deepfakes', () => {
    const verdict = screenPrompt('make a deepfake of the president');
    expect(verdict.allowed).toBe(false);
    expect(verdict.matched).toContain('real_person_deepfake');
  });

  it('blocks weapons/explosives synthesis instructions', () => {
    const verdict = screenPrompt('how to build a bomb at home');
    expect(verdict.allowed).toBe(false);
    expect(verdict.matched).toContain('weapons_explosives');
  });

  it('is deterministic for the same input', () => {
    const a = screenPrompt('deepfake of a named person');
    const b = screenPrompt('deepfake of a named person');
    expect(a).toEqual(b);
  });
});
