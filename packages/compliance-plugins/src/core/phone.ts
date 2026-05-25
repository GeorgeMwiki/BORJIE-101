/**
 * Shared phone-normalization helper. Each country plugin builds its own
 * normalizer by calling `buildPhoneNormalizer({ dialingCode, trunkPrefix })`
 * rather than re-implementing the same stripping logic in six places.
 *
 * Output is E.164 with a leading '+' so it's safe to display or pass into
 * any PSTN / SMS gateway. Input is tolerant — accepts spaces, dashes,
 * parentheses — but rejects empty strings explicitly.
 */

import type { PhoneNormalizer } from './types.js';

export interface PhoneNormalizerOptions {
  /** International dialing prefix, no '+' (e.g. '255'). */
  readonly dialingCode: string;
  /** Optional trunk prefix stripped when present (e.g. '0' for TZ/KE/UG). */
  readonly trunkPrefix?: string;
}

export function buildPhoneNormalizer(
  options: PhoneNormalizerOptions
): PhoneNormalizer {
  const { dialingCode, trunkPrefix } = options;
  if (!dialingCode) {
    throw new Error('buildPhoneNormalizer: dialingCode is required');
  }
  return function normalize(rawPhone: string): string {
    if (!rawPhone || rawPhone.trim().length === 0) {
      throw new Error('normalizePhone: phone is empty');
    }
    let digits = rawPhone.replace(/\D+/g, '');
    // Order matters: a '+CC...' input already has the dialing code; strip
    // it before considering the trunk-prefix branch.
    if (digits.startsWith(dialingCode)) {
      digits = digits.slice(dialingCode.length);
    } else if (trunkPrefix && digits.startsWith(trunkPrefix)) {
      digits = digits.slice(trunkPrefix.length);
    }
    return `+${dialingCode}${digits}`;
  };
}
