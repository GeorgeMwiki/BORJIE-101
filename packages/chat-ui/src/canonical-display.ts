/**
 * Canonical user-facing display identity for Mr. Mwikila — chat-ui mirror.
 *
 * The user always sees ONE string in the chat UI:
 *   "Mr. Mwikila — Borjie's AI Managing Director".
 *
 * No specialisation subtitle. No agent_id. Mr. Mwikila is presented as
 * ONE intelligence that knows everything.
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
  /** Just the title. Used when the name is rendered separately. */
  title: "Borjie's AI Managing Director",
  /** The full single-string identity. Used everywhere a header
   *  prefers one inline label (chat panel header, intro greeting). */
  name_full: "Mr. Mwikila — Borjie's AI Managing Director",
} as const;

/**
 * Compile-time shape guard — guarantees any consumer that destructures
 * the constant gets a single, narrow record without optional fields.
 */
export type MrMwikilaCanonicalDisplay = typeof MR_MWIKILA_CANONICAL_DISPLAY;
