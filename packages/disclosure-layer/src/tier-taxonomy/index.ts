/**
 * Tier-taxonomy — 3-tier IP-disclosure model.
 *
 * Source: .research/r-ip-disclosure-capability-explanation-frontier.md §1
 */

export {
  DisclosureTier,
  type CapabilityField,
  type FieldDisclosureResult,
} from './types.js';
export {
  FIELD_TIER,
  SAFE_FIELDS,
  HIGH_RISK_FIELDS,
  NEVER_FIELDS,
} from './field-map.js';
export {
  discloseField,
  discloseFieldWithReason,
  filterDisclosurePayload,
} from './disclose-field.js';
