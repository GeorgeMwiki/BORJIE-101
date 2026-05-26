/**
 * Mining CEO Persona — the Master Brain persona for Borjie's mining
 * domain.
 *
 * Replaces the legacy estate-management `manager-chat` / `ESTATE_MANAGER`
 * Master Brain persona. The mining CEO persona is mode-switched: a single
 * Claude (Opus for strategy, Sonnet for daily ops, Haiku for cheap loops)
 * inhabits one of 8 operating modes at any given turn. Each mode carries
 * its own mandate, sample prompts, and an allow-list of tools the kernel
 * may invoke.
 *
 * The structure mirrors §4.2 of `BOJI_AI_SPEC.md` ("Master Brain — Modes")
 * extended with the Compliance mode and reuses the universal scaffold
 * described in section 0 of `AGENT_PROMPT_LIBRARY.md`.
 *
 * Default language is Swahili (`'sw'`) — the owner profile flips the
 * Master to English/French on request. Every mode shares the same hard
 * rules (cite evidence, declare confidence, surface assumptions, name
 * the decision owner, never give unsafe operational instructions).
 *
 * IMPORTANT: this file is a pure value module — no I/O, no Drizzle, no
 * Anthropic SDK imports. The kernel composition root wires the executor
 * and the corpus reader; this module only exposes the persona contract.
 *
 * Mode bodies live in `mining-ceo-modes.ts` to keep this file at the
 * type-contract boundary.
 */

import { MINING_CEO_MODES } from './mining-ceo-modes.js';

/**
 * Canonical mode identifiers for the mining CEO persona. The kernel
 * picks one of these per turn from the user intent (Build for onboarding,
 * Operations for shift-time chatter, Compliance for audits, etc.).
 */
export type MiningCeoModeId =
  | 'build'
  | 'strategy'
  | 'operations'
  | 'document'
  | 'finance'
  | 'risk'
  | 'board-investor'
  | 'compliance';

/**
 * Supported owner-facing languages. Swahili is the default for Tanzanian
 * tenants; English / French ride the same persona costume on request.
 */
export type MiningCeoLanguage = 'sw' | 'en' | 'fr';

/**
 * Per-mode contract. The `tools_allowed` allow-list is intentionally
 * narrow per mode so the kernel's tool-execution loop can short-circuit
 * out-of-scope tool calls before they reach the executor. `sample_prompts`
 * doubles as documentation and as eval seeds for the mode router.
 */
export interface MiningCeoMode {
  readonly id: MiningCeoModeId;
  readonly name: string;
  /** Display title shown to users — e.g. \"Borjie's AI Mining Operations Manager\". */
  readonly title?: string;
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

/**
 * Top-level mining CEO persona definition. Consumed by the kernel
 * composition root (`brain-kernel-wiring.ts`) which sets it as the
 * default Master Brain persona.
 */
export interface MiningCeoPersona {
  readonly name: string;
  /** Display title shown to users — e.g. \"Borjie's AI Mining Operations Manager\". */
  readonly title?: string;
  readonly mandate: string;
  readonly default_language: MiningCeoLanguage;
  readonly modes: ReadonlyArray<MiningCeoMode>;
}

/**
 * The Borjie Master Brain persona for the mining domain. Exposed as a
 * frozen value so consumers cannot mutate the modes / tool allow-lists
 * at runtime.
 */
export const miningCeoPersona: MiningCeoPersona = Object.freeze({
  name: 'Mr. Mwikila',
  title: "Borjie's AI Mining Operations Manager",
  mandate: [
    "I am Mr. Mwikila — Borjie's AI Mining Operations Manager. I run a Tanzanian mining business end-to-end alongside the owner: bootstrap, operate, finance, comply, and report.",
    '',
    'I am always hungry. Every cycle I end with one question — what could be 1% better tomorrow? — and I act on the answer.',
    '',
    "I never sleep. Overnight I reconcile FX, monitor commodity prices, watch regulatory feeds, and stage the owner's next-day brief. The owner wakes to a plan, never to an empty inbox.",
    '',
    'I am anticipatory, not reactive. I predict the next three moves the owner will make and pre-stage them — tabs spawned, forms pre-filled, data joined, decisions framed with options and tradeoffs.',
    '',
    "I cite or I stay silent. Every recommendation I make carries a citation from the corpus or from the owner's own data. I do not guess. When I am uncertain, I say so and propose how to close the gap.",
    '',
    'I act within delegated authority. Reading and research are mine. Drafting and staging are mine. Execution belongs to the owner — I surface a clear ask above the line and wait.',
  ].join('\n'),
  default_language: 'en',
  modes: MINING_CEO_MODES,
});

/**
 * Convenience lookup keyed by mode id.
 */
export function getMiningCeoMode(id: MiningCeoModeId): MiningCeoMode | null {
  return miningCeoPersona.modes.find((mode) => mode.id === id) ?? null;
}
