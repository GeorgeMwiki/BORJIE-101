/**
 * `compose_anything_v1` — meta-tool for the universal-creation MD.
 *
 * The founder's correction (verbatim, captured in
 * `Docs/DESIGN/CAPABILITIES_UNIFICATION.md`):
 *
 * > "The power is for creating any doc or media at any moment. The
 * > intelligence and power is not necessarily for marketing and campaign
 * > alone. User can just say 'make this report' or 'make me this image for
 * > marketing this property' — and if you have the data (which you should),
 * > Borjie should be able to create anything since it has access to all
 * > tabs data etc for that org or user depending on user and need."
 *
 * Mr. Mwikila is a universal creator. The five atomic capabilities —
 * `research_v1`, `compose_tab_v1`, `compose_doc_v1`, `compose_media_v1`,
 * `compose_campaign_v1` — are invoked freely, in any combination, in any
 * order, in response to whatever the owner needs.
 *
 * This tool is the **dispatcher**: the owner says "make me X" in natural
 * language and the MD picks the smallest atomic capability that fits, then
 * actually invokes it and returns the produced artefact. The dispatcher is
 * Tier 0 (no side effects of its own); the chosen sub-tool may be Tier 0,
 * 1, or 2 and the owner-approval gate is raised at sub-tool dispatch time.
 *
 * Sibling specs (the five capabilities being unified):
 *  - Wave 17C / 18D / 18E — `Docs/DESIGN/DEEP_RESEARCH_SPEC.md`
 *  - Wave 17B / 18B / 18F — `Docs/DESIGN/ANTICIPATORY_UX_SPEC.md`
 *  - Wave 17D / 18C / 18G — `Docs/DESIGN/DOCUMENT_COMPOSITION_SPEC.md`
 *  - Wave 18N           — `Docs/DESIGN/MEDIA_GENERATION_SPEC.md`
 *  - Wave 18P           — `Docs/DESIGN/MARKETING_PROMOTION_SPEC.md`
 *
 * This file is a **pure value module** — no I/O, no Drizzle, no Anthropic
 * SDK imports. The kernel composition root wires the executor that
 * dispatches to the chosen capability's package; this module only exposes
 * the contract.
 */

/**
 * Authority tier ladder enforced across every Master Brain tool.
 * Mirrors `Docs/MASTER_BRAIN_AUTONOMY_MANIFESTO.md` §4.
 */
export type AuthorityTier = 0 | 1 | 2;

/**
 * Stable identifier for the five atomic capabilities that
 * `compose_anything_v1` may dispatch to.
 */
export type ComposeAnythingCapability =
  | 'research'
  | 'tab'
  | 'doc'
  | 'media'
  | 'campaign';

/**
 * Lightweight reference into the owner's joined org data. Resolved by the
 * downstream capability — the meta-tool just forwards the handle.
 */
export interface DataJoinRef {
  readonly kind: string;
  readonly id: string;
}

/**
 * Input to `compose_anything_v1`. The LLM dispatcher reads the owner's
 * natural-language intent + optional hints + optional explicit data
 * attachments and picks the smallest atomic capability that fits.
 */
export interface ComposeAnythingInput {
  /** Owner intent in plain language — e.g. "make me a hero image for PRL-001". */
  readonly intent_natural_language: string;
  /**
   * Optional owner override: forces the dispatcher to pick this capability
   * even if its own classifier disagrees. Reasoning still records the
   * override so audits can spot mismatches.
   */
  readonly hint_capability?: ComposeAnythingCapability;
  /**
   * Optional explicit data attachments the owner wants the chosen
   * capability to use. Capability-specific (e.g. a parcel ref for a media
   * recipe, a research session handle for a doc recipe).
   */
  readonly attach_data?: ReadonlyArray<DataJoinRef>;
}

/**
 * Output of `compose_anything_v1`. The artefact ref points to whatever the
 * chosen atomic capability produced (a research session, a tab schema, a
 * document, an image, or a campaign envelope).
 */
export interface ComposeAnythingOutput {
  readonly chosen_capability: ComposeAnythingCapability;
  /** Recipe id selected within the chosen capability's recipe registry. */
  readonly chosen_recipe_id: string;
  /** Artefact reference — kind matches the chosen capability's artefact shape. */
  readonly artifact_ref: { readonly kind: string; readonly id: string };
  /** Human-readable explanation of why this capability + recipe was picked. */
  readonly reasoning: string;
  /** Authority tier the chosen sub-tool ran at (0 = research, 1 = draft, 2 = execute). */
  readonly authority_tier: AuthorityTier;
  readonly cost_usd_cents: number;
  readonly duration_ms: number;
}

/**
 * Static description of the meta-tool. The kernel composition root
 * registers this descriptor against the tool-execution loop; the LLM sees
 * the description in its tool list and decides when to call it.
 */
export interface ComposeAnythingToolDescriptor {
  readonly id: 'compose_anything_v1';
  readonly authority_tier: 0;
  readonly description: string;
  readonly supported_capabilities: ReadonlyArray<ComposeAnythingCapability>;
}

/**
 * The descriptor itself. Frozen so downstream consumers cannot mutate it.
 *
 * Notes for the kernel composition root:
 *  - The dispatcher is Tier 0 because it has no side effects of its own.
 *    The chosen sub-tool's tier may be 0, 1, or 2 — the approval gate is
 *    raised at sub-tool dispatch time, never bypassed by the meta-tool.
 *  - The dispatcher's LLM reasoning string is hashed into the audit chain
 *    so a regulator can trace why the MD picked this capability for this
 *    intent.
 *  - The dispatcher does **not** synthesise new recipes. It selects an
 *    existing recipe from the chosen capability's registry. Recipe
 *    authoring is the dynamic-author worker's job (Wave 18M).
 */
export const composeAnythingV1Tool: ComposeAnythingToolDescriptor = Object.freeze({
  id: 'compose_anything_v1',
  authority_tier: 0,
  description: [
    'Pick the right creation capability for the owner intent and produce the artefact.',
    '',
    'Use this when the owner expresses a creation intent in natural language without',
    'naming the capability (e.g. "make me X", "draft this", "announce that"). The',
    'dispatcher classifies the intent, picks the smallest atomic capability that fits,',
    'invokes that capability, and returns the produced artefact.',
    '',
    'Atomic capabilities the dispatcher can choose:',
    '  - research   → `research_v1` (Wave 17C / 18D / 18E)',
    '  - tab        → `compose_tab_v1` (Wave 17B / 18B / 18F)',
    '  - doc        → `compose_doc_v1` (Wave 17D / 18C / 18G)',
    '  - media      → `compose_media_v1` (Wave 18N)',
    '  - campaign   → `compose_campaign_v1` (Wave 18P)',
    '',
    'Universal data access: every capability reads from the same',
    '`OrgUserDataContext` — available tabs, data joins (parcels, sites, contracts,',
    'KPIs, prices, FX), owner profile, corpus handle, research session handle,',
    'tenant brand. The dispatcher never asks "where is the data?".',
    '',
    'Tier 2 outputs (publish, file, send, pay) still gate on owner approval — the',
    'meta-tool never bypasses the authority ladder, it only picks the right Tier-2',
    'sub-tool to ask for.',
    '',
    'See `Docs/DESIGN/CAPABILITIES_UNIFICATION.md` for the full unification contract.',
  ].join('\n'),
  supported_capabilities: Object.freeze([
    'research',
    'tab',
    'doc',
    'media',
    'campaign',
  ] as const),
});

/**
 * Canonical tool id string the persona's `tools_allowed` allow-lists refer
 * to. Exported as a literal so persona modules can wire the meta-tool into
 * every mode without typoing the id.
 */
export const COMPOSE_ANYTHING_V1_TOOL_ID: 'compose_anything_v1' =
  'compose_anything_v1';
