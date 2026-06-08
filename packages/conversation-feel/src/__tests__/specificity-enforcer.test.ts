import { describe, it, expect } from 'vitest';
import {
  extractSpecifics,
  checkSpecificity,
} from '../continuity/specificity-enforcer.js';
import type { ConversationContext } from '../types.js';

const ctx = (
  userMessage: string,
  locale: ConversationContext['locale'] = 'en',
): ConversationContext => ({
  session_id: 's1',
  turn_index: 1,
  locale,
  surface: 'owner',
  user_message: userMessage,
  recent_turns: [],
});

describe('extractSpecifics', () => {
  it('pulls proper nouns, amounts and dates', () => {
    const s = extractSpecifics('Geita produced 184 oz on 2026-06-01');
    expect(s.proper_nouns).toContain('Geita');
    expect(s.amounts.some((a) => a.includes('184'))).toBe(true);
    expect(s.dates).toContain('2026-06-01');
  });
});

describe('checkSpecificity', () => {
  it('flags a dropped proper noun', () => {
    const r = checkSpecificity(
      'The site produced well this quarter.',
      ctx('Geita produced well this quarter'),
    );
    expect(r.is_specific).toBe(false);
    expect(r.missing_user_words).toContain('Geita');
  });

  it('flags a rounded amount', () => {
    const r = checkSpecificity(
      'You earned about 5,000 this month.',
      ctx('I earned 5,123 this month'),
    );
    expect(r.rounded_numbers.length).toBeGreaterThan(0);
  });

  it('flags a Swahili vague-date paraphrase', () => {
    const r = checkSpecificity(
      'Itakwisha hivi karibuni.',
      ctx('Leseni inakwisha 2026-06-01', 'sw'),
    );
    expect(r.paraphrased_dates.length).toBeGreaterThan(0);
  });

  it('passes when specifics are preserved', () => {
    const r = checkSpecificity(
      'Geita produced 184 on 2026-06-01.',
      ctx('Geita produced 184 on 2026-06-01'),
    );
    expect(r.is_specific).toBe(true);
  });
});
