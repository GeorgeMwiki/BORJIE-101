import { describe, expect, it } from 'vitest';

import {
  recogniseIntent,
  MIN_INTENT_CONFIDENCE,
  DEFAULT_PATTERNS,
  DEFAULT_RECOGNISER_CONFIG,
  type RecogniserConfig,
} from '../intent-recognition.js';

describe('recogniseIntent — happy path', () => {
  it('returns BuyerKYBStart for a buyer KYB turn', () => {
    const intent = recogniseIntent(
      'new buyer Jamhuri Mining wants 8 tons gold concentrate next quarter',
    );
    expect(intent).not.toBeNull();
    expect(intent?.kind).toBe('BuyerKYBStart');
    expect(intent?.confidence).toBeGreaterThanOrEqual(MIN_INTENT_CONFIDENCE);
  });

  it('returns SiteInspectionStart for a site inspection turn', () => {
    const intent = recogniseIntent(
      'I need to log a site inspection for parcel P-12345 — compliance walkthrough',
    );
    expect(intent?.kind).toBe('SiteInspectionStart');
    expect(intent?.confidence).toBeGreaterThanOrEqual(MIN_INTENT_CONFIDENCE);
  });

  it('extracts entities (commodity + tons)', () => {
    const intent = recogniseIntent('new buyer wants 8 tons gold next month');
    expect(intent).not.toBeNull();
    const kinds = intent?.entities.map((e) => e.kind) ?? [];
    expect(kinds).toContain('commodity');
    expect(kinds).toContain('quantity_tons');
  });

  it('extracts parcel_ref entity for site inspection', () => {
    const intent = recogniseIntent(
      'plan inspection for parcel P12345 compliance check',
    );
    expect(intent?.kind).toBe('SiteInspectionStart');
    const parcel = intent?.entities.find((e) => e.kind === 'parcel_ref');
    expect(parcel?.value).toMatch(/12345/);
  });

  it('keeps source_excerpt under 280 chars', () => {
    const long = 'buyer '.repeat(200);
    const intent = recogniseIntent(long);
    expect(intent?.source_excerpt.length).toBeLessThanOrEqual(280);
  });
});

describe('recogniseIntent — confidence floor', () => {
  it('returns null for empty input', () => {
    expect(recogniseIntent('')).toBeNull();
    expect(recogniseIntent('   ')).toBeNull();
  });

  it('returns null when no pattern matches', () => {
    expect(recogniseIntent('the weather is nice today')).toBeNull();
  });

  it('exposes MIN_INTENT_CONFIDENCE at 0.7', () => {
    expect(MIN_INTENT_CONFIDENCE).toBe(0.7);
  });

  it('honours a stricter minConfidence', () => {
    const config: RecogniserConfig = {
      patterns: DEFAULT_PATTERNS,
      minConfidence: 0.95,
    };
    // Single required term, no boosters → score 0.7 → drops below 0.95
    const intent = recogniseIntent('buyer onboarding', config);
    expect(intent).toBeNull();
  });

  it('returns a high score when boosters fire', () => {
    const intent = recogniseIntent(
      'new buyer kyb, mining licence, gold concentrate, tons',
    );
    expect(intent?.confidence).toBe(1);
  });

  it('returns 0.85 with one booster', () => {
    const intent = recogniseIntent('new buyer with mining business');
    expect(intent?.confidence).toBe(0.85);
  });

  it('rejects non-string input', () => {
    // @ts-expect-error testing runtime guard
    expect(recogniseIntent(null)).toBeNull();
    // @ts-expect-error testing runtime guard
    expect(recogniseIntent(undefined)).toBeNull();
    // @ts-expect-error testing runtime guard
    expect(recogniseIntent(42)).toBeNull();
  });
});

describe('recogniseIntent — best-match selection', () => {
  it('picks the higher-scoring pattern when two match', () => {
    // 'buyer' triggers BuyerKYBStart;
    // 'inspection' triggers SiteInspectionStart with strong booster.
    const intent = recogniseIntent(
      'site inspection compliance walkthrough on the parcel',
    );
    expect(intent?.kind).toBe('SiteInspectionStart');
  });

  it('uses DEFAULT_RECOGNISER_CONFIG by default', () => {
    expect(DEFAULT_RECOGNISER_CONFIG.minConfidence).toBe(MIN_INTENT_CONFIDENCE);
    expect(DEFAULT_RECOGNISER_CONFIG.patterns).toBe(DEFAULT_PATTERNS);
  });
});
