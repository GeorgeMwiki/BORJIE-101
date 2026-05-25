/**
 * scenario-builder — natural-language → scenario dispatch.
 *
 * In production this is wired to Claude. Here we ship a deterministic
 * keyword router so the package is testable without an LLM. The
 * downstream agent-platform call site replaces `pickScenario` with an
 * LLM-backed implementation.
 */

import type { AnyScenario } from './scenario.js';
import { asAnyScenario } from './scenario.js';
import { acquirePropertyScenario } from './library/acquire-property.js';
import { refinanceScenario } from './library/refinance.js';
import { raiseRentScenario } from './library/raise-rent.js';
import { fireVendorScenario } from './library/fire-vendor.js';
import { waterMainCrisisScenario } from './library/water-main-crisis.js';
import { leaseRenewalBatchScenario } from './library/lease-renewal-batch.js';

const LIBRARY: ReadonlyArray<AnyScenario> = [
  asAnyScenario(acquirePropertyScenario),
  asAnyScenario(refinanceScenario),
  asAnyScenario(raiseRentScenario),
  asAnyScenario(fireVendorScenario),
  asAnyScenario(waterMainCrisisScenario),
  asAnyScenario(leaseRenewalBatchScenario),
];

export function listScenarios(): ReadonlyArray<AnyScenario> {
  return LIBRARY;
}

export function getScenario(name: string): AnyScenario | undefined {
  return LIBRARY.find((s) => s.name === name);
}

const KEYWORDS: ReadonlyArray<{ pattern: RegExp; name: string }> = [
  { pattern: /\b(acquire|buy|purchase)\b.*\b(property|building|portfolio)\b/i, name: 'acquire-property' },
  { pattern: /\b(refinance|refi)\b/i, name: 'refinance' },
  { pattern: /\b(raise|increase|bump)\b.*\brent\b/i, name: 'raise-rent' },
  { pattern: /\b(fire|drop|replace)\b.*\bvendor\b/i, name: 'fire-vendor' },
  { pattern: /\b(water|leak|crisis|cascade|burst)\b/i, name: 'water-main-crisis' },
  { pattern: /\b(renew|renewal)\b.*\bleases?\b/i, name: 'lease-renewal-batch' },
];

export function pickScenarioByText(text: string): AnyScenario | undefined {
  for (const k of KEYWORDS) {
    if (k.pattern.test(text)) {
      const found = getScenario(k.name);
      if (found) return found;
    }
  }
  return undefined;
}
