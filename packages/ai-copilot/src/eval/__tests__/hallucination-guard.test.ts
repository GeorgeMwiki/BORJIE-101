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
 *   - Jurisdiction-specific: consignment value out-of-range, royalty rate
 *     exceeded, notice period below statutory minimum, unknown jurisdiction.
 *   - guardDeliver holds unverified responses.
 *   - Default mining-ops bounds match all 4 BORJIE jurisdictions.
 */

import { describe, it, expect } from 'vitest';
import {
  verifyResponse,
  guardDeliver,
  DEFAULT_MINING_OPS_BOUNDS,
  type BrainResponse,
  type GuardContext,
  type MiningOpsBounds,
} from '../hallucination-guard.js';

function baseContext(overrides: Partial<GuardContext> = {}): GuardContext {
  return {
    allowedReasonCodes: ['QUALIFY_FAIL_KYC', 'SUSPEND_NON_PAYMENT'],
    regulationRegistry: [
      'TZ-MiningAct-2010-s.87',
      'TZ-MiningRegs-Royalty',
    ],
    toolRegistry: ['createSupplyAgreement', 'sendNotice'],
    miningOpsBounds: DEFAULT_MINING_OPS_BOUNDS,
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
      baseResponse({ reasonCodes: ['QUALIFY_FAIL_KYC', 'SUSPEND_NON_PAYMENT'] }),
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
        regulationCitations: ['TZ-MiningAct-2010-s.87'],
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
      baseResponse({ toolCall: { name: 'createSupplyAgreement', args: { id: 'a' } } }),
      baseContext(),
    );
    expect(result.verified).toBe(true);
  });

  it('flags missing citation when reason code present but text empty', () => {
    const result = verifyResponse(
      baseResponse({ text: '   ', reasonCodes: ['QUALIFY_FAIL_KYC'] }),
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
        regulationCitations: ['TZ-MiningAct-2010-s.87'],
      }),
      baseContext(),
    );
    expect(result.verified).toBe(false);
    expect(
      result.issues.some((i) => i.code === 'missing_citation'),
    ).toBe(true);
  });
});

describe('verifyResponse — mining-operations bounds', () => {
  it('passes a consignment value inside the TZ range', () => {
    const result = verifyResponse(
      baseResponse({
        miningClaim: {
          jurisdiction: 'TZ',
          consignmentValueMinorUnits: 120_000_000 * 100, // 120,000,000 TZS
        },
      }),
      baseContext(),
    );
    expect(result.verified).toBe(true);
  });

  it('fails when TZ consignment value is implausibly low', () => {
    const result = verifyResponse(
      baseResponse({
        miningClaim: {
          jurisdiction: 'TZ',
          consignmentValueMinorUnits: 100, // 1 TZS — obvious hallucination
        },
      }),
      baseContext(),
    );
    expect(result.verified).toBe(false);
    expect(result.issues[0]!.code).toBe('consignment_value_out_of_range');
  });

  it('fails when TZ royalty exceeds the 7% statutory ceiling', () => {
    const result = verifyResponse(
      baseResponse({
        miningClaim: {
          jurisdiction: 'TZ',
          consignmentValueMinorUnits: 100_000_000 * 100,
          royaltyMinorUnits: 100_000_000 * 100 * 0.1, // 10%, ceiling is 7%
        },
      }),
      baseContext(),
    );
    expect(result.verified).toBe(false);
    expect(result.issues[0]!.code).toBe('royalty_rate_exceeded');
    expect(result.issues[0]!.severity).toBe('critical');
  });

  it('passes when TZ royalty is exactly at the ceiling', () => {
    const result = verifyResponse(
      baseResponse({
        miningClaim: {
          jurisdiction: 'TZ',
          consignmentValueMinorUnits: 100_000_000 * 100,
          royaltyMinorUnits: 100_000_000 * 100 * 0.07, // exactly 7%
        },
      }),
      baseContext(),
    );
    expect(result.verified).toBe(true);
  });

  it('fails when TZ licence notice below statutory minimum', () => {
    const result = verifyResponse(
      baseResponse({
        miningClaim: {
          jurisdiction: 'TZ',
          licenceNoticeDays: 3, // below 30
        },
      }),
      baseContext(),
    );
    expect(result.verified).toBe(false);
    expect(result.issues[0]!.code).toBe('notice_period_below_min');
  });

  it('passes when NG licence notice meets statutory minimum', () => {
    const result = verifyResponse(
      baseResponse({
        miningClaim: {
          jurisdiction: 'NG',
          licenceNoticeDays: 30,
        },
      }),
      baseContext(),
    );
    expect(result.verified).toBe(true);
  });

  it('fails with unknown_jurisdiction when bounds not configured', () => {
    const result = verifyResponse(
      baseResponse({
        miningClaim: {
          jurisdiction: 'ZZ', // not in bounds
          consignmentValueMinorUnits: 100_000_000,
        },
      }),
      baseContext(),
    );
    expect(result.verified).toBe(false);
    expect(result.issues[0]!.code).toBe('unknown_jurisdiction');
  });

  it('skips mining-claim checks if no jurisdiction declared', () => {
    const result = verifyResponse(
      baseResponse({
        miningClaim: {
          consignmentValueMinorUnits: 1, // would fail if jurisdiction set
        },
      }),
      baseContext(),
    );
    expect(result.verified).toBe(true);
  });

  it('skips royalty check if consignment value missing', () => {
    const result = verifyResponse(
      baseResponse({
        miningClaim: {
          jurisdiction: 'KE',
          royaltyMinorUnits: 99_999_999_999,
        },
      }),
      baseContext(),
    );
    // No value -> can't compute pct -> no royalty_rate_exceeded issue.
    expect(
      result.issues.some((i) => i.code === 'royalty_rate_exceeded'),
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
        miningClaim: {
          jurisdiction: 'TZ',
          licenceNoticeDays: 1,
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

describe('DEFAULT_MINING_OPS_BOUNDS', () => {
  it('includes all 4 BORJIE primary jurisdictions', () => {
    expect(DEFAULT_MINING_OPS_BOUNDS['TZ']).toBeDefined();
    expect(DEFAULT_MINING_OPS_BOUNDS['KE']).toBeDefined();
    expect(DEFAULT_MINING_OPS_BOUNDS['UG']).toBeDefined();
    expect(DEFAULT_MINING_OPS_BOUNDS['NG']).toBeDefined();
  });

  it('uses minor currency units consistently', () => {
    for (const code of ['TZ', 'KE', 'UG', 'NG'] as const) {
      const b = DEFAULT_MINING_OPS_BOUNDS[code] as MiningOpsBounds;
      expect(b.minConsignmentValueMinorUnits).toBeGreaterThan(0);
      expect(b.maxConsignmentValueMinorUnits).toBeGreaterThan(b.minConsignmentValueMinorUnits);
      expect(b.maxRoyaltyPct).toBeGreaterThan(0);
      expect(b.minLicenceNoticeDays).toBeGreaterThanOrEqual(0);
    }
  });

  it('matches the statutory royalty ceiling from compliance-plugins (TZ = 7%)', () => {
    expect(DEFAULT_MINING_OPS_BOUNDS['TZ']!.maxRoyaltyPct).toBe(7);
  });

  it('sets a default-notice minimum from compliance-plugins (TZ = 30 days)', () => {
    expect(DEFAULT_MINING_OPS_BOUNDS['TZ']!.minLicenceNoticeDays).toBe(30);
  });

  it('sets a royalty ceiling for NG', () => {
    expect(DEFAULT_MINING_OPS_BOUNDS['NG']!.maxRoyaltyPct).toBeGreaterThan(0);
  });

  it('sets a royalty ceiling for UG', () => {
    expect(DEFAULT_MINING_OPS_BOUNDS['UG']!.maxRoyaltyPct).toBeGreaterThan(0);
  });
});
