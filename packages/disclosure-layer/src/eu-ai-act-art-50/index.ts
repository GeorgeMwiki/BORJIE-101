/**
 * EU AI Act Art. 50 — first-interaction AI disclosure.
 *
 * Source: .research/r-ip-disclosure-capability-explanation-frontier.md §5
 */

export {
  type DisclosureLocale,
  type DisclosureRequestInput,
  type DisclosureResult,
  type DisclosureSurface,
} from './types.js';
export { buildDisclosureText, DEFAULT_LOCALE } from './locales.js';
export {
  getMandatoryDisclosure,
  REQUIRED_SURFACES,
  ENFORCEMENT_DATE_UNIX_MS,
} from './disclosure.js';
