/**
 * Junior Architecture — the contract every Borjie junior implements.
 *
 * Wave 18V. The 27 domain juniors (mine-planner, safety, geology, fx-
 * treasury, marketplace, KYB, fleet, inventory, procurement, etc.) are
 * **MD-class within their domain**. Each one inherits Mr. Mwikila's
 * cognitive engine (Wave 18T), observability surface (18R), mutation
 * authority (18S), and brand discipline — bounded by a per-junior
 * `JuniorScope`.
 *
 * Spec: `docs/DESIGN/JUNIOR_ARCHITECTURE_SPEC.md` (Wave 18V).
 * MD reference: `packages/ai-copilot/src/personas/mining-ceo-persona.ts`.
 *
 * This module is the **contract surface** — pure types + value helpers.
 * The persona-runtime composition root wires each junior's
 * `JuniorPersona` into the kernel; the audience-resolver here is a stub
 * that the floating-chat surfaces (Wave 18W) will call to decide which
 * persona owns the turn.
 */

// ─────────────────────────────────────────────────────────────────────
// Audience taxonomy
// ─────────────────────────────────────────────────────────────────────

/**
 * Canonical user roles that can summon a junior or the MD. The
 * audience-resolver enforces a strict mapping from role -> permissible
 * agent set.
 *
 * - 'owner'      — apex decision-maker, sees Mr. Mwikila on every surface.
 * - 'admin'      — platform-level operator, sees Mr. Mwikila on every surface.
 * - 'manager'    — site manager / coordinator / department lead.
 * - 'employee'   — worker / field staff.
 * - 'customer'   — mineral buyer / external counterparty.
 * - 'regulator'  — Tumemadini / TRA / TanLII auditor.
 */
export type Audience =
  | 'owner'
  | 'admin'
  | 'manager'
  | 'employee'
  | 'customer'
  | 'regulator';

/**
 * Supported persona languages — same set the MD uses. Swahili is the
 * default for Tanzanian tenants; English / French ride the same persona
 * costume on request.
 */
export type JuniorLanguage = 'sw' | 'en' | 'fr';

// ─────────────────────────────────────────────────────────────────────
// Mode contract — mirrors MiningCeoMode
// ─────────────────────────────────────────────────────────────────────

/**
 * Per-mode contract for a junior. The kernel picks one mode per turn
 * from the user intent (e.g. `plan` for shift-planning chatter,
 * `escalate` when the junior detects it cannot answer in scope).
 *
 * `tools_allowed` is intentionally narrow per mode so the kernel's
 * tool-execution loop can short-circuit out-of-scope tool calls before
 * they reach the executor.
 */
export interface JuniorMode {
  readonly id: string;
  readonly name: string;
  readonly mandate: string;
  readonly sample_prompts: ReadonlyArray<string>;
  readonly tools_allowed: ReadonlyArray<string>;
  /**
   * Mode-specific system-prompt body. Includes the universal scaffold's
   * mandate slot, evidence requirements, and hard rules so the kernel
   * composition root can render the final SYSTEM envelope without
   * re-deriving the mode.
   */
  readonly system_prompt: string;
}

// ─────────────────────────────────────────────────────────────────────
// Scope envelope — what the junior may read and write
// ─────────────────────────────────────────────────────────────────────

/**
 * The domain envelope every junior carries. A junior cannot read or
 * write outside this envelope; the persona-runtime scope filter rejects
 * any tool call that targets an out-of-scope table or recipe.
 *
 * - `data_tables` — Drizzle table identifiers the junior may read/write.
 * - `tab_recipes_owned` — `compose_tab_v1` recipe ids the junior owns.
 * - `doc_recipes_owned` — `compose_doc_v1` recipe ids the junior owns.
 * - `media_recipes_owned` — `compose_media_v1` recipe ids the junior owns.
 * - `research_topics` — `research_v1` topic tags the junior is expert in.
 * - `authority_tier_max` — ceiling for `mutation_authority` proposals.
 *   0 = read-only, 1 = scoped propose, 2 = scoped propose with double-verify.
 * - `requires_md_for_tier_2` — if true the junior cannot stage T2
 *   proposals directly; it must escalate to Mr. Mwikila who stages on
 *   the junior's behalf.
 */
export interface JuniorScope {
  readonly data_tables: ReadonlyArray<string>;
  readonly tab_recipes_owned: ReadonlyArray<string>;
  readonly doc_recipes_owned: ReadonlyArray<string>;
  readonly media_recipes_owned: ReadonlyArray<string>;
  readonly research_topics: ReadonlyArray<string>;
  readonly authority_tier_max: 0 | 1 | 2;
  readonly requires_md_for_tier_2: boolean;
}

// ─────────────────────────────────────────────────────────────────────
// Escalation policy
// ─────────────────────────────────────────────────────────────────────

/**
 * When the junior escalates to Mr. Mwikila. All four conditions are
 * checked per turn; any one returning true triggers escalation.
 */
export interface EscalationPolicy {
  /**
   * If the user's intent requires a mutation above this tier, escalate
   * automatically. Typically set to `1` so anything Tier 2 escalates.
   */
  readonly auto_escalate_above_authority_tier: 1 | 2;
  /**
   * If the cognitive engine detects the user's intent spans this
   * junior's scope plus another junior's scope, escalate.
   */
  readonly auto_escalate_on_cross_domain: boolean;
  /**
   * If the cognitive engine returns confidence below the per-junior
   * threshold (default 0.4), escalate.
   */
  readonly auto_escalate_on_low_confidence: boolean;
  /**
   * If true, the junior summarises the turn so far and passes the
   * transcript to Mr. Mwikila on escalation. If false, the MD picks up
   * cold (rare — used only for critical safety / compliance handoffs
   * where the junior must not delay the MD).
   */
  readonly hand_off_transcript_to_mr_mwikila: boolean;
}

// ─────────────────────────────────────────────────────────────────────
// JuniorPersona — top-level contract
// ─────────────────────────────────────────────────────────────────────

/**
 * The full junior contract. Every junior package exports a frozen
 * `JuniorPersona` value; the persona-runtime composition root registers
 * it on boot. Failure to declare a scope, escalation policy, or target
 * audience list prevents registration.
 */
export interface JuniorPersona {
  /** Stable persona id — e.g. `'mining-shift-planner'`. */
  readonly id: string;
  /** Display name shown to users — e.g. `'Ms. Sifa'`. */
  readonly name: string;
  /** Title appended to the display name — e.g. `"Borjie's AI Shift-Planning Specialist"`. */
  readonly title: string;
  /** First-person mandate, <= 150 words. The "who I am" preamble. */
  readonly mandate: string;
  readonly default_language: JuniorLanguage;
  readonly modes: ReadonlyArray<JuniorMode>;
  readonly scope: JuniorScope;
  readonly target_audiences: ReadonlyArray<Audience>;
  /**
   * Tool allow-list at the persona level — every mode's `tools_allowed`
   * must be a subset of this set. Every junior gets `compose_anything_v1`
   * (the meta-dispatch tool) plus a curated allow-list per scope.
   */
  readonly tools_allowed: ReadonlyArray<string>;
  readonly mr_mwikila_escalation: EscalationPolicy;
}

// ─────────────────────────────────────────────────────────────────────
// Convenience lookups
// ─────────────────────────────────────────────────────────────────────

/**
 * Find a mode on a junior by id. Returns `null` when the id is unknown
 * so callers can fall back to the persona's default mode without
 * needing try/catch.
 */
export function getJuniorMode(
  persona: JuniorPersona,
  mode_id: string,
): JuniorMode | null {
  return persona.modes.find((mode) => mode.id === mode_id) ?? null;
}

/**
 * Quick check used by the persona-runtime scope filter — does the
 * persona own the given tab recipe?
 */
export function juniorOwnsTabRecipe(
  persona: JuniorPersona,
  recipe_id: string,
): boolean {
  return persona.scope.tab_recipes_owned.includes(recipe_id);
}

/**
 * Quick check — does the persona own the given doc recipe?
 */
export function juniorOwnsDocRecipe(
  persona: JuniorPersona,
  recipe_id: string,
): boolean {
  return persona.scope.doc_recipes_owned.includes(recipe_id);
}

/**
 * Quick check — does the persona own the given media recipe?
 */
export function juniorOwnsMediaRecipe(
  persona: JuniorPersona,
  recipe_id: string,
): boolean {
  return persona.scope.media_recipes_owned.includes(recipe_id);
}

/**
 * Quick check — is the persona authorised to be summoned by this
 * audience? The audience-resolver consults this when routing a
 * floating-chat turn.
 */
export function juniorServesAudience(
  persona: JuniorPersona,
  audience: Audience,
): boolean {
  return persona.target_audiences.includes(audience);
}

// ─────────────────────────────────────────────────────────────────────
// Audience-router — stub for Wave 18W
// ─────────────────────────────────────────────────────────────────────

/**
 * The user role that hit the floating chat. Distinct from `Audience` —
 * a role maps to one or more audiences (e.g. an admin sees both `owner`
 * and `admin` content; a buyer sees only `customer`).
 */
export type UserRole =
  | 'owner'
  | 'admin'
  | 'site_manager'
  | 'worker'
  | 'buyer'
  | 'regulator'
  | 'public';

/**
 * The decision returned by the audience-router. `agent_id` is either
 * `'mr-mwikila'`, `'mr-mwikila-public'`, or a junior persona id.
 * `reason` is a short machine-readable tag the audit-chain logs.
 */
export interface AgentResolution {
  readonly agent_id: string;
  readonly reason: string;
}

/**
 * Stub audience-router. The full version (Wave 18W) consults a
 * topic classifier + the junior registry to pick the most-relevant
 * junior for the utterance. Until then, owner/admin always get
 * Mr. Mwikila, public users get the public marketing variant, and
 * everyone else falls back to the MD until junior routing is wired.
 *
 * IMPORTANT: callers MUST NOT treat the fallback as a long-term
 * answer — it is intentional that non-apex roles see the MD until
 * the per-junior routing tables are populated.
 */
export function resolveAgentForUser(
  user_role: UserRole,
  utterance_topic: string | null,
): AgentResolution {
  // Owner / admin always route to Mr. Mwikila — apex audience.
  if (user_role === 'owner' || user_role === 'admin') {
    return { agent_id: 'mr-mwikila', reason: 'apex_audience' };
  }
  // Public surfaces (marketing pages) are already wired in Wave 14B —
  // they hit the public-corpus variant of Mr. Mwikila.
  if (user_role === 'public') {
    return { agent_id: 'mr-mwikila-public', reason: 'public_audience' };
  }
  // Site manager / worker / buyer / regulator: actual junior selection
  // is delegated to a junior-registry lookup keyed on topic + audience.
  // Until that is wired (Wave 18W), fall back to the MD with a clearly
  // tagged reason so the audit-chain shows the gap.
  const _ignored_until_wired = utterance_topic;
  return {
    agent_id: 'mr-mwikila',
    reason: 'fallback_to_md_pending_routing',
  };
}
