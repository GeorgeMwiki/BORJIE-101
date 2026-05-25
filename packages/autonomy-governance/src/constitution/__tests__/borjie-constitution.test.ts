/**
 * Tests for the BORJIE Constitution v1.
 *
 * Verifies: 12 frozen clauses, unique ids, valid severities, jurisdiction
 * filter, action-tag filter, prompt render emits clause ids, getClause
 * lookup. Mirrors LITFIN test pattern (litfin-constitution.test.ts).
 */

import { describe, expect, it } from 'vitest';
import {
  BORJIE_CONSTITUTION_V1,
  clausesForAction,
  clausesForJurisdiction,
  getClause,
  renderConstitutionAsContext,
} from '../borjie-constitution.js';

describe('BORJIE_CONSTITUTION_V1', () => {
  it('ships exactly 12 frozen clauses', () => {
    expect(BORJIE_CONSTITUTION_V1.length).toBe(12);
    expect(Object.isFrozen(BORJIE_CONSTITUTION_V1)).toBe(true);
  });

  it('every clause has unique id, valid severity, non-empty citations', () => {
    const ids = new Set<string>();
    for (const c of BORJIE_CONSTITUTION_V1) {
      expect(ids.has(c.id)).toBe(false);
      ids.add(c.id);
      expect(['refuse', 'warn', 'inform']).toContain(c.severity);
      expect(c.citations.length).toBeGreaterThan(0);
      expect(c.appliesTo.length).toBeGreaterThan(0);
      expect(c.jurisdictions.length).toBeGreaterThan(0);
      expect(c.text.length).toBeGreaterThan(20);
      expect(c.title.length).toBeGreaterThan(3);
    }
  });

  it('ids follow the C##-SLUG pattern', () => {
    for (const c of BORJIE_CONSTITUTION_V1) {
      expect(c.id).toMatch(/^C\d{2}-[A-Z0-9-]+$/);
    }
  });

  it('covers TZ, KE, UG, NG, RW, ZA across the corpus', () => {
    const all = BORJIE_CONSTITUTION_V1.flatMap((c) => c.jurisdictions);
    for (const j of ['TZ', 'KE', 'UG', 'NG', 'RW', 'ZA']) {
      expect(all).toContain(j);
    }
  });

  it('all 12 expected clause ids are present', () => {
    const expected = [
      'C01-EVICTION-NOTICE',
      'C02-TENANT-DATA-PROTECTION',
      'C03-OWNER-FUNDS-SEGREGATION',
      'C04-RENT-CAPS-AND-ARREARS',
      'C05-NON-DISCRIMINATION',
      'C06-MOBILE-MONEY-TRANSPARENCY',
      'C07-HABITABILITY',
      'C08-HOUSEHOLD-PRIVACY',
      'C09-NO-AUTONOMOUS-FILING',
      'C10-HONEST-MARKETING',
      'C11-AUDIT-TRAIL-INTEGRITY',
      'C12-VENDOR-CONFLICT-DISCLOSURE',
    ];
    const got = BORJIE_CONSTITUTION_V1.map((c) => c.id);
    for (const e of expected) {
      expect(got).toContain(e);
    }
  });

  it('all citations reference real, named statutes (heuristic check)', () => {
    for (const c of BORJIE_CONSTITUTION_V1) {
      for (const cite of c.citations) {
        expect(cite.source.length).toBeGreaterThan(3);
        expect(cite.ref.length).toBeGreaterThan(3);
        // Refuse made-up placeholder citations like "TODO" or "TBD".
        expect(cite.source).not.toMatch(/TODO|TBD|FIXME|XXX/i);
        expect(cite.ref).not.toMatch(/TODO|TBD|FIXME|XXX/i);
      }
    }
  });
});

describe('clausesForAction', () => {
  it('returns the eviction clause for eviction.notice.send', () => {
    const out = clausesForAction('eviction.notice.send');
    const ids = out.map((c) => c.id);
    expect(ids).toContain('C01-EVICTION-NOTICE');
  });

  it('returns the trust-account clause for payment.disburse', () => {
    const out = clausesForAction('payment.disburse');
    expect(out.map((c) => c.id)).toContain('C03-OWNER-FUNDS-SEGREGATION');
  });

  it('returns empty for an unknown action tag (caller decides default)', () => {
    expect(clausesForAction('unknown.unmapped.action')).toHaveLength(0);
  });

  it('returns the non-discrimination clause for tenant screening', () => {
    expect(
      clausesForAction('tenant.screen.score').map((c) => c.id),
    ).toContain('C05-NON-DISCRIMINATION');
  });

  it('returns audit-integrity clause for audit.event.delete', () => {
    expect(
      clausesForAction('audit.event.delete').map((c) => c.id),
    ).toContain('C11-AUDIT-TRAIL-INTEGRITY');
  });
});

describe('clausesForJurisdiction', () => {
  it('global `*` clauses appear in every jurisdiction', () => {
    const ke = clausesForJurisdiction('KE');
    const tz = clausesForJurisdiction('TZ');
    const ids = (cs: ReadonlyArray<{ readonly id: string }>) =>
      cs.map((c) => c.id);
    expect(ids(ke)).toContain('C09-NO-AUTONOMOUS-FILING');
    expect(ids(tz)).toContain('C09-NO-AUTONOMOUS-FILING');
    expect(ids(ke)).toContain('C11-AUDIT-TRAIL-INTEGRITY');
    expect(ids(tz)).toContain('C11-AUDIT-TRAIL-INTEGRITY');
  });

  it('jurisdiction filter excludes clauses scoped to other countries', () => {
    // C03 OWNER-FUNDS-SEGREGATION is scoped to KE, TZ, UG, ZA only — not NG/RW.
    const ng = clausesForJurisdiction('NG');
    expect(ng.map((c) => c.id)).not.toContain('C03-OWNER-FUNDS-SEGREGATION');
    const rw = clausesForJurisdiction('RW');
    expect(rw.map((c) => c.id)).not.toContain('C03-OWNER-FUNDS-SEGREGATION');
  });

  it('chained filter (action then jurisdiction) composes correctly', () => {
    const evictionForKe = clausesForJurisdiction(
      'KE',
      clausesForAction('eviction.notice.send'),
    );
    expect(evictionForKe.map((c) => c.id)).toContain('C01-EVICTION-NOTICE');
  });

  it('jurisdiction filter omits scoped-out clauses even when action matches', () => {
    // C01 EVICTION-NOTICE is scoped to TZ, KE, UG, NG — not RW or ZA.
    const evictionForRw = clausesForJurisdiction(
      'RW',
      clausesForAction('eviction.notice.send'),
    );
    expect(evictionForRw.map((c) => c.id)).not.toContain('C01-EVICTION-NOTICE');
  });
});

describe('renderConstitutionAsContext', () => {
  it('emits header + every clause id when no filter is applied', () => {
    const block = renderConstitutionAsContext();
    expect(block).toMatch(/BORJIE CONSTITUTION v1/i);
    for (const c of BORJIE_CONSTITUTION_V1) {
      expect(block).toContain(c.id);
    }
  });

  it('action + jurisdiction filter renders a narrower context', () => {
    const block = renderConstitutionAsContext(
      'eviction.notice.send',
      'KE',
    );
    expect(block).toContain('C01-EVICTION-NOTICE');
    // Should not include unrelated clauses like vendor recommendation.
    expect(block).not.toContain('C12-VENDOR-CONFLICT-DISCLOSURE');
  });
});

describe('getClause', () => {
  it('returns the clause when id matches', () => {
    const c = getClause('C09-NO-AUTONOMOUS-FILING');
    expect(c).not.toBeNull();
    expect(c?.severity).toBe('refuse');
  });

  it('returns null for unknown id', () => {
    expect(getClause('C99-UNKNOWN')).toBeNull();
  });
});
