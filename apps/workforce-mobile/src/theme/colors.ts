/**
 * Borjie workforce-mobile palette — LitFin-aligned (2026-05).
 *
 * Same direction as buyer-mobile + marketing + owner-web:
 * "Midnight Slate Ledger with Warm-Gold Signal." Navy-slate dark
 * background (#0B0F19), warm gold (#FFC857) as the only signal,
 * cream off-white type, emerald success, warm-red danger.
 *
 * Tuned for outdoor field readability on cheap Android devices.
 * The gold/cream stack on slate hits WCAG AA in direct sunlight
 * tests; the earth-ramp tokens are retained as map / chart accents
 * (ore stope, drill-hole, geology layers) where mining context
 * still benefits from a brown undertone.
 */
export const colors = {
  // Foundation — LitFin navy-slate
  earth900: '#070A12',
  earth800: '#0B0F19',          // primary background
  earth700: '#11151F',          // raised surface
  earth500: '#1E2330',          // hairline / muted block
  earth300: '#3A4150',          // map accent
  earth100: '#A0A4B0',          // muted text on slate

  // Signal — warm gold
  goldDark: '#F5B23E',
  gold: '#FFC857',              // LitFin hero gold
  goldLight: '#FFD888',
  ore: '#B7651F',               // legacy mining accent for charts

  // Cream foundation for light cards
  surface: '#F5F5F0',           // cream
  surfaceAlt: '#FBF8F1',
  text: '#F5F5F0',              // cream text on slate (primary)
  textMuted: '#A0A4B0',         // muted slate text
  textInverse: '#0B0F19',       // dark text on cream cards
  border: '#1E2330',            // hairline rules on slate

  // Semantic
  success: '#2EBD85',
  warn: '#FFC857',
  danger: '#E14B4B',
  online: '#2EBD85',
  offline: '#E14B4B'
} as const

export type ColorKey = keyof typeof colors
