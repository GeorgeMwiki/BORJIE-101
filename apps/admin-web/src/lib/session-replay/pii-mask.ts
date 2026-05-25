/**
 * PII mask for the rrweb session-replay recorder.
 *
 * The rrweb library has its own input/text masking knobs. This module
 * exposes the canonical "what to mask" configuration the recorder
 * threads into `rrweb.record()` so both inputs AND any element
 * explicitly tagged with `data-pii` (or known sensitive types) are
 * redacted at capture time.
 *
 * Hard rules (mirror the sensorium pii-redactor philosophy):
 *   - Every <input type="password" | tel | email | number> masked
 *   - Every node with `data-pii` attribute masked
 *   - Credit-card / national-ID / phone-number patterns blocked by
 *     element selector even if the input type is plain text
 *   - We mask by REPLACING text, not stripping the node — the replay
 *     viewer still shows the layout / interaction flow
 *
 * `maskAllInputs: true` is the default. We deliberately do NOT expose
 * an `unmask` knob — defaults are PII-safe; a future opt-in would be a
 * conscious decision in a follow-up wave.
 */

/**
 * Selector list for elements whose text must be masked. Wide net by
 * design — every match falls back to dotted-out characters in the
 * replay. The recorder hands this to rrweb's `maskTextSelector`.
 */
export const DEFAULT_MASK_TEXT_SELECTOR = [
  '[data-pii]',
  '[data-sensitive]',
  'input[type="password"]',
  'input[type="tel"]',
  'input[type="email"]',
  'input[type="number"]',
  'input[autocomplete*="cc"]',
  'input[autocomplete*="cv"]',
  'input[autocomplete*="exp"]',
  'input[name*="password" i]',
  'input[name*="ssn" i]',
  'input[name*="nida" i]',
  'input[name*="kra" i]',
  'input[name*="passport" i]',
  'input[name*="mpesa" i]',
  '[aria-label*="password" i]',
  '[aria-label*="card number" i]',
  '[aria-label*="cvv" i]',
].join(', ');

/**
 * The rrweb-compatible mask configuration. Recorder passes these
 * straight through to `rrweb.record({...})`. We keep this as a plain
 * object so the recorder file does not import rrweb's types here —
 * the cross-package type interaction is fragile when the dep isn't
 * installed yet.
 */
export interface RrwebMaskConfig {
  /** Mask every <input>/<textarea>/<select> value. PostHog default. */
  readonly maskAllInputs: boolean;
  /** CSS selector for element text that must be masked. */
  readonly maskTextSelector: string;
  /** Replace masked input values with this char (rrweb's default '*'). */
  readonly maskInputFn?: (text: string) => string;
  /** Replace masked text content with this char. */
  readonly maskTextFn?: (text: string) => string;
}

export function buildDefaultMaskConfig(): RrwebMaskConfig {
  return {
    maskAllInputs: true,
    maskTextSelector: DEFAULT_MASK_TEXT_SELECTOR,
    maskInputFn: (text) => '*'.repeat(text.length),
    maskTextFn: (text) => '•'.repeat(text.length),
  };
}

/**
 * Test-friendly predicate: a DOM element is considered PII-sensitive
 * when it matches the default selector. Exposed so the unit tests can
 * exercise the selector without depending on rrweb's runtime.
 */
export function isPiiElement(el: Element | null | undefined): boolean {
  if (!el || typeof el.matches !== 'function') return false;
  try {
    return el.matches(DEFAULT_MASK_TEXT_SELECTOR);
  } catch {
    return false;
  }
}

/**
 * Defence-in-depth: scrub any well-known PII patterns that slipped past
 * the rrweb selector — e.g. an element with an unmarked plain-text
 * input that happened to carry a credit-card number. The recorder's
 * `maskTextFn` invokes this on every text frame.
 */
const PII_PATTERNS: ReadonlyArray<RegExp> = [
  // Credit card (13-19 digits, with optional spaces / dashes).
  // eslint-disable-next-line security/detect-unsafe-regex -- bounded quantifier 13..19, runs on already-buffered ≤8KB telemetry frames
  /\b(?:\d[ -]*?){13,19}\b/g,
  // East African phone (+255/+254/+256 + 9 digits).
  /\+?2(?:54|55|56)[ -]?\d{3}[ -]?\d{3}[ -]?\d{3}\b/g,
  // KRA PIN / TIN: A + 9 digits + letter.
  /\bA\d{9}[A-Z]\b/g,
  // NIDA (TZ national ID): 20 digits, dashes optional.
  /\b\d{8}-?\d{5}-?\d{5}-?\d{2}\b/g,
  // M-Pesa transaction code (10 alphanumeric).
  /\b[A-Z0-9]{10}\b/g,
];

export function scrubPiiPatterns(input: string): string {
  if (!input) return input;
  let out = input;
  for (const re of PII_PATTERNS) {
    out = out.replace(re, (m) => '•'.repeat(m.length));
  }
  return out;
}
