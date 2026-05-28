/**
 * Mock insurance broker provider — Wave INSURANCE-BROKER.
 *
 * Deterministic in-process provider used as the default and in tests.
 * Returns three quote offers per request with declining premiums and
 * different exclusion sets so the policy register UI has a realistic
 * "compare" view to render. `bindPolicy()` synthesises a policy number
 * from a hash of the inputs so the same bind request always returns the
 * same number (idempotent).
 */

import { createHash, randomUUID } from 'node:crypto';
import type {
  BindRequest,
  BoundPolicy,
  CoverageType,
  InsuranceBrokerProvider,
  QuoteOffer,
  QuoteRequest,
} from './index';

const COVERAGE_BASE_RATES: Record<CoverageType, number> = {
  workforce: 0.028, // 2.8% of sum insured per annum
  plant: 0.018,
  environmental: 0.045,
  third_party: 0.015,
  transit: 0.012,
  political_risk: 0.085,
};

const COVERAGE_EXCLUSION_LIBRARY: Record<CoverageType, ReadonlyArray<string>> = {
  workforce: ['intentional_act', 'pre_existing_condition', 'war'],
  plant: ['flood_outside_csz', 'normal_wear', 'corrosion'],
  environmental: ['gradual_pollution', 'asbestos', 'nuclear'],
  third_party: ['contractual_liability', 'pollution'],
  transit: ['inadequate_packing', 'delay', 'inherent_vice'],
  political_risk: ['kinetic_terrorism', 'cyber'],
};

const PROVIDERS: ReadonlyArray<{
  readonly providerId: string;
  readonly rateMultiplier: number;
  readonly deductibleMultiplier: number;
}> = [
  { providerId: 'britam', rateMultiplier: 1.0, deductibleMultiplier: 0.015 },
  { providerId: 'nic', rateMultiplier: 0.92, deductibleMultiplier: 0.02 },
  { providerId: 'heritage', rateMultiplier: 0.88, deductibleMultiplier: 0.025 },
];

function hashRef(seed: string): string {
  return createHash('sha256').update(seed).digest('hex').slice(0, 16);
}

export function createMockBrokerProvider(): InsuranceBrokerProvider {
  return {
    id: 'mock_aggregate',
    displayName: 'Mock Aggregate Broker',
    async getQuotes(req: QuoteRequest): Promise<ReadonlyArray<QuoteOffer>> {
      const baseRate = COVERAGE_BASE_RATES[req.coverageType];
      const exclusionPool = COVERAGE_EXCLUSION_LIBRARY[req.coverageType];
      const validUntil = new Date(
        Date.now() + 14 * 24 * 60 * 60 * 1000,
      ).toISOString();
      return PROVIDERS.map((p) => {
        const premium = Math.round(
          req.sumInsuredTzs * baseRate * p.rateMultiplier,
        );
        const deductible = Math.round(
          req.sumInsuredTzs * p.deductibleMultiplier,
        );
        return {
          providerId: p.providerId,
          premiumTzs: premium,
          deductibleTzs: deductible,
          exclusions: exclusionPool,
          validUntilIso: validUntil,
        };
      });
    },
    async bindPolicy(req: BindRequest): Promise<BoundPolicy> {
      const policyNo = `${req.providerId.toUpperCase()}-${hashRef(
        `${req.providerId}|${req.providerQuoteRef}|${req.paymentRef}`,
      )}`;
      return {
        providerId: req.providerId,
        policyNo,
        effectiveAtIso: req.effectiveAtIso,
        expiresAtIso: req.expiresAtIso,
      };
    },
  };
}

/** Surface for tests so call sites can build deterministic providers. */
export { hashRef as __testHashRef };
export { randomUUID as __testRandomUUID };
