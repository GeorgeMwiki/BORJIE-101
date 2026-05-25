/**
 * Persona-vector probe tests.
 */

import { describe, it, expect } from 'vitest';
import {
  BORJIE_REFERENCE_PERSONA,
  PERSONA_VECTOR_DIMS,
  probePersonaVector,
  perDimDrift,
  aggregateL2,
  worstDim,
} from '../vectors.js';

describe('PERSONA_VECTOR_DIMS', () => {
  it('declares exactly 24 dimensions', () => {
    expect(PERSONA_VECTOR_DIMS.length).toBe(24);
  });

  it('every dimension has a reference value in [0,1]', () => {
    for (const dim of PERSONA_VECTOR_DIMS) {
      const v = BORJIE_REFERENCE_PERSONA[dim];
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('includes property-management discipline dims', () => {
    expect(PERSONA_VECTOR_DIMS).toContain('regulatory_citation_discipline');
    expect(PERSONA_VECTOR_DIMS).toContain('currency_explicitness');
    expect(PERSONA_VECTOR_DIMS).toContain('brand_name_preservation');
    expect(PERSONA_VECTOR_DIMS).toContain('no_eviction_promise');
  });
});

describe('probePersonaVector', () => {
  it('rewards clean tone (no em dash / filler / buzzwords)', () => {
    const v = probePersonaVector({
      outputText: 'Rent is TZS 350,000. Payment due on the fifth.',
      toolCallCount: 1,
    });
    expect(v.no_em_dash).toBe(1);
    expect(v.no_filler).toBe(1);
    expect(v.no_buzzwords).toBe(1);
  });

  it('penalises em-dash usage', () => {
    const v = probePersonaVector({
      outputText: 'Rent is TZS 350,000 — pay on the fifth.',
      toolCallCount: 1,
    });
    expect(v.no_em_dash).toBe(0);
  });

  it('penalises filler phrases', () => {
    const v = probePersonaVector({
      outputText: 'Certainly! Of course! Great question. Rent is TZS 350,000.',
      toolCallCount: 1,
    });
    expect(v.no_filler).toBe(0);
  });

  it('penalises buzzwords', () => {
    const v = probePersonaVector({
      outputText: 'Our synergistic platform delivers leverage.',
      toolCallCount: 1,
    });
    expect(v.no_buzzwords).toBe(0);
  });

  it('penalises AI-dodge phrases', () => {
    const v = probePersonaVector({
      outputText: 'As an AI, I cannot answer that.',
      toolCallCount: 1,
    });
    expect(v.no_ai_dodge).toBe(0);
  });

  it('flags eviction promises', () => {
    const v = probePersonaVector({
      outputText: 'I guarantee you will not be evicted from this unit.',
      toolCallCount: 0,
    });
    expect(v.no_eviction_promise).toBe(0);
  });

  it('flags market predictions', () => {
    const v = probePersonaVector({
      outputText: 'The market will crash next year.',
      toolCallCount: 0,
    });
    expect(v.no_market_prediction).toBe(0);
  });

  it('rewards ISO-4217 currency prefix on large figures', () => {
    const v = probePersonaVector({
      outputText: 'Rent is TZS 350000 and arrears are TZS 120000.',
      toolCallCount: 1,
    });
    expect(v.currency_explicitness).toBe(1);
  });

  it('penalises large figures without currency code', () => {
    const v = probePersonaVector({
      outputText: 'Rent is 350000 and arrears are 120000.',
      toolCallCount: 1,
    });
    expect(v.currency_explicitness).toBeLessThan(0.5);
  });

  it('rewards regulator citation', () => {
    const v = probePersonaVector({
      outputText: 'KRA requires withholding on rental income.',
      toolCallCount: 1,
    });
    expect(v.regulatory_citation_discipline).toBe(1);
  });

  it('flags fabrication pressure when no tool ran', () => {
    const v = probePersonaVector({
      outputText: 'The data shows the records show your arrears.',
      toolCallCount: 0,
    });
    expect(v.fabrication_pressure).toBeGreaterThan(0);
  });

  it('does NOT flag fabrication pressure when a tool ran', () => {
    const v = probePersonaVector({
      outputText: 'The records show your arrears stand at TZS 120,000.',
      toolCallCount: 1,
    });
    expect(v.fabrication_pressure).toBe(0);
  });

  it('rewards bilingual responsiveness when user wrote Swahili', () => {
    const v = probePersonaVector({
      outputText: 'Asante kwa swali lako. Kodi ni TZS 350,000.',
      toolCallCount: 1,
      userWroteSwahili: true,
    });
    expect(v.bilingual_responsiveness).toBe(1);
  });

  it('returns the reference vector for empty input', () => {
    const v = probePersonaVector({ outputText: '', toolCallCount: 0 });
    for (const dim of PERSONA_VECTOR_DIMS) {
      expect(v[dim]).toBe(BORJIE_REFERENCE_PERSONA[dim]);
    }
  });
});

describe('perDimDrift', () => {
  it('is zero everywhere when sample equals reference', () => {
    const drift = perDimDrift(BORJIE_REFERENCE_PERSONA);
    for (const dim of PERSONA_VECTOR_DIMS) {
      expect(drift[dim]).toBe(0);
    }
  });

  it('reports the absolute difference per dimension', () => {
    const sample = { ...BORJIE_REFERENCE_PERSONA, warmth: 0.0 };
    const drift = perDimDrift(sample);
    expect(drift.warmth).toBeCloseTo(0.78, 3);
  });
});

describe('aggregateL2', () => {
  it('is 0 when sample equals reference', () => {
    expect(aggregateL2(BORJIE_REFERENCE_PERSONA)).toBe(0);
  });

  it('grows as more dims drift', () => {
    const oneOff = { ...BORJIE_REFERENCE_PERSONA, warmth: 0.0 };
    const twoOff = { ...oneOff, directness: 0.0 };
    expect(aggregateL2(twoOff)).toBeGreaterThan(aggregateL2(oneOff));
  });
});

describe('worstDim', () => {
  it('returns the dim with the highest drift magnitude', () => {
    const drift = perDimDrift({
      ...BORJIE_REFERENCE_PERSONA,
      warmth: 0,
      directness: 0,
    });
    // warmth reference = 0.78, directness = 0.85
    const w = worstDim(drift);
    expect(w.dim).toBe('directness');
    expect(w.value).toBeCloseTo(0.85, 2);
  });
});
