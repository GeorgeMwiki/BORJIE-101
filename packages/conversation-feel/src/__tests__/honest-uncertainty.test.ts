import { describe, it, expect } from 'vitest';
import {
  decideHonestUncertainty,
  stripTheatreFromUncertainty,
} from '../guards/honest-uncertainty.js';

describe('decideHonestUncertainty', () => {
  it('admits missing info plainly in English', () => {
    const r = decideHonestUncertainty({
      calibrated_confidence: 90,
      missing_required_info: ['the assay date'],
      retrieval_returned_empty: false,
      locale: 'en',
    });
    expect(r.should_admit).toBe(true);
    expect(r.reason).toBe('missing_info');
    expect(r.user_facing).toContain("I don't have");
    expect(r.avoids_theatre).toBe(true);
  });

  it('admits missing info plainly in Swahili', () => {
    const r = decideHonestUncertainty({
      calibrated_confidence: 90,
      missing_required_info: ['tarehe ya uchunguzi'],
      retrieval_returned_empty: false,
      locale: 'sw',
    });
    expect(r.should_admit).toBe(true);
    expect(r.user_facing).toContain('Sina');
    // Swahili admission contains no English uncertainty phrasing.
    expect(r.user_facing).not.toMatch(/I don't|sorry/i);
  });

  it('does not admit when confident with everything present', () => {
    const r = decideHonestUncertainty({
      calibrated_confidence: 90,
      missing_required_info: [],
      retrieval_returned_empty: false,
      locale: 'en',
    });
    expect(r.should_admit).toBe(false);
  });
});

describe('stripTheatreFromUncertainty', () => {
  it('strips an English theatrical apology around an admission', () => {
    const out = stripTheatreFromUncertainty(
      "I'm so sorry, but I don't have that figure.",
      'en',
    );
    expect(out).toBe("I don't have that figure.");
  });

  it('rewrites "Unfortunately, I cannot" to "I cannot"', () => {
    const out = stripTheatreFromUncertainty(
      'Unfortunately, I cannot confirm the rate.',
      'en',
    );
    expect(out.toLowerCase()).toContain('i cannot confirm');
    expect(out.toLowerCase()).not.toContain('unfortunately');
  });

  it('strips a Swahili theatrical apology around an admission', () => {
    const out = stripTheatreFromUncertainty(
      'Samahani, lakini sina takwimu hiyo.',
      'sw',
    );
    expect(out).toBe('sina takwimu hiyo.');
    expect(out).not.toMatch(/samahani/i);
  });
});
