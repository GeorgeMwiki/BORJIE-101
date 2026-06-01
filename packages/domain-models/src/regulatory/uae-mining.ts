/**
 * UAE — minerals / mining regulator placeholder.
 *
 * DEFERRED — ship structure only. UAE is a gold-trade and refining hub
 * (DMCC / Dubai Good Delivery) rather than a primary extraction market;
 * landing the placeholder now means a future agent can plug rules in
 * (offtake / refining / re-export, LBMA-aligned fixings) without
 * touching the kernel's regulatory-mirror module.
 *
 * Empty rule set evaluates as "no match" in the mirror, which falls
 * through to the kernel's existing policy-gate path. The presence of
 * the jurisdiction in `REGULATORY_RULE_SETS` is what enables the
 * routing.
 */

import type { RegulatoryRuleSet } from './rules-types.js';

export const UAE_MINING_PLACEHOLDER: RegulatoryRuleSet = {
  jurisdiction: 'UAE',
  displayName: 'UAE minerals / gold-trade — placeholder (deferred)',
  statuteVersion: 'deferred',
  rules: [],
};
