import { describe, it, expect } from 'vitest';
import {
  styleResponse,
  GUIDE_PREAMBLE,
  LEARN_PREAMBLE,
  BALANCED_PREAMBLE,
  GUIDE_TAIL,
  LEARN_TAIL,
} from '../styling/response-styler.js';
import type { ResponseDraft, VoiceProfile } from '../types.js';

const profile = (
  mode: VoiceProfile['mode'],
  verbosity: VoiceProfile['verbosity_level'] = 2,
): VoiceProfile => ({
  tenant_id: 't1',
  user_id: 'u1',
  mode,
  verbosity_level: verbosity,
  updated_at: '2026-05-26T09:00:00.000Z',
});

const sampleDraft: ResponseDraft = {
  body: "I've drafted your Q2 Tumemadini return using the BoT gold-window rate from yesterday's close.",
  action: { kind: 'approve', label: 'Approve and file Friday' },
  clarifier_questions: [
    'What does the BoT gold-window rate imply for clause 4.2?',
    'Given June production of 184.7 oz, what is the gross royalty?',
  ],
  citations: [{ title: 'BoT gold-window rate', url: 'https://bot.go.tz' }],
};

describe('styleResponse — GUIDE mode', () => {
  it('produces an action-first artifact with the GUIDE preamble and tail', () => {
    const styled = styleResponse(profile('guide'), sampleDraft);
    expect(styled.mode).toBe('guide');
    expect(styled.text).toContain(GUIDE_PREAMBLE);
    expect(styled.text).toContain(GUIDE_TAIL);
    expect(styled.text).toContain('Q2 Tumemadini');
    expect(styled.structure.artifact_first).toBe(true);
    expect(styled.structure.include_clarifiers).toBe(false);
    // GUIDE never injects the clarifier block.
    expect(styled.text).not.toContain('Given June production');
    expect(styled.action?.kind).toBe('approve');
  });
});

describe('styleResponse — LEARN mode', () => {
  it('produces an explanation-first response with the LEARN preamble and clarifiers', () => {
    const styled = styleResponse(profile('learn'), sampleDraft);
    expect(styled.mode).toBe('learn');
    expect(styled.text).toContain(LEARN_PREAMBLE);
    expect(styled.text).toContain(LEARN_TAIL);
    expect(styled.text).toContain('1. What does the BoT gold-window');
    expect(styled.text).toContain('2. Given June production');
    expect(styled.structure.explanation_first).toBe(true);
    expect(styled.structure.include_clarifiers).toBe(true);
    expect(styled.structure.artifact_first).toBe(false);
  });

  it('still styles a draft with no clarifier questions', () => {
    const styled = styleResponse(profile('learn'), {
      body: 'Some body text',
    });
    expect(styled.mode).toBe('learn');
    expect(styled.text).toContain('Some body text');
  });
});

describe('styleResponse — BALANCED mode (default)', () => {
  it('uses the BALANCED preamble and stays action-first', () => {
    const styled = styleResponse(profile('balanced'), sampleDraft);
    expect(styled.mode).toBe('balanced');
    expect(styled.text).toContain(BALANCED_PREAMBLE);
    // BALANCED stays artifact-first like GUIDE, but with softer tail.
    expect(styled.structure.artifact_first).toBe(true);
    expect(styled.structure.include_clarifiers).toBe(false);
  });
});

describe('styleResponse — verbosity dial', () => {
  it('adds a depth-offer suffix at verbosity >= 3', () => {
    const verbose = styleResponse(profile('guide', 4), sampleDraft);
    const terse = styleResponse(profile('guide', 2), sampleDraft);
    expect(verbose.text.length).toBeGreaterThan(terse.text.length);
    expect(verbose.text).toContain('I can go deeper');
    expect(terse.text).not.toContain('I can go deeper');
  });

  it('forwards citations and action unchanged', () => {
    const styled = styleResponse(profile('guide'), sampleDraft);
    expect(styled.citations).toEqual(sampleDraft.citations);
    expect(styled.action).toEqual(sampleDraft.action);
  });
});

describe('styleResponse — determinism', () => {
  it('returns identical text for identical inputs (immutability)', () => {
    const a = styleResponse(profile('guide'), sampleDraft);
    const b = styleResponse(profile('guide'), sampleDraft);
    expect(a.text).toBe(b.text);
    expect(a.structure).toEqual(b.structure);
  });
});
