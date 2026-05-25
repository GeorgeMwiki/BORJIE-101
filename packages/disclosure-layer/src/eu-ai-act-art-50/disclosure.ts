/**
 * `getMandatoryDisclosure` — emit the surface-tailored EU AI Act Art. 50
 * first-interaction disclosure.
 *
 * Source: .research/r-ip-disclosure-capability-explanation-frontier.md §5
 */

import { DEFAULT_LOCALE, buildDisclosureText } from './locales.js';
import {
  type DisclosureRequestInput,
  type DisclosureResult,
  type DisclosureSurface,
} from './types.js';

/**
 * Return the disclosure block. If `isFirstInteraction` is false, returns
 * an empty-text result with `emit: false` so the caller can short-circuit.
 */
export function getMandatoryDisclosure(input: DisclosureRequestInput): DisclosureResult {
  const locale = input.locale ?? DEFAULT_LOCALE;
  if (!input.isFirstInteraction) {
    return Object.freeze({
      surface: input.surface,
      locale,
      text: '',
      emit: false,
      statute: 'EU AI Act Art. 50',
    });
  }
  const text = buildDisclosureText(input.surface, locale);
  return Object.freeze({
    surface: input.surface,
    locale,
    text,
    emit: true,
    statute: 'EU AI Act Art. 50',
  });
}

/**
 * The five legally-required surfaces. Used by callers that need to
 * confirm all surfaces are covered (e.g. compliance pipeline tests).
 */
export const REQUIRED_SURFACES: readonly DisclosureSurface[] = Object.freeze([
  'chat',
  'whatsapp',
  'sms',
  'email',
  'voice',
]);

/**
 * Aug 2 2026 hard deadline — exported for compliance dashboards.
 */
export const ENFORCEMENT_DATE_UNIX_MS: number = Date.UTC(2026, 7, 2); // Aug 2 2026 (month is 0-indexed)
