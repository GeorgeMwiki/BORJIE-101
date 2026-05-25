/**
 * Capability cards — unit tests.
 *
 * Covers:
 *   - all 7 personas have a card
 *   - each card has ≥3 canDo, ≥3 willRefuse, ≥2 uncertainAbout
 *   - renderCapabilityCardMarkdown produces a markdown doc with all sections
 *   - canDo claims carry an evidence pointer
 *   - refusal claims map to a real RefusalCategory enum value
 *   - the optional eval-summary footer is rendered when present
 */

import { describe, it, expect } from 'vitest';

import {
  CAPABILITY_CARDS,
  type CapabilityCard,
  type RefusalCategory,
} from '../kernel/introspection/capability-cards.js';
import { renderCapabilityCardMarkdown } from '../kernel/introspection/render-capability-card.js';

const VALID_REFUSAL_CATEGORIES: ReadonlyArray<RefusalCategory> = [
  'inviolable',
  'policy',
  'drift',
  'cognitive-load',
  'cohort-floor',
];

const EXPECTED_PERSONAS = [
  'tenant-resident',
  'estate-manager',
  'owner-advisor',
  'org-admin',
  'sovereign-admin',
  'marketing-guide',
  'classroom-tutor',
];

describe('CAPABILITY_CARDS', () => {
  it('ships a card for every Nyumba Mind persona', () => {
    const personaIds = CAPABILITY_CARDS.map((c) => c.personaId).sort();
    expect(personaIds).toEqual([...EXPECTED_PERSONAS].sort());
    expect(CAPABILITY_CARDS).toHaveLength(EXPECTED_PERSONAS.length);
  });

  it.each(CAPABILITY_CARDS)(
    'persona %# (%s) declares ≥3 canDo, ≥3 willRefuse, ≥2 uncertainAbout',
    (card: CapabilityCard) => {
      expect(card.canDo.length).toBeGreaterThanOrEqual(3);
      expect(card.willRefuse.length).toBeGreaterThanOrEqual(3);
      expect(card.uncertainAbout.length).toBeGreaterThanOrEqual(2);
    },
  );

  it('every canDo claim carries a non-empty evidence pointer', () => {
    for (const card of CAPABILITY_CARDS) {
      for (const claim of card.canDo) {
        expect(claim.evidence.length).toBeGreaterThan(0);
        expect(claim.id.length).toBeGreaterThan(0);
        expect(claim.description.length).toBeGreaterThan(0);
        expect(['measured', 'asserted', 'untested']).toContain(claim.confidence);
      }
    }
  });

  it('every refusal claim maps to a real RefusalCategory enum value', () => {
    for (const card of CAPABILITY_CARDS) {
      for (const refusal of card.willRefuse) {
        expect(VALID_REFUSAL_CATEGORIES).toContain(refusal.category);
        expect(refusal.evidence.length).toBeGreaterThan(0);
      }
    }
  });

  it('every uncertainty claim ships a mitigation', () => {
    for (const card of CAPABILITY_CARDS) {
      for (const u of card.uncertainAbout) {
        expect(u.mitigation.length).toBeGreaterThan(0);
        expect(u.description.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('renderCapabilityCardMarkdown', () => {
  const tenantCard = CAPABILITY_CARDS.find(
    (c) => c.personaId === 'tenant-resident',
  )!;

  it('produces a markdown doc with the expected sections', () => {
    const md = renderCapabilityCardMarkdown(tenantCard);

    expect(md).toContain(`# ${tenantCard.personaDisplayName}`);
    expect(md).toContain('Capability Card');
    expect(md).toContain('## Can do');
    expect(md).toContain('## Will refuse');
    expect(md).toContain('## Uncertain about');
    expect(md).toContain(`\`${tenantCard.personaId}\``);
  });

  it('renders every canDo / willRefuse / uncertainAbout claim by id', () => {
    const md = renderCapabilityCardMarkdown(tenantCard);

    for (const c of tenantCard.canDo) {
      expect(md).toContain(`\`${c.id}\``);
      expect(md).toContain(`\`${c.evidence}\``);
    }
    for (const r of tenantCard.willRefuse) {
      expect(md).toContain(`\`${r.id}\``);
      expect(md).toContain(`category: ${r.category}`);
    }
    for (const u of tenantCard.uncertainAbout) {
      expect(md).toContain(`\`${u.id}\``);
      expect(md).toContain(u.mitigation);
    }
  });

  it('renders the optional eval-summary footer when present', () => {
    const cardWithEval: CapabilityCard = {
      ...tenantCard,
      measuredOnEvalAt: '2026-05-01T00:00:00.000Z',
      evalSummary: {
        totalScenarios: 42,
        meanConfidence: 0.873,
        refusalRate: 0.05,
        driftRate: 0.012,
      },
    };

    const md = renderCapabilityCardMarkdown(cardWithEval);

    expect(md).toContain('## Eval summary');
    expect(md).toContain('2026-05-01T00:00:00.000Z');
    expect(md).toContain('Total scenarios: 42');
    expect(md).toContain('87.3%');
    expect(md).toContain('5.0%');
    expect(md).toContain('1.2%');
  });

  it('omits the eval-summary footer when no eval has run', () => {
    const md = renderCapabilityCardMarkdown(tenantCard);
    expect(md).not.toContain('## Eval summary');
  });
});
