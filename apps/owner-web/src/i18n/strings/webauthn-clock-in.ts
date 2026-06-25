/**
 * webauthn-clock-in — guard-exempt Swahili+English string table for
 * `components/workforce/WebAuthnClockIn.tsx`.
 *
 * WHY THIS FILE EXISTS
 * The kiosk clock-in widget used to hardcode every English label
 * (`'Authenticating...'`, `'Clocked in'`, the raw error message…) inline.
 * The locale-purity guard skips the `i18n/` tree, so the bilingual copy
 * lives here while the component renders via `pickByLocale(locale, …)`.
 *
 * SHAPE
 * Each leaf is `{ en, sw }`. The `biometricFailed` leaf is the distinct,
 * localised state for a FAILED / cancelled platform-authenticator check —
 * previously the WebAuthn failure was swallowed (the POST went through
 * with `biometricPassed: false` and the user saw nothing). `recordError`
 * is the localised mapping for a clock-in POST failure; the raw fetch /
 * SDK detail goes to the trace sink, never into this chrome.
 */

export const webAuthnClockInStrings = {
  authenticating: { en: 'Authenticating…', sw: 'Inathibitisha…' },
  recording: { en: 'Recording…', sw: 'Inarekodi…' },
  clockedIn: { en: 'Clocked in', sw: 'Umeingia kazini' },
  retry: { en: 'Retry clock-in', sw: 'Jaribu tena kuingia' },
  clockIn: { en: 'Clock in (WebAuthn)', sw: 'Ingia kazini (WebAuthn)' },
  // Distinct state for a failed / cancelled biometric check (no longer
  // swallowed) — the supervisor must re-run the authenticator.
  biometricFailed: {
    en: 'Biometric check did not pass. Try again.',
    sw: 'Uthibitisho wa kibiolojia haukufaulu. Jaribu tena.',
  },
  // Localised clock-in failure — the raw status / SDK error is traced, not
  // rendered.
  recordError: {
    en: 'Could not record the clock-in. Try again.',
    sw: 'Imeshindwa kurekodi kuingia kazini. Jaribu tena.',
  },
} as const;
