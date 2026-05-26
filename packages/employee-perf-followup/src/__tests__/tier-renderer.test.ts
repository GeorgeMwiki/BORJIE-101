import { describe, it, expect } from 'vitest';
import {
  renderCrossTenantView,
  renderTier,
  truncateToSentences,
} from '../tier/recipient-tier-renderer.js';
import type { EmployeeScorecard } from '../types.js';

function makeScorecard(
  overrides: Partial<EmployeeScorecard> = {},
): EmployeeScorecard {
  return {
    id: 'sc-1',
    tenant_id: 't1',
    employee_user_id: 'u1',
    date: '2026-05-26',
    role: 'foreman',
    kpis: [
      { kpi_id: 'foreman.tonnage_hauled_pct_of_plan', raw: 0.98, band: 0.9, contribution: 0.45 * 0.9 },
      { kpi_id: 'foreman.safety_incidents', raw: 0, band: 1.0, contribution: 0.3 * 1.0 },
      { kpi_id: 'foreman.briefings_on_time', raw: 1.0, band: 0.9, contribution: 0.15 * 0.9 },
      { kpi_id: 'foreman.stockpile_reconciliation_accuracy', raw: 0.97, band: 0.7, contribution: 0.1 * 0.7 },
    ],
    overall_score: 0.91,
    signals: { streak_days: 3, anomalies: ['kpi_best_in_class:foreman.safety_incidents'] },
    prev_hash: '',
    audit_hash: 'h1',
    created_at: '2026-05-27T06:00:00.000Z',
    ...overrides,
  };
}

const FULL_BODY =
  "Mwikila here. Yesterday Juma hauled 98 percent of plan, zero incidents on shift B. " +
  "Stockpile reconciliation hit 97 percent. Tomorrow let's tighten the loader queue at the south face.";

describe('truncateToSentences', () => {
  it('truncates to N sentences and appends an ellipsis', () => {
    const out = truncateToSentences(
      'One. Two. Three. Four.',
      2,
    );
    expect(out.startsWith('One. Two')).toBe(true);
    expect(out.endsWith('…')).toBe(true);
  });

  it('returns the original when shorter than N sentences', () => {
    const out = truncateToSentences('One only.', 5);
    expect(out).toBe('One only.');
  });
});

describe('renderTier — subject', () => {
  it('returns the full body verbatim', () => {
    const view = renderTier({
      scorecard: makeScorecard(),
      tier: 'subject',
      fullBody: FULL_BODY,
    });
    expect(view.tier).toBe('subject');
    expect(view.body).toBe(FULL_BODY);
    expect(view.counts.kpis_total).toBe(4);
    expect(view.counts.kpis_at_or_above).toBe(4);
    expect(view.streak_days).toBe(3);
    expect(view.aggregate).toBeUndefined();
  });
});

describe('renderTier — supervisor', () => {
  it('redacts PII-shaped identifiers and caps to 2 sentences', () => {
    const view = renderTier({
      scorecard: makeScorecard(),
      tier: 'supervisor',
      fullBody: FULL_BODY,
    });
    expect(view.tier).toBe('supervisor');
    expect(view.body.length).toBeGreaterThan(0);
    // The proper noun "Juma" must be redacted.
    expect(view.body).not.toContain('Juma');
    expect(view.body).toContain('[redacted]');
    // Sentence cap — should contain at most two sentence-terminating
    // punctuation marks (excluding the trailing ellipsis marker).
    const sentenceCount = (view.body.match(/[.!?](\s|$)/g) ?? []).length;
    expect(sentenceCount).toBeLessThanOrEqual(2);
    expect(view.body.endsWith('…')).toBe(true);
    // Counts + streaks still propagate.
    expect(view.counts.kpis_at_or_above).toBe(4);
    expect(view.streak_days).toBe(3);
  });

  it('redacts emails + long digit runs', () => {
    const view = renderTier({
      scorecard: makeScorecard(),
      tier: 'supervisor',
      fullBody: 'Contact juma@example.com or +255712345678 today.',
    });
    expect(view.body).toContain('[redacted-email]');
    expect(view.body).toContain('[redacted-num]');
  });
});

describe('renderTier — owner', () => {
  it('drops body and returns aggregate stats only', () => {
    const tenantCards: ReadonlyArray<EmployeeScorecard> = [
      makeScorecard({ employee_user_id: 'u1', overall_score: 0.91 }),
      makeScorecard({ employee_user_id: 'u2', overall_score: 0.6 }),
      makeScorecard({ employee_user_id: 'u3', overall_score: 0.95 }),
    ];
    const view = renderTier({
      scorecard: tenantCards[0]!,
      tier: 'owner',
      fullBody: FULL_BODY,
      tenantScorecardsForDate: tenantCards,
    });
    expect(view.tier).toBe('owner');
    expect(view.body).toBe('');
    expect(view.aggregate?.n_employees).toBe(3);
    expect(view.aggregate?.mean_score).toBeCloseTo((0.91 + 0.6 + 0.95) / 3, 3);
    expect(view.aggregate?.n_below_target).toBe(1);
    expect(view.aggregate?.n_exceeded).toBe(2);
  });
});

describe('renderTier — cross-tenant', () => {
  it('explicit cross-tenant view returns null (no sharing, even with consent)', () => {
    expect(renderCrossTenantView()).toBeNull();
  });
});
