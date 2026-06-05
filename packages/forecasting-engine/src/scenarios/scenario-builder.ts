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
import { acquireSiteScenario } from './library/acquire-site.js';
import { refinanceScenario } from './library/refinance.js';
import { raiseRoyaltyScenario } from './library/raise-royalty.js';
import { fireVendorScenario } from './library/fire-vendor.js';
import { waterMainCrisisScenario } from './library/water-main-crisis.js';
import { offtakeRenewalBatchScenario } from './library/offtake-renewal-batch.js';

const LIBRARY: ReadonlyArray<AnyScenario> = [
  asAnyScenario(acquireSiteScenario),
  asAnyScenario(refinanceScenario),
  asAnyScenario(raiseRoyaltyScenario),
  asAnyScenario(fireVendorScenario),
  asAnyScenario(waterMainCrisisScenario),
  asAnyScenario(offtakeRenewalBatchScenario),
];

export function listScenarios(): ReadonlyArray<AnyScenario> {
  return LIBRARY;
}

export function getScenario(name: string): AnyScenario | undefined {
  return LIBRARY.find((s) => s.name === name);
}

const KEYWORDS: ReadonlyArray<{ pattern: RegExp; name: string }> = [
  { pattern: /\b(acquire|buy|purchase)\b.*\b(site|concession|tenement|portfolio)\b/i, name: 'acquire-site' },
  { pattern: /\b(refinance|refi)\b/i, name: 'refinance' },
  { pattern: /\b(raise|increase|bump)\b.*\b(royalty|royalties)\b/i, name: 'raise-royalty' },
  { pattern: /\b(fire|drop|replace)\b.*\bvendor\b/i, name: 'fire-vendor' },
  { pattern: /\b(water|leak|crisis|cascade|burst)\b/i, name: 'water-main-crisis' },
  { pattern: /\b(renew|renewal)\b.*\b(offtakes?|supply\s+agreements?)\b/i, name: 'offtake-renewal-batch' },
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
