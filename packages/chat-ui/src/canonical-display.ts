/**
 * Canonical user-facing display identity for Mr. Mwikila — chat-ui mirror.
 *
 * The user always sees ONE string in the chat UI:
 *   "Mr. Mwikila — the brain layer within Borjie, an AI-native mining
 *   estate operating system".
 *
 * No specialisation subtitle. No agent_id. Mr. Mwikila is presented as
 * the brain layer within Borjie — an AI-native mining estate operating
 * system — and nothing more.
 *
 * This module is a mirror of `@borjie/agent-platform`'s
 * `canonical-display.ts` — the agent-platform module is the source of
 * truth for the backend; this module is the source of truth for the
 * UI surface. Both share the same strings; the chat-ui tests pin the
 * exact values so the two never drift.
 *
 * We mirror rather than import because chat-ui has no direct
 * dependency on agent-platform — the persona surface is intentionally
 * decoupled so the rendering layer can be swapped (web ↔ mobile ↔
 * marketing) without dragging the agent runtime in.
 *
 * Spec: Docs/DESIGN/CAPABILITIES_UNIFICATION.md "User-facing identity
 * is locked".
 */

/**
 * The single, immutable user-facing display identity. Every chat
 * surface in Borjie MUST render this and nothing more — no junior
 * subtitle, no agent_id, no specialisation chip.
 */
export const MR_MWIKILA_CANONICAL_DISPLAY = {
  /** Just the name. Used when the surface stacks name over title. */
  name: 'Mr. Mwikila',
  /**
   * The short role line a chat-panel HEADER renders under the name.
   * Bilingual, single language per active locale. This is what every
   * Mr. Mwikila chat surface shows beneath the name — NOT the long
   * brochure sentence (which now lives in `brochure`).
   */
  headerRole: {
    en: 'AI Mining Director',
    sw: 'Mkurugenzi wa Madini wa AI',
  },
  /**
   * The long brochure sentence. Kept ONLY for brochure / about copy
   * (e.g. the home-shell persona header), NOT for live-chat panel
   * headers, which render `headerRole`.
   */
  brochure:
    'The brain layer within Borjie — an AI-native mining estate operating system',
  /**
   * Back-compat alias for `brochure`. Retained so the home-shell
   * `PersonaHeader` (and its canonical-lock test) keep resolving while
   * the chat panels migrate to `headerRole`. New code should use
   * `headerRole` (chat header) or `brochure` (brochure copy).
   */
  title:
    'The brain layer within Borjie — an AI-native mining estate operating system',
  /** The full single-string identity. Used everywhere a header
   *  prefers one inline label (intro greeting, brochure label). */
  name_full:
    'Mr. Mwikila — the brain layer within Borjie, an AI-native mining estate operating system',
} as const;

/**
 * Compile-time shape guard — guarantees any consumer that destructures
 * the constant gets a single, narrow record without optional fields.
 */
export type MrMwikilaCanonicalDisplay = typeof MR_MWIKILA_CANONICAL_DISPLAY;
