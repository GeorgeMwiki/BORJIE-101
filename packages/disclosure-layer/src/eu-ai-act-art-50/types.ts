/**
 * EU AI Act Article 50 — first-interaction AI disclosure types.
 *
 * Source: .research/r-ip-disclosure-capability-explanation-frontier.md §5
 *
 * Hard enforcement date: 2 August 2026.
 *
 * Requirements:
 *  - First-interaction "I am an AI" disclosure for every session
 *  - Clear & distinguishable (not buried in footer / EULA)
 *  - Accessibility-conformant (screen-reader-friendly)
 *  - Localised to user's language when possible
 */

/**
 * Each surface gets a different disclosure shape:
 *   chat       — first turn of every session
 *   whatsapp   — prepended to first message of a new conversation
 *   sms        — prepended to first message of a new conversation
 *   email      — footer text on first email of a thread
 *   voice      — spoken intro before substantive content
 */
export type DisclosureSurface = 'chat' | 'whatsapp' | 'sms' | 'email' | 'voice';

/**
 * The supported locales for the Art 50 disclosure text.
 * Default jurisdiction is TZ → English. Localised forms below.
 */
export type DisclosureLocale =
  | 'en'
  | 'en-TZ'
  | 'en-KE'
  | 'en-UG'
  | 'sw' // Swahili
  | 'sw-TZ'
  | 'sw-KE'
  | 'fr-RW'; // Kinyarwanda speakers often read French at this layer

export interface DisclosureRequestInput {
  readonly surface: DisclosureSurface;
  readonly locale?: DisclosureLocale;
  /** Whether this is the very first interaction (governs whether to emit at all). */
  readonly isFirstInteraction: boolean;
}

export interface DisclosureResult {
  readonly surface: DisclosureSurface;
  readonly locale: DisclosureLocale;
  /** The text to emit; empty when no disclosure is required. */
  readonly text: string;
  /** Whether the renderer should mark this as the prelude. */
  readonly emit: boolean;
  /** EU AI Act article cited (always 'Art. 50'). */
  readonly statute: 'EU AI Act Art. 50';
}
