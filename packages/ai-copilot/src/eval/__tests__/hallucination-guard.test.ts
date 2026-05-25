/**
 * Tests for hallucination-guard — pure-function safety net.
 *
 * Coverage targets:
 *   - In-range pass: clean response verifies.
 *   - Out-of-bounds score fails.
 *   - Unknown reason code fails.
 *   - Unknown regulation fails.
 *   - Analytical answer with no DB result-set fails.
 *   - Analytical answer with unsupported number fails.
 *   - Unknown tool fails.
 *   - Missing-citation fail when text empty but citations present.
 *   - Jurisdiction-specific: rent out-of-range, deposit cap exceeded,
 *     notice period below statutory minimum, unknown jurisdiction.
 *   - guardDeliver holds unverified responses.
 *   - Default property-mgmt bounds match all 4 BORJIE jurisdictions.
 */

import { describe, it, expect } from 'vitest';
import {
  verifyResponse,
  guardDeliver,
  DEFAULT_PROPERTY_MGMT_BOUNDS,
  type BrainResponse,
  type GuardContext,
  type PropertyMgmtBounds,
} from '../hallucination-guard.js';

function baseContext(overrides: Partial<GuardContext> = {}): GuardContext {
  return {
    allowedReasonCodes: ['SCREEN_FAIL_CRB', 'EVICT_NON_PAYMENT'],
    regulationRegistry: [
      'KE-RentRestrictionAct-Cap296-§6',
      'TZ-LandLandlordTenantAct-§32',
    ],
    toolRegistry: ['createLease', 'sendNotice'],
    propertyMgmtBounds: DEFAULT_PROPERTY_MGMT_BOUNDS,
    ...overrides,
  };
}

function baseResponse(overrides: Partial<BrainResponse> = {}): BrainResponse {
  return {
    text: 'All good.',
    ...overrides,
  };
}

describe('verifyResponse — core checks', () => {
  it('passes a clean in-range response', () => {
    const result = verifyResponse(baseResponse(), baseContext());
    expect(result.verified).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('passes a clean scored response', () => {
    const result = verifyResponse(
      baseResponse({ score: 72, scoreMax: 100 }),
      baseContext(),
    );
    expect(result.verified).toBe(true);
  });

  it('fails when score is out of bounds (too high)', () => {
    const result = verifyResponse(
      baseResponse({ score: 150 }),
      baseContext(),
    );
    expect(result.verified).toBe(false);
    expect(result.issues[0]!.code).toBe('score_out_of_bounds');
    expect(result.issues[0]!.severity).toBe('critical');
  });

  it('fails when score is negative', () => {
    const result = verifyResponse(
      baseResponse({ score: -1 }),
      baseContext(),
    );
    expect(result.verified).toBe(false);
    expect(result.issues[0]!.code).toBe('score_out_of_bounds');
  });

  it('fails when score is NaN', () => {
    const result = verifyResponse(
      baseResponse({ score: Number.NaN }),
      baseContext(),
    );
    expect(result.verified).toBe(false);
    expect(result.issues[0]!.code).toBe('score_out_of_bounds');
  });

  it('respects custom scoreMax', () => {
    const result = verifyResponse(
      baseResponse({ score: 8, scoreMax: 10 }),
      baseContext(),
    );
    expect(result.verified).toBe(true);
  });

  it('fails when reason code is unknown', () => {
    const result = verifyResponse(
      baseResponse({ reasonCodes: ['NOT_A_REAL_CODE'] }),
      baseContext(),
    );
    expect(result.verified).toBe(false);
    expect(result.issues[0]!.code).toBe('unknown_reason_code');
    expect(result.issues[0]!.severity).toBe('high');
  });

  it('passes when all reason codes are in allow-list', () => {
    const result = verifyResponse(
      baseResponse({ reasonCodes: ['SCREEN_FAIL_CRB', 'EVICT_NON_PAYMENT'] }),
      baseContext(),
    );
    expect(result.verified).toBe(true);
  });

  it('fails when regulation citation is unknown', () => {
    const result = verifyResponse(
      baseResponse({ regulationCitations: ['Made-Up-Reg-2099'] }),
      baseContext(),
    );
    expect(result.verified).toBe(false);
    expect(result.issues[0]!.code).toBe('unknown_regulation');
  });

  it('passes when regulation citation is registered', () => {
    const result = verifyResponse(
      baseResponse({
        regulationCitations: ['KE-RentRestrictionAct-Cap296-§6'],
      }),
      baseContext(),
    );
    expect(result.verified).toBe(true);
  });
});

describe('verifyResponse — analytical / DB grounding', () => {
  it('fails analytical answer when no DB result-set provided', () => {
    const result = verifyResponse(
      baseResponse({ analytical: true, quotedNumbers: [42] }),
      baseContext({ dbResultNumbers: [] }),
    );
    expect(result.verified).toBe(false);
    expect(result.issues[0]!.code).toBe('unsupported_number');
    expect(result.issues[0]!.severity).toBe('critical');
  });

  it('fails analytical answer when quoted number not in DB', () => {
    const result = verifyResponse(
      baseResponse({ analytical: true, quotedNumbers: [100, 999] }),
      baseContext({ dbResultNumbers: [100, 200, 300] }),
    );
    expect(result.verified).toBe(false);
    expect(result.issues[0]!.code).toBe('unsupported_number');
  });

  it('passes analytical answer when all quoted numbers are grounded', () => {
    const result = verifyResponse(
      baseResponse({ analytical: true, quotedNumbers: [100, 200] }),
      baseContext({ dbResultNumbers: [100, 200, 300] }),
    );
    expect(result.verified).toBe(true);
  });

  it('respects numeric tolerance for floating-point comparison', () => {
    const result = verifyResponse(
      baseResponse({ analytical: true, quotedNumbers: [100.0000001] }),
      baseContext({ dbResultNumbers: [100], numericTolerance: 1e-3 }),
    );
    expect(result.verified).toBe(true);
  });

  it('skips numeric checks entirely when analytical=false', () => {
    const result = verifyResponse(
      baseResponse({ analytical: false, quotedNumbers: [999] }),
      baseContext({ dbResultNumbers: [1] }),
    );
    expect(result.verified).toBe(true);
  });
});

describe('verifyResponse — tool registry + citation discipline', () => {
  it('fails when tool call references unknown tool', () => {
    const result = verifyResponse(
      baseResponse({ toolCall: { name: 'dropDatabase', args: {} } }),
      baseContext(),
    );
    expect(result.verified).toBe(false);
    expect(result.issues[0]!.code).toBe('unknown_tool');
    expect(result.issues[0]!.severity).toBe('critical');
  });

  it('passes when tool call references registered tool', () => {
    const result = verifyResponse(
      baseResponse({ toolCall: { name: 'createLease', args: { id: 'a' } } }),
      baseContext(),
    );
    expect(result.verified).toBe(true);
  });

  it('flags missing citation when reason code present but text empty', () => {
    const result = verifyResponse(
      baseResponse({ text: '   ', reasonCodes: ['SCREEN_FAIL_CRB'] }),
      baseContext(),
    );
    expect(result.verified).toBe(false);
    expect(
      result.issues.some((i) => i.code === 'missing_citation'),
    ).toBe(true);
  });

  it('flags missing citation when regulation present but text empty', () => {
    const result = verifyResponse(
      baseResponse({
        text: '',
        regulationCitations: ['KE-RentRestrictionAct-Cap296-§6'],
      }),
      baseContext(),
    );
    expect(result.verified).toBe(false);
    expect(
      result.issues.some((i) => i.code === 'missing_citation'),
    ).toBe(true);
  });
});

describe('verifyResponse — property-management bounds', () => {
  it('passes a rent inside the TZ range', () => {
    const result = verifyResponse(
      baseResponse({
        propertyClaim: {
          jurisdiction: 'TZ',
          monthlyRentMinorUnits: 500_000 * 100, // 500_000 TZS
        },
      }),
      baseContext(),
    );
    expect(result.verified).toBe(true);
  });

  it('fails when TZ rent is implausibly low', () => {
    const result = verifyResponse(
      baseResponse({
        propertyClaim: {
          jurisdiction: 'TZ',
          monthlyRentMinorUnits: 100, // 1 TZS — obvious hallucination
        },
      }),
      baseContext(),
    );
    expect(result.verified).toBe(false);
    expect(result.issues[0]!.code).toBe('rent_out_of_range');
  });

  it('fails when KE deposit exceeds 3-month statutory cap', () => {
    const result = verifyResponse(
      baseResponse({
        propertyClaim: {
          jurisdiction: 'KE',
          monthlyRentMinorUnits: 50_000 * 100,
          depositMinorUnits: 50_000 * 100 * 6, // 6 months, cap is 3
        },
      }),
      baseContext(),
    );
    expect(result.verified).toBe(false);
    expect(result.issues[0]!.code).toBe('deposit_cap_exceeded');
    expect(result.issues[0]!.severity).toBe('critical');
  });

  it('passes when KE deposit is exactly at cap', () => {
    const result = verifyResponse(
      baseResponse({
        propertyClaim: {
          jurisdiction: 'KE',
          monthlyRentMinorUnits: 50_000 * 100,
          depositMinorUnits: 50_000 * 100 * 3, // exactly 3 months
        },
      }),
      baseContext(),
    );
    expect(result.verified).toBe(true);
  });

  it('fails when TZ eviction notice below statutory minimum', () => {
    const result = verifyResponse(
      baseResponse({
        propertyClaim: {
          jurisdiction: 'TZ',
          evictionNoticeDays: 3, // below 14
        },
      }),
      baseContext(),
    );
    expect(result.verified).toBe(false);
    expect(result.issues[0]!.code).toBe('notice_period_below_min');
  });

  it('passes when NG eviction notice meets statutory minimum', () => {
    const result = verifyResponse(
      baseResponse({
        propertyClaim: {
          jurisdiction: 'NG',
          evictionNoticeDays: 7,
        },
      }),
      baseContext(),
    );
    expect(result.verified).toBe(true);
  });

  it('fails with unknown_jurisdiction when bounds not configured', () => {
    const result = verifyResponse(
      baseResponse({
        propertyClaim: {
          jurisdiction: 'ZZ', // not in bounds
          monthlyRentMinorUnits: 100_000,
        },
      }),
      baseContext(),
    );
    expect(result.verified).toBe(false);
    expect(result.issues[0]!.code).toBe('unknown_jurisdiction');
  });

  it('skips property-claim checks if no jurisdiction declared', () => {
    const result = verifyResponse(
      baseResponse({
        propertyClaim: {
          monthlyRentMinorUnits: 1, // would fail if jurisdiction set
        },
      }),
      baseContext(),
    );
    expect(result.verified).toBe(true);
  });

  it('skips deposit check if monthly rent missing', () => {
    const result = verifyResponse(
      baseResponse({
        propertyClaim: {
          jurisdiction: 'KE',
          depositMinorUnits: 99_999_999_999,
        },
      }),
      baseContext(),
    );
    // No rent -> can't compute months -> no deposit_cap_exceeded issue.
    expect(
      result.issues.some((i) => i.code === 'deposit_cap_exceeded'),
    ).toBe(false);
  });
});

describe('verifyResponse — aggregation', () => {
  it('reports every issue, not just the first', () => {
    const result = verifyResponse(
      baseResponse({
        score: 500,
        reasonCodes: ['UNKNOWN'],
        regulationCitations: ['MADE-UP'],
        toolCall: { name: 'dropDatabase', args: {} },
        propertyClaim: {
          jurisdiction: 'TZ',
          evictionNoticeDays: 1,
        },
      }),
      baseContext(),
    );
    expect(result.verified).toBe(false);
    expect(result.issues.length).toBeGreaterThanOrEqual(5);
    const codes = result.issues.map((i) => i.code);
    expect(codes).toContain('score_out_of_bounds');
    expect(codes).toContain('unknown_reason_code');
    expect(codes).toContain('unknown_regulation');
    expect(codes).toContain('unknown_tool');
    expect(codes).toContain('notice_period_below_min');
  });
});

describe('guardDeliver', () => {
  it('delivers a verified response', () => {
    const r = baseResponse({ text: 'fine' });
    const delivery = guardDeliver(r, baseContext());
    expect(delivery.held).toBe(false);
    expect(delivery.response).toBe(r);
    expect(delivery.issues).toEqual([]);
  });

  it('holds an unverified response and surfaces issues', () => {
    const r = baseResponse({ score: 999 });
    const delivery = guardDeliver(r, baseContext());
    expect(delivery.held).toBe(true);
    expect(delivery.response).toBeUndefined();
    expect(delivery.issues.length).toBeGreaterThan(0);
  });
});

describe('DEFAULT_PROPERTY_MGMT_BOUNDS', () => {
  it('includes all 4 BORJIE primary jurisdictions', () => {
    expect(DEFAULT_PROPERTY_MGMT_BOUNDS['TZ']).toBeDefined();
    expect(DEFAULT_PROPERTY_MGMT_BOUNDS['KE']).toBeDefined();
    expect(DEFAULT_PROPERTY_MGMT_BOUNDS['UG']).toBeDefined();
    expect(DEFAULT_PROPERTY_MGMT_BOUNDS['NG']).toBeDefined();
  });

  it('uses minor currency units consistently', () => {
    for (const code of ['TZ', 'KE', 'UG', 'NG'] as const) {
      const b = DEFAULT_PROPERTY_MGMT_BOUNDS[code] as PropertyMgmtBounds;
      expect(b.minRentMinorUnits).toBeGreaterThan(0);
      expect(b.maxRentMinorUnits).toBeGreaterThan(b.minRentMinorUnits);
      expect(b.maxDepositMonths).toBeGreaterThan(0);
      expect(b.minEvictionNoticeDays).toBeGreaterThanOrEqual(0);
    }
  });

  it('matches the statutory cap from compliance-plugins (KE = 3 months)', () => {
    expect(DEFAULT_PROPERTY_MGMT_BOUNDS['KE']!.maxDepositMonths).toBe(3);
  });

  it('matches the statutory cap from compliance-plugins (TZ = 6 months)', () => {
    expect(DEFAULT_PROPERTY_MGMT_BOUNDS['TZ']!.maxDepositMonths).toBe(6);
  });

  it('matches the statutory cap from compliance-plugins (NG = 12 months)', () => {
    expect(DEFAULT_PROPERTY_MGMT_BOUNDS['NG']!.maxDepositMonths).toBe(12);
  });

  it('matches the statutory cap from compliance-plugins (UG = 3 months)', () => {
    expect(DEFAULT_PROPERTY_MGMT_BOUNDS['UG']!.maxDepositMonths).toBe(3);
  });
});
