/**
 * Regulatory mirror — mining-jurisdiction rule data.
 *
 * Per-jurisdiction mining statutes that the kernel's regulatory-mirror
 * module consults at step 10 (policy gate). Each rule set is
 * intentionally a pure data structure — no I/O, no LLM. The kernel's
 * `regulatoryMirror` module owns the matching logic; this folder owns
 * the data.
 *
 * Currently shipped:
 *   - TZ — Mining Act, 2010 (as amended 2017) + Mineral Royalty regime
 *   - KE — Mining Act, 2016 + Mining (Mineral Royalty) Regulations
 *   - UAE — deferred; structure only so future tenants get a
 *     "not yet implemented" routing path instead of silent allow.
 */
import type { RegulatoryRuleSet } from './rules-types.js';
import { TZ_MINING_ACT } from './tz-mining-act.js';
import { KE_MINING_ACT } from './ke-mining-act.js';
import { UAE_MINING_PLACEHOLDER } from './uae-mining.js';

export * from './tz-mining-act.js';
export * from './ke-mining-act.js';
export * from './uae-mining.js';
export * from './rules-types.js';

/**
 * Default rule sets, in jurisdiction order. The kernel composition root
 * wires this into `createRegulatoryMirror({ ruleSets })`. Adding a
 * jurisdiction is a single-array edit here plus its rule-set file.
 */
export const REGULATORY_RULE_SETS: ReadonlyArray<RegulatoryRuleSet> = [
  TZ_MINING_ACT,
  KE_MINING_ACT,
  UAE_MINING_PLACEHOLDER,
];
