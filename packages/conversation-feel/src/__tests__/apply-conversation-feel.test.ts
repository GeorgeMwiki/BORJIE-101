import { describe, it, expect, vi, afterEach } from 'vitest';
import { applyConversationFeel } from '../apply-conversation-feel.js';
import * as stripper from '../guards/anti-pattern-stripper.js';
import * as honesty from '../guards/honest-uncertainty.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('applyConversationFeel — core behaviour', () => {
  it('strips a sycophantic opener (en)', () => {
    const r = applyConversationFeel(
      'Great question! The royalty is 6% of gross value.',
      'en',
    );
    expect(r.text).toBe('The royalty is 6% of gross value.');
    expect(r.changed).toBe(true);
    expect(r.removed_phrases.length).toBeGreaterThan(0);
    expect(r.failed_open).toBe(false);
  });

  it('strips theatrical apology around an admission (en)', () => {
    const r = applyConversationFeel(
      "I'm so sorry, but I don't have that figure yet.",
      'en',
    );
    expect(r.text).toBe("I don't have that figure yet.");
    expect(r.changed).toBe(true);
  });

  it('is a no-op on a clean reply', () => {
    const clean = 'The gold-window rate closed at 1,950 per ounce.';
    const r = applyConversationFeel(clean, 'en');
    expect(r.text).toBe(clean);
    expect(r.changed).toBe(false);
  });

  it('keeps the original when stripping would gut the reply', () => {
    const r = applyConversationFeel('Sure! Happy to help!', 'en');
    // shouldRequestRegen → true, so we keep the original rather than ship empty.
    expect(r.text).toBe('Sure! Happy to help!');
    expect(r.changed).toBe(false);
  });

  it('returns input unchanged for empty / non-string', () => {
    expect(applyConversationFeel('', 'en').text).toBe('');
    // @ts-expect-error defensive runtime guard
    expect(applyConversationFeel(undefined, 'en').text).toBe('');
  });
});

describe('applyConversationFeel — fail-open', () => {
  it('returns the original text unchanged when a guard throws', () => {
    vi.spyOn(stripper, 'stripChatbotFeel').mockImplementation(() => {
      throw new Error('boom');
    });
    vi.spyOn(honesty, 'stripTheatreFromUncertainty').mockImplementation(() => {
      throw new Error('boom');
    });
    const original = 'Great question! The royalty is 6%.';
    const r = applyConversationFeel(original, 'en');
    expect(r.text).toBe(original);
    expect(r.failed_open).toBe(true);
  });

  it('still applies the second step when only the first throws', () => {
    vi.spyOn(stripper, 'stripChatbotFeel').mockImplementation(() => {
      throw new Error('boom');
    });
    const r = applyConversationFeel(
      "I'm so sorry, but I don't have that figure.",
      'en',
    );
    // Step 1 failed open; step 2 still strips the apology.
    expect(r.text).toBe("I don't have that figure.");
    expect(r.failed_open).toBe(true);
  });
});

describe('applyConversationFeel — locale purity', () => {
  it('an English reply stays English (no Swahili injected)', () => {
    const r = applyConversationFeel(
      'Great question! The licence renewal opens March 1.',
      'en',
    );
    expect(r.text).not.toMatch(/\b(sina|samahani|swali|asante)\b/i);
  });

  it('a Swahili reply stays Swahili (no English injected)', () => {
    const r = applyConversationFeel(
      'Swali zuri! Mrabaha ni asilimia sita ya thamani ghafi.',
      'sw',
    );
    expect(r.text).toBe('Mrabaha ni asilimia sita ya thamani ghafi.');
    expect(r.text).not.toMatch(/\b(sorry|great|question|thanks)\b/i);
  });

  it('does not strip the other locale\'s filler when locale is fixed', () => {
    // English filler opener, but locale is sw → sw rules only → no change.
    const enFiller = 'Great question! Mrabaha ni sita.';
    const r = applyConversationFeel(enFiller, 'sw');
    expect(r.text).toBe(enFiller);
    expect(r.changed).toBe(false);
  });
});
