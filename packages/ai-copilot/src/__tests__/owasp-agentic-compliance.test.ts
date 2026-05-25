/**
 * OWASP Agentic Top 10 compliance report tests — Wave-11.
 */

import { describe, it, expect } from 'vitest';
import {
  generateComplianceReport,
  evaluateTurnCompliance,
  OWASP_AGENTIC_TOP_10,
} from '../security/owasp-agentic-compliance.js';

describe('owasp-agentic-compliance', () => {
  it('report covers all 10 agentic risks', () => {
    const report = generateComplianceReport();
    expect(report.totalRisks).toBe(10);
    expect(report.covered + report.partial + report.uncovered).toBe(10);
    expect(report.complianceScore).toBeGreaterThan(0.9);
    expect(report.risks).toBe(OWASP_AGENTIC_TOP_10);
  });

  it('every descriptor references at least one file', () => {
    for (const d of OWASP_AGENTIC_TOP_10) {
      expect(d.coveredBy.length).toBeGreaterThan(0);
    }
  });

  it('per-turn compliance is allSatisfied when inputs green', () => {
    const res = evaluateTurnCompliance({
      promptShieldBlocked: false,
      piiRedacted: true,
      tenantIsolationOk: true,
      outputGuardBlocked: false,
      costBreakerState: 'closed',
      canaryClean: true,
      auditChainAppended: true,
    });
    expect(res.allSatisfied).toBe(true);
  });

  it('per-turn compliance flags tenant-isolation breach', () => {
    const res = evaluateTurnCompliance({
      promptShieldBlocked: false,
      piiRedacted: true,
      tenantIsolationOk: false,
      outputGuardBlocked: false,
      costBreakerState: 'closed',
      canaryClean: true,
      auditChainAppended: true,
    });
    expect(res.allSatisfied).toBe(false);
    expect(res.risks.find((r) => r.id === 'ASI05')?.satisfied).toBe(false);
  });
});
