/**
 * Glossary substitution + verification tests.
 *
 * Covers:
 *   - `lockTerms` pre-substitution: longest-match wins, word-boundary,
 *     case-insensitive.
 *   - `unlockTerms` post-substitution: placeholder → target term.
 *   - `verifyTermSurvival`: 1.0 on a perfect run; <1.0 when a
 *     placeholder is dropped (positive + violation case).
 */

import { describe, expect, it } from 'vitest';
import { assembleGlossary } from '../glossary/glossary-manager.js';
import {
  lockTerms,
  unlockTerms,
  verifyTermSurvival,
} from '../glossary/term-locker.js';
import { SEED_MINING_GLOSSARY } from '../glossary/seed-mining-glossary.js';

describe('term-locker', () => {
  it('substitutes a single glossary term with a placeholder (sw → en)', () => {
    const glossary = assembleGlossary(SEED_MINING_GLOSSARY);
    const lock = lockTerms('Parseli imefika', glossary, 'sw', 'en');
    expect(lock.placeholders).toHaveLength(1);
    const first = lock.placeholders[0];
    expect(first).toBeDefined();
    expect(first?.entry.srcTerm.toLowerCase()).toBe('parseli');
    expect(first?.entry.targetTerm).toBe('parcel');
    expect(lock.placeholderSource).toMatch(/<<G:0001>>/);
  });

  it('respects word boundaries — does NOT match inside another word', () => {
    const glossary = assembleGlossary(SEED_MINING_GLOSSARY);
    // "ml" is a known PML token. The substring "ml" inside
    // "controlment" must NOT fire a placeholder.
    const lock = lockTerms('controlment of the asset', glossary, 'en', 'sw');
    expect(lock.placeholders.find((b) => b.entry.srcTerm === 'ML')).toBeUndefined();
  });

  it('matches case-insensitively but preserves the canonical target term', () => {
    const glossary = assembleGlossary(SEED_MINING_GLOSSARY);
    const lock = lockTerms('NDUGU, parseli imefika', glossary, 'sw', 'en');
    // We expect both placeholders to fire (Ndugu + parseli) AND the
    // target terms to be "Dear sir or madam" and "parcel" respectively.
    expect(lock.placeholders.length).toBeGreaterThanOrEqual(2);
    const targets = lock.placeholders.map((b) => b.entry.targetTerm);
    expect(targets).toContain('Dear sir or madam');
    expect(targets).toContain('parcel');
  });

  it('verifies adherence = 1.0 on a happy-path round trip', () => {
    const glossary = assembleGlossary(SEED_MINING_GLOSSARY);
    const lock = lockTerms(
      'Ndugu, parseli imefika kwa PML.',
      glossary,
      'sw',
      'en',
    );
    // Simulate the provider returning the placeholder-laced source
    // translated to English.
    const providerOutput = lock.placeholderSource
      .replace('imefika', 'has arrived')
      .replace('kwa', 'at the')
      .replace(',', ',');
    const unlocked = unlockTerms(providerOutput, lock.placeholders);
    const adherence = verifyTermSurvival(
      providerOutput,
      unlocked,
      lock.placeholders,
    );
    expect(adherence).toBe(1);
  });

  it('detects a glossary violation when a placeholder is dropped', () => {
    const glossary = assembleGlossary(SEED_MINING_GLOSSARY);
    const lock = lockTerms('Ndugu, parseli imefika.', glossary, 'sw', 'en');
    // Provider drops the first placeholder entirely.
    const tokens = lock.placeholders.map((b) => b.token);
    const firstToken = tokens[0];
    expect(firstToken).toBeDefined();
    const providerOutput = lock.placeholderSource.replace(
      firstToken as string,
      '',
    );
    const unlocked = unlockTerms(providerOutput, lock.placeholders);
    const adherence = verifyTermSurvival(
      providerOutput,
      unlocked,
      lock.placeholders,
    );
    expect(adherence).toBeLessThan(1);
  });
});
