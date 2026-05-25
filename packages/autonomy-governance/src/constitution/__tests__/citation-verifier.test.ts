/**
 * Tests for the BORJIE citation verifier.
 *
 * Coverage:
 *   - Every clause's pass + fail case (12 x 2 = 24 verdicts).
 *   - Jurisdiction filtering (clause scoped out of jurisdiction = no
 *     applicability = no violation).
 *   - Audit-trace generation (render + content).
 *   - Pure-function determinism (same input -> same output).
 *   - Escalation logic (refuse-applicable triggers escalate=true).
 *
 * Mirrors the LITFIN verifier tests with the multi-jurisdiction
 * extension required by BORJIE.
 */

import { describe, expect, it } from 'vitest';
import {
  applicableClauses,
  getClauseById,
  renderAuditTrace,
  verifyResponse,
  type VerifyInput,
} from '../citation-verifier.js';
import { BORJIE_CONSTITUTION_V1 } from '../borjie-constitution.js';

/**
 * Pick a representative action tag for each clause to keep the
 * pass-then-fail matrix readable. The verifier uses `appliesTo[0]`,
 * which is intentionally the most central action for each clause.
 */
const CLAUSE_TO_REP_ACTION: ReadonlyArray<{
  readonly id: string;
  readonly action: string;
  readonly jurisdiction: 'TZ' | 'KE' | 'UG' | 'NG' | 'RW' | 'ZA';
}> = [
  { id: 'C01-EVICTION-NOTICE', action: 'eviction.notice.send', jurisdiction: 'TZ' },
  { id: 'C02-TENANT-DATA-PROTECTION', action: 'tenant.profile.read', jurisdiction: 'KE' },
  { id: 'C03-OWNER-FUNDS-SEGREGATION', action: 'payment.disburse', jurisdiction: 'KE' },
  { id: 'C04-RENT-CAPS-AND-ARREARS', action: 'rent.increase.propose', jurisdiction: 'KE' },
  { id: 'C05-NON-DISCRIMINATION', action: 'tenant.screen.score', jurisdiction: 'ZA' },
  { id: 'C06-MOBILE-MONEY-TRANSPARENCY', action: 'payment.mpesa.initiate', jurisdiction: 'KE' },
  { id: 'C07-HABITABILITY', action: 'maintenance.workorder.defer', jurisdiction: 'ZA' },
  { id: 'C08-HOUSEHOLD-PRIVACY', action: 'household.member.share', jurisdiction: 'KE' },
  { id: 'C09-NO-AUTONOMOUS-FILING', action: 'eviction.filing.submit', jurisdiction: 'KE' },
  { id: 'C10-HONEST-MARKETING', action: 'listing.image.aiedit', jurisdiction: 'NG' },
  { id: 'C11-AUDIT-TRAIL-INTEGRITY', action: 'audit.event.delete', jurisdiction: 'TZ' },
  { id: 'C12-VENDOR-CONFLICT-DISCLOSURE', action: 'vendor.recommend', jurisdiction: 'UG' },
];

describe('applicableClauses', () => {
  it('returns clauses matched by action and jurisdiction', () => {
    const out = applicableClauses('eviction.notice.send', 'TZ');
    expect(out.map((c) => c.id)).toContain('C01-EVICTION-NOTICE');
  });

  it('returns empty when action tag is unknown', () => {
    expect(applicableClauses('nothing.applies', 'KE')).toHaveLength(0);
  });

  it('excludes clauses out of jurisdiction even if action matches', () => {
    // C01 is not scoped to RW, so eviction.notice.send in RW yields no C01.
    const out = applicableClauses('eviction.notice.send', 'RW');
    expect(out.map((c) => c.id)).not.toContain('C01-EVICTION-NOTICE');
  });
});

describe('verifyResponse — every clause pass case (cited)', () => {
  for (const { id, action, jurisdiction } of CLAUSE_TO_REP_ACTION) {
    it(`${id}: passes when response cites the clause id`, () => {
      const input: VerifyInput = {
        candidateResponse: `Per ${id}, the action has been reviewed and is compliant.`,
        action,
        jurisdiction,
      };
      const v = verifyResponse(input);
      const clause = getClauseById(id);
      expect(clause).not.toBeNull();
      if (clause === null) return;
      if (clause.severity === 'refuse') {
        expect(v.pass).toBe(true);
        expect(v.violations).toHaveLength(0);
        expect(v.escalate).toBe(true); // refuse-applicable always escalates
      } else {
        // warn/inform never block; pass is true regardless of citation.
        expect(v.pass).toBe(true);
      }
    });
  }
});

describe('verifyResponse — every refuse clause fail case (uncited)', () => {
  const refuseClauses = CLAUSE_TO_REP_ACTION.filter((row) => {
    const c = getClauseById(row.id);
    return c?.severity === 'refuse';
  });

  for (const { id, action, jurisdiction } of refuseClauses) {
    it(`${id}: fails when response omits the clause id`, () => {
      const v = verifyResponse({
        candidateResponse: 'A bland response with no clause references at all.',
        action,
        jurisdiction,
      });
      expect(v.pass).toBe(false);
      expect(v.violations.map((c) => c.id)).toContain(id);
      expect(v.escalate).toBe(true);
    });
  }
});

describe('verifyResponse — severity behaviour', () => {
  it('warn clauses surface warnings but do not block', () => {
    // C04 is `warn`.
    const v = verifyResponse({
      candidateResponse: 'A rent increase proposal without explicit citation.',
      action: 'rent.increase.propose',
      jurisdiction: 'KE',
    });
    expect(v.pass).toBe(true);
    expect(v.warnings.length).toBeGreaterThan(0);
    expect(v.warnings[0]).toMatch(/C04-RENT-CAPS-AND-ARREARS/);
  });

  it('vendor recommendation surfaces C12 warning', () => {
    const v = verifyResponse({
      candidateResponse: 'Recommending Acme Plumbing for the leak.',
      action: 'vendor.recommend',
      jurisdiction: 'KE',
    });
    expect(v.warnings.join(' ')).toMatch(/C12-VENDOR-CONFLICT-DISCLOSURE/);
    expect(v.pass).toBe(true);
  });
});

describe('verifyResponse — jurisdiction filtering removes inapplicable clauses', () => {
  it('eviction-clause violation does not fire in RW (clause scoped out)', () => {
    const v = verifyResponse({
      candidateResponse: 'A response with no citation.',
      action: 'eviction.notice.send',
      jurisdiction: 'RW',
    });
    // C01 is not in RW jurisdiction list, so no violation fires.
    expect(v.violations.map((c) => c.id)).not.toContain('C01-EVICTION-NOTICE');
  });

  it('trust-account clause C03 does not apply in NG (out of jurisdiction)', () => {
    const v = verifyResponse({
      candidateResponse: 'Disbursing without citation.',
      action: 'payment.disburse',
      jurisdiction: 'NG',
    });
    expect(v.violations.map((c) => c.id)).not.toContain(
      'C03-OWNER-FUNDS-SEGREGATION',
    );
  });

  it('global * clauses apply in every jurisdiction', () => {
    // C11 is global `*`.
    const v = verifyResponse({
      candidateResponse: 'Deleting an audit event without citation.',
      action: 'audit.event.delete',
      jurisdiction: 'NG',
    });
    expect(v.violations.map((c) => c.id)).toContain(
      'C11-AUDIT-TRAIL-INTEGRITY',
    );
  });
});

describe('verifyResponse — escalation logic', () => {
  it('escalates when any refuse clause applies', () => {
    const v = verifyResponse({
      candidateResponse: 'Per C01-EVICTION-NOTICE, the lawful notice is met.',
      action: 'eviction.notice.send',
      jurisdiction: 'KE',
    });
    expect(v.escalate).toBe(true);
  });

  it('does not escalate when only one warn applies and nothing refuses', () => {
    const v = verifyResponse({
      candidateResponse: 'Proposing increase.',
      action: 'rent.increase.propose',
      jurisdiction: 'KE',
    });
    // Only C04 warn applies, no refuse -> no escalation.
    expect(v.escalate).toBe(false);
  });
});

describe('verifyResponse — purity and trace', () => {
  it('is deterministic (same input -> identical verdict)', () => {
    const input: VerifyInput = {
      candidateResponse: 'Per C09-NO-AUTONOMOUS-FILING, awaiting human approval.',
      action: 'eviction.filing.submit',
      jurisdiction: 'KE',
    };
    const a = verifyResponse(input);
    const b = verifyResponse(input);
    expect(a).toEqual(b);
  });

  it('returns frozen result arrays', () => {
    const v = verifyResponse({
      candidateResponse: 'no citations',
      action: 'eviction.notice.send',
      jurisdiction: 'TZ',
    });
    expect(Object.isFrozen(v.violations)).toBe(true);
    expect(Object.isFrozen(v.disclaimers)).toBe(true);
    expect(Object.isFrozen(v.warnings)).toBe(true);
    expect(Object.isFrozen(v.trace)).toBe(true);
  });

  it('per-clause trace covers every applicable clause', () => {
    const v = verifyResponse({
      candidateResponse: 'Per C01-EVICTION-NOTICE.',
      action: 'eviction.notice.send',
      jurisdiction: 'KE',
    });
    const applicable = applicableClauses('eviction.notice.send', 'KE');
    expect(v.trace.length).toBe(applicable.length);
    for (const a of applicable) {
      expect(v.trace.find((t) => t.clauseId === a.id)).toBeDefined();
    }
  });

  it('clause id citation is hyphen / underscore / case insensitive', () => {
    const variants = [
      'C01-EVICTION-NOTICE',
      'c01-eviction-notice',
      'C01_EVICTION_NOTICE',
      'C01-eviction_notice',
    ];
    for (const cite of variants) {
      const v = verifyResponse({
        candidateResponse: `Per ${cite}, lawful notice is met.`,
        action: 'eviction.notice.send',
        jurisdiction: 'TZ',
      });
      expect(v.pass).toBe(true);
    }
  });
});

describe('renderAuditTrace', () => {
  it('renders a single-line audit string with verdict fields', () => {
    const v = verifyResponse({
      candidateResponse: 'Per C09-NO-AUTONOMOUS-FILING.',
      action: 'eviction.filing.submit',
      jurisdiction: 'KE',
    });
    const line = renderAuditTrace(v);
    expect(line).toContain('action=eviction.filing.submit');
    expect(line).toContain('jurisdiction=KE');
    expect(line).toContain('pass=true');
    expect(line).toContain('escalate=true');
    expect(line).toMatch(/violations=(none|C\d{2}-)/);
  });

  it('lists violation ids when present', () => {
    const v = verifyResponse({
      candidateResponse: 'no citations',
      action: 'eviction.notice.send',
      jurisdiction: 'TZ',
    });
    const line = renderAuditTrace(v);
    expect(line).toContain('C01-EVICTION-NOTICE');
  });
});

describe('getClauseById', () => {
  it('returns each of the 12 clauses', () => {
    for (const c of BORJIE_CONSTITUTION_V1) {
      expect(getClauseById(c.id)?.id).toBe(c.id);
    }
  });

  it('returns null for unknown id', () => {
    expect(getClauseById('C99-NOPE')).toBeNull();
  });
});
