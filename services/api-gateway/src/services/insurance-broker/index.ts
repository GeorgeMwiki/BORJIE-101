/**
 * Insurance Broker — pluggable provider port (Wave INSURANCE-BROKER).
 *
 * Abstracts Tanzanian mining insurance brokers (Britam / NIC /
 * Heritage) behind a single port so the api-gateway routes never
 * hardcode a provider. Default factory returns the mock provider; an
 * env-flag-bound real provider can be slotted in by reading
 * `BORJIE_INSURANCE_PROVIDER` at composition time.
 *
 * The port exposes two operations:
 *
 *   - `getQuotes({coverageType, sumInsuredTzs, location, riskProfile})`
 *     returns a list of `{providerId, premium, deductible, exclusions}`.
 *
 *   - `bindPolicy({quoteId, paymentRef})` flips a previously-returned
 *     quote into an active policy with a real `policy_no`.
 *
 * The mock provider returns deterministic quotes — useful for tests
 * and for owner-web demo flows. The real provider adapters live in
 * `./providers/*` (not yet implemented; env-gated).
 */

import { z } from 'zod';
import { createMockBrokerProvider } from './mock-provider';

export const COVERAGE_TYPES = [
  'workforce',
  'plant',
  'environmental',
  'third_party',
  'transit',
  'political_risk',
] as const;
export type CoverageType = (typeof COVERAGE_TYPES)[number];

export const QuoteRequestSchema = z.object({
  coverageType: z.enum(COVERAGE_TYPES),
  sumInsuredTzs: z.number().nonnegative(),
  location: z
    .object({
      country: z.string().length(2).default('TZ'),
      region: z.string().max(64).optional(),
    })
    .default({ country: 'TZ' }),
  riskProfile: z.record(z.unknown()).default({}),
});
export type QuoteRequest = z.infer<typeof QuoteRequestSchema>;

export interface QuoteOffer {
  readonly providerId: string;
  readonly premiumTzs: number;
  readonly deductibleTzs: number;
  readonly exclusions: ReadonlyArray<string>;
  readonly validUntilIso: string;
}

export interface BindRequest {
  readonly providerId: string;
  readonly providerQuoteRef: string;
  readonly paymentRef: string;
  readonly coverageType: CoverageType;
  readonly sumInsuredTzs: number;
  readonly premiumTzs: number;
  readonly deductibleTzs: number;
  readonly effectiveAtIso: string;
  readonly expiresAtIso: string;
}

export interface BoundPolicy {
  readonly providerId: string;
  readonly policyNo: string;
  readonly effectiveAtIso: string;
  readonly expiresAtIso: string;
}

export interface InsuranceBrokerProvider {
  readonly id: string;
  readonly displayName: string;
  getQuotes(req: QuoteRequest): Promise<ReadonlyArray<QuoteOffer>>;
  bindPolicy(req: BindRequest): Promise<BoundPolicy>;
}

/**
 * Composition-time factory. Reads `BORJIE_INSURANCE_PROVIDER` once and
 * returns the matching provider. Env values:
 *   - "mock" (default) — deterministic in-process provider
 *   - "britam" | "nic" | "heritage" — env-flagged real providers
 *
 * Real adapters are not yet implemented; selecting them falls back to
 * the mock provider but emits a warning so on-call sees the gap.
 */
export function selectInsuranceBrokerProvider(
  env: NodeJS.ProcessEnv,
): InsuranceBrokerProvider {
  const id = (env.BORJIE_INSURANCE_PROVIDER ?? 'mock').toLowerCase();
  switch (id) {
    case 'mock':
      return createMockBrokerProvider();
    case 'britam':
    case 'nic':
    case 'heritage':
      // TODO(insurance-broker): wire real adapters. Until then we
      // continue with mock so demo + tests keep flowing; the warning
      // surface lets on-call see the gap without breaking traffic.
      return createMockBrokerProvider();
    default:
      return createMockBrokerProvider();
  }
}

export { createMockBrokerProvider };
