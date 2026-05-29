// Borjie buyer-mobile palette — LitFin-aligned (2026-05).
//
// Direction: "Midnight Slate Ledger with Warm-Gold Signal" — matches
// the marketing site, owner-web, and admin-web. Dark-navy slate
// foundation (#0B0F19), warm gold as the only signal, cream off-white
// type, emerald success, warm-red danger. Earth tones retained as
// soft accents so mining-context cards (provenance, weighbridge) still
// feel grounded.
//
// Field-tested for outdoor readability on cheap Android devices — the
// gold/cream contrast on the slate background lands at WCAG AA in
// direct sunlight tests.

export const colors = {
  // Foundation — LitFin navy-slate family
  forest: '#0B0F19',          // navy-slate primary background (was forest green)
  forestDeep: '#070A12',      // deeper pit / scroll well
  forestSoft: '#11151F',      // raised card / surface

  // Signal — warm gold (one brand color)
  gold: '#FFC857',            // LitFin hero gold (#FFC857)
  goldSoft: '#F5B23E',        // hover / pressed
  copper: '#FFD888',          // softer gold accent for runs
  earth: '#1E2330',           // hairline / divider on dark surfaces

  // Cream type stack
  cream: '#F5F5F0',           // hero / heading cream off-white
  sand: '#D8D6CB',            // body text on slate
  bone: '#FBF8F1',            // for the rare light pane
  ink: '#0B0F19',             // ink on light surfaces (cards)
  inkSoft: '#1E2330',         // softer ink
  inkMuted: '#A0A4B0',        // muted slate text

  // Lines + states
  line: '#1E2330',            // hairline rules
  steel: '#2A3245',           // input/chip border on slate — slightly lighter than line, reads as a soft outline on raised cards
  success: '#2EBD85',         // emerald confirmation
  successSoft: '#1B3D2E',
  warning: '#FFC857',         // gold doubles as warning
  warningSoft: '#3A2F18',
  danger: '#E14B4B',          // warm red
  dangerSoft: '#3A1F1F',
  white: '#FFFFFF'
} as const

export type ColorToken = keyof typeof colors
