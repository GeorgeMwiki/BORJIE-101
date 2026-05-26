/**
 * Canonical user-facing display identity for Mr. Mwikila — Borjie repo.
 *
 * The user always sees ONE string in the chat UI:
 *   "Mr. Mwikila — Borjie's AI Mining Operations Manager".
 *
 * No specialisation subtitle. No agent_id. No "drone imagery specialist"
 * or "geology advisor" suffix. Mr. Mwikila is presented as ONE
 * intelligence that knows everything.
 *
 * The specialisation / agent_id / internal subtitle continue to exist
 * in the data model for:
 *   - Backend routing (which specialisation logic the LLM draws from
 *     on each turn).
 *   - Audit logs (`agent_turns` and `cognitive_turns` capture the
 *     specialisation that produced each artifact).
 *   - Owner admin UI (the owner CAN see the active specialisation in
 *     the admin junior management panel — this is the ONLY surface
 *     that exposes the internal name).
 *
 * This module is intentionally tiny and side-effect free so every
 * surface (chat panel, floating widget, home shell, marketing pages)
 * can import the same constant and never drift.
 *
 * Spec: see Docs/DESIGN/CAPABILITIES_UNIFICATION.md "User-facing
 * identity is locked".
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
  title: "Borjie's AI Mining Operations Manager",
  /** The full single-string identity. Used everywhere a header
   *  prefers one inline label (chat panel header, intro greeting). */
  name_full: "Mr. Mwikila — Borjie's AI Mining Operations Manager",
} as const;

/**
 * Compile-time shape guard — guarantees any consumer that destructures
 * the constant gets a single, narrow record without optional fields.
 */
export type MrMwikilaCanonicalDisplay = typeof MR_MWIKILA_CANONICAL_DISPLAY;
