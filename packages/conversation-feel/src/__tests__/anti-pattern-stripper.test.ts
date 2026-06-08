import { describe, it, expect } from 'vitest';
import {
  stripChatbotFeel,
  shouldRequestRegen,
} from '../guards/anti-pattern-stripper.js';

describe('stripChatbotFeel — English', () => {
  it('strips a sycophantic opener and keeps substance', () => {
    const r = stripChatbotFeel(
      "Great question! The royalty rate is 6% of gross value.",
      'en',
    );
    expect(r.stripped).toBe('The royalty rate is 6% of gross value.');
    expect(r.removed_phrases.length).toBeGreaterThan(0);
    expect(r.removed_phrases[0]?.pattern).toBe('filler_opener');
  });

  it('strips an "anything else" closer', () => {
    const r = stripChatbotFeel(
      'Your filing is due Friday. Is there anything else I can help you with?',
      'en',
    );
    expect(r.stripped).toBe('Your filing is due Friday.');
  });

  it('peels chained openers across passes', () => {
    const r = stripChatbotFeel(
      'Sure! Of course! The site permit covers 12 hectares.',
      'en',
    );
    expect(r.stripped).toBe('The site permit covers 12 hectares.');
  });

  it('is a no-op on a clean reply', () => {
    const clean = 'The gold-window rate closed at 1,950 per ounce.';
    const r = stripChatbotFeel(clean, 'en');
    expect(r.stripped).toBe(clean);
    expect(r.removed_phrases).toHaveLength(0);
  });

  it('returns input unchanged for empty / non-string', () => {
    expect(stripChatbotFeel('', 'en').stripped).toBe('');
    // @ts-expect-error testing defensive runtime guard
    expect(stripChatbotFeel(null, 'en').stripped).toBe('');
  });
});

describe('stripChatbotFeel — Swahili', () => {
  it('strips a Swahili praising opener and keeps substance', () => {
    const r = stripChatbotFeel(
      'Swali zuri! Kiwango cha mrabaha ni asilimia sita.',
      'sw',
    );
    expect(r.stripped).toBe('Kiwango cha mrabaha ni asilimia sita.');
    expect(r.removed_phrases.length).toBeGreaterThan(0);
  });

  it('strips a Swahili "anything else" closer', () => {
    const r = stripChatbotFeel(
      'Malipo yako yamekamilika. Kuna jambo lingine ninaweza kukusaidia?',
      'sw',
    );
    expect(r.stripped).toBe('Malipo yako yamekamilika.');
  });
});

describe('shouldRequestRegen', () => {
  it('flags a reply that was almost entirely filler', () => {
    const r = stripChatbotFeel('Sure! Happy to help!', 'en');
    expect(shouldRequestRegen(r)).toBe(true);
  });

  it('does not flag when little was removed', () => {
    const r = stripChatbotFeel(
      'Great question! The licence renewal window opens on March 1 and closes April 30 each year.',
      'en',
    );
    expect(shouldRequestRegen(r)).toBe(false);
  });
});
