/**
 * `discloseField` — the gate-keeper. Resolves "may I show this field to
 * a principal cleared to tier X?".
 *
 * Numeric tier semantics:
 *   SAFE (1)      ≤ everyone
 *   HIGH_RISK (2) ≤ HIGH_RISK & NEVER-cleared principals
 *   NEVER (3)     ≤ NEVER-cleared (security-team-only)
 *
 * Source: .research/r-ip-disclosure-capability-explanation-frontier.md §1
 */

import { FIELD_TIER } from './field-map.js';
import { type CapabilityField, DisclosureTier, type FieldDisclosureResult } from './types.js';

/**
 * Boolean shortcut — returns true if the principal's clearance is at
 * least as high as the field's tier.
 *
 * @param field one of the 30 known capability fields
 * @param principalTier the tier injected by `getDisclosureTierForPrincipal`
 */
export function discloseField(field: CapabilityField, principalTier: DisclosureTier): boolean {
  const fieldTier = FIELD_TIER[field];
  if (fieldTier === undefined) {
    // Unknown field — fail closed.
    return false;
  }
  return principalTier >= fieldTier;
}

/**
 * Verbose form — returns the full decision record for audit logging.
 */
export function discloseFieldWithReason(
  field: CapabilityField,
  principalTier: DisclosureTier
): FieldDisclosureResult {
  const fieldTier = FIELD_TIER[field];
  if (fieldTier === undefined) {
    return {
      field,
      fieldTier: DisclosureTier.NEVER,
      principalTier,
      allowed: false,
      reason: 'unknown-field-fail-closed',
    };
  }
  const allowed = principalTier >= fieldTier;
  const reason = allowed
    ? `principal cleared (tier ${String(principalTier)}) for field (tier ${String(fieldTier)})`
    : `principal tier ${String(principalTier)} below field tier ${String(fieldTier)}`;
  return { field, fieldTier, principalTier, allowed, reason };
}

/**
 * Bulk filter — given an object whose keys are CapabilityFields, drop
 * any keys the principal isn't cleared for. Returns a NEW immutable
 * shallow-cloned object (no mutation).
 */
export function filterDisclosurePayload<T extends Partial<Record<CapabilityField, unknown>>>(
  payload: T,
  principalTier: DisclosureTier
): { readonly disclosed: Partial<T>; readonly refused: readonly CapabilityField[] } {
  const disclosed: Record<string, unknown> = {};
  const refused: CapabilityField[] = [];
  for (const key of Object.keys(payload) as Array<keyof T & CapabilityField>) {
    if (discloseField(key, principalTier)) {
      disclosed[key as string] = payload[key];
    } else {
      refused.push(key);
    }
  }
  return Object.freeze({
    disclosed: disclosed as Partial<T>,
    refused: Object.freeze([...refused]),
  });
}
