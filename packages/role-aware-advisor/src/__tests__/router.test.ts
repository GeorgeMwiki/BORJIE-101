/**
 * Router classification tests — pinned 20-sample sweep across every
 * intent bucket so regressions on the keyword weights show up here.
 */

import { describe, it, expect } from 'vitest';
import { routeQuestion } from '../router.js';

interface Sample {
  readonly q: string;
  readonly expected: string;
}

const SAMPLES: ReadonlyArray<Sample> = [
  { q: 'What is our scope 1 carbon footprint?', expected: 'sustainability' },
  { q: 'Run a BREEAM estimate for the new tower.', expected: 'sustainability' },
  { q: 'Should we enter the Mombasa market next?', expected: 'expansion' },
  { q: 'I want to expand portfolio into Kigali.', expected: 'expansion' },
  { q: 'Should I acquire 12 Riverside Drive at the asking price?', expected: 'acquisition' },
  { q: 'Cap rate on this deal underwriting feels low.', expected: 'acquisition' },
  { q: 'When should we reposition asset 14?', expected: 'lifecycle' },
  { q: 'Draft a capex plan for the next five years.', expected: 'lifecycle' },
  { q: 'Tell me the green premium story for the south wing.', expected: 'green-angle' },
  { q: 'Help me set up the estate department org chart.', expected: 'estate-department' },
  { q: 'Switch this building to auto pilot management.', expected: 'estate-auto-management' },
  { q: 'My lease is up next month — should I renew?', expected: 'lease-question' },
  { q: 'Is my rent fair compared to neighbours?', expected: 'lease-question' },
  { q: 'How do I file a maintenance request for a water leak?', expected: 'maintenance-question' },
  { q: 'My A/C is broken, what now?', expected: 'maintenance-question' },
  { q: 'What is the market rate for a 2-bed in Mikocheni?', expected: 'market-question' },
  { q: 'Show me comps for similar units nearby.', expected: 'market-question' },
  { q: 'Tell me about my neighbourhood schools and commute.', expected: 'neighborhood-question' },
  { q: 'Is the area safe at night?', expected: 'neighborhood-question' },
  { q: 'Random philosophical musing about housing in general.', expected: 'general' },
];

describe('router.routeQuestion', () => {
  for (const s of SAMPLES) {
    it(`routes "${s.q}" → ${s.expected}`, () => {
      const r = routeQuestion(s.q);
      expect(r.intent).toBe(s.expected);
    });
  }

  it('reports isSubAdvisor=true for existing advisor packages', () => {
    expect(routeQuestion('scope 1 emissions estimate').isSubAdvisor).toBe(true);
    expect(routeQuestion('should we expand to Mombasa').isSubAdvisor).toBe(true);
  });

  it('reports isSubAdvisor=false for brain-direct intents', () => {
    expect(routeQuestion('my lease ends next month').isSubAdvisor).toBe(false);
    expect(routeQuestion('water leak in my bathroom').isSubAdvisor).toBe(false);
    expect(routeQuestion('market rate for 2-bed unit').isSubAdvisor).toBe(false);
    expect(routeQuestion('safety in the neighborhood').isSubAdvisor).toBe(false);
  });

  it('emits dataNeeds appropriate to the intent', () => {
    expect(routeQuestion('water leak').dataNeeds).toContain('own-maintenance');
    expect(routeQuestion('market rate 2-bed Mikocheni').dataNeeds).toContain(
      'public-market-data',
    );
    expect(routeQuestion('my lease ends in 30 days').dataNeeds).toContain(
      'own-lease',
    );
  });

  it('falls through to general with score 0', () => {
    const r = routeQuestion('xyzzy plugh');
    expect(r.intent).toBe('general');
    expect(r.score).toBe(0);
  });
});
