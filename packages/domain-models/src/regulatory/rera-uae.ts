/**
 * UAE — RERA (Real Estate Regulatory Agency, Dubai).
 *
 * DEFERRED — ship structure only. UAE expansion is on the roadmap;
 * landing the placeholder now means a future agent can plug rules in
 * without touching the kernel's regulatory-mirror module.
 *
 * Empty rule set evaluates as "no match" in the mirror, which falls
 * through to the kernel's existing policy-gate path. The presence of
 * the jurisdiction in `REGULATORY_RULE_SETS` is what enables the
 * routing.
 */

import type { RegulatoryRuleSet } from './rules-types.js';

export const RERA_UAE: RegulatoryRuleSet = {
  jurisdiction: 'UAE',
  displayName: 'UAE RERA — placeholder (deferred)',
  statuteVersion: 'deferred',
  rules: [],
};
