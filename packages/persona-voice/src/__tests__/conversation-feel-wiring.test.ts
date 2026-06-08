import { describe, it, expect } from 'vitest';
import { styleResponse } from '../styling/response-styler.js';
import type { ResponseDraft, VoiceProfile } from '../types.js';

const profile = (mode: VoiceProfile['mode'] = 'balanced'): VoiceProfile => ({
  tenant_id: 't1',
  user_id: 'u1',
  mode,
  verbosity_level: 2,
  updated_at: '2026-06-08T09:00:00.000Z',
});

describe('styleResponse — conversation-feel wiring', () => {
  it('strips a sycophantic opener from the body (en, default locale)', () => {
    const draft: ResponseDraft = {
      body: 'Great question! The royalty is 6% of gross value.',
    };
    const styled = styleResponse(profile(), draft);
    expect(styled.text).toContain('The royalty is 6% of gross value.');
    expect(styled.text).not.toContain('Great question!');
  });

  it('strips theatrical apology around an admission in the body', () => {
    const draft: ResponseDraft = {
      body: "I'm so sorry, but I don't have the assay date yet.",
    };
    const styled = styleResponse(profile(), draft);
    expect(styled.text).toContain("I don't have the assay date yet.");
    expect(styled.text.toLowerCase()).not.toContain('so sorry');
  });

  it('keeps the persona preamble and tail scaffolds intact', () => {
    const draft: ResponseDraft = {
      body: 'Great question! The filing is due Friday.',
    };
    const styled = styleResponse(profile('guide'), draft);
    // Scaffold lines are not subjected to filler-stripping.
    expect(styled.text).toContain("Here's what I've drafted for you:");
    expect(styled.text).toContain('Approve when ready.');
  });

  it('is locale-pure: a Swahili body stays Swahili (no English injected)', () => {
    const draft: ResponseDraft = {
      body: 'Swali zuri! Mrabaha ni asilimia sita ya thamani ghafi.',
    };
    const styled = styleResponse(profile(), draft, 'sw');
    expect(styled.text).toContain(
      'Mrabaha ni asilimia sita ya thamani ghafi.',
    );
    // The Swahili filler opener was removed; no English filler was added.
    expect(styled.text).not.toContain('Swali zuri!');
    // Body substance carries no English filler words.
    const bodyLine = styled.text
      .split('\n')
      .find((l) => l.includes('Mrabaha'));
    expect(bodyLine).toBeDefined();
    expect(bodyLine).not.toMatch(/\b(great|question|sorry|thanks)\b/i);
  });

  it('does not apply the other locale rules: en filler survives under sw', () => {
    const draft: ResponseDraft = {
      body: 'Great question! Mrabaha ni sita.',
    };
    const styled = styleResponse(profile(), draft, 'sw');
    // locale=sw runs Swahili rules only, so the English opener is left as-is.
    expect(styled.text).toContain('Great question! Mrabaha ni sita.');
  });

  it('is a no-op on a clean body (substance unchanged)', () => {
    const draft: ResponseDraft = {
      body: 'The gold-window rate closed at 1,950 per ounce.',
    };
    const styled = styleResponse(profile(), draft);
    expect(styled.text).toContain(
      'The gold-window rate closed at 1,950 per ounce.',
    );
  });
});
