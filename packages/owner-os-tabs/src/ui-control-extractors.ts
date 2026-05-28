/**
 * Brain UI-control extractors — `<tab_redesign>`, `<dashboard_compose>`,
 * `<nav_rearrange>`.
 *
 * Wave BRAIN-UI-CONTROL. The brain doesn't just answer — it controls the
 * owner's UI. Three SSE tags let it propose layout changes the owner
 * Accepts (or Rejects) with one click:
 *
 *   <tab_redesign>{"tabId":"compliance","intent":"show_only",
 *     "panelLayout":{"hide":["fuelSparkline"],"show":["icaCertsExpiringTable"],
 *     "reorder":["heroMetrics","icaCertsExpiringTable","recentIncidents"]},
 *     "reason":"You asked about ICA certs — focusing the People tab on that.",
 *     "ttl":1800}</tab_redesign>
 *
 *   <dashboard_compose>{"tileOrder":["dailyBriefCard","icaCertsExpiring",
 *     "royaltyDraft","metricStrip","weekAheadStrip"],"hiddenTiles":
 *     ["sparklineFuel"],"reason":"You've been focused on cert expiries —
 *     pinning that to the top."}</dashboard_compose>
 *
 *   <nav_rearrange>{"order":["dashboard","compliance","people","finance",
 *     "sites","treasury","licences","marketplace","reports"],
 *     "reason":"Pushing Compliance up since you have 3 amber sub-areas today."}
 *   </nav_rearrange>
 *
 * Defensive policy (matches spawn-extractor):
 *   - Caps at ONE proposal per turn for each kind (system-prompt rule).
 *   - Strips the tag from the body even on validation failure.
 *   - Malformed JSON or schema-fail entries are dropped silently.
 *
 * The owner-os-tabs package owns the schema so both api-gateway and
 * owner-web import the same contract.
 */

import { z } from 'zod';

// ─── Shared primitives ──────────────────────────────────────────────

const blockIdSchema = z.string().min(1).max(80);
const tabIdSchema = z.string().min(1).max(160);
const reasonSchema = z.string().min(1).max(200);

// ─── tab_redesign ───────────────────────────────────────────────────

export const tabPanelLayoutOverrideSchema = z
  .object({
    /** Block ids the panel renderer should HIDE. */
    hide: z.array(blockIdSchema).max(20).optional(),
    /** Block ids the panel renderer should SHOW (force-include even if a
     *  prior override hid them). */
    show: z.array(blockIdSchema).max(20).optional(),
    /** Ordered block ids — drives the panel's render order. Unknown ids
     *  are dropped at render time. */
    reorder: z.array(blockIdSchema).max(40).optional(),
  })
  .strict();

export type TabPanelLayoutOverride = z.infer<typeof tabPanelLayoutOverrideSchema>;

/** Hint to the FE about how the redesign should be applied. */
export const tabRedesignIntentSchema = z.enum([
  /** Replace any existing override with this one. */
  'show_only',
  /** Merge into the current override (additive). */
  'augment',
  /** Clear all overrides (returns to declared defaults). */
  'reset',
]);

export type TabRedesignIntent = z.infer<typeof tabRedesignIntentSchema>;

export const tabRedesignProposalSchema = z
  .object({
    /** Stable id of the tab to reshape. */
    tabId: tabIdSchema,
    /** show_only | augment | reset. Defaults to show_only. */
    intent: tabRedesignIntentSchema.default('show_only'),
    /** Layout override payload. Required unless intent === 'reset'. */
    panelLayout: tabPanelLayoutOverrideSchema.optional(),
    /** Plain-text rationale shown to the owner. */
    reason: reasonSchema,
    /** Seconds until the override auto-reverts. Defaults to 1800 (30m). */
    ttl: z.number().int().min(60).max(86_400).default(1800),
  })
  .strict()
  .refine(
    (p) => p.intent === 'reset' || p.panelLayout !== undefined,
    {
      message: 'panelLayout is required unless intent is "reset"',
      path: ['panelLayout'],
    },
  );

export type TabRedesignProposal = z.infer<typeof tabRedesignProposalSchema>;

// ─── dashboard_compose ──────────────────────────────────────────────

export const dashboardComposeProposalSchema = z
  .object({
    /** Ordered list of tile ids — drives the composer render order. */
    tileOrder: z.array(blockIdSchema).min(1).max(20),
    /** Optional list of tile ids the composer should hide entirely. */
    hiddenTiles: z.array(blockIdSchema).max(20).optional(),
    /** Plain-text rationale shown to the owner. */
    reason: reasonSchema,
  })
  .strict();

export type DashboardComposeProposal = z.infer<typeof dashboardComposeProposalSchema>;

// ─── nav_rearrange ──────────────────────────────────────────────────

export const navRearrangeProposalSchema = z
  .object({
    /** Ordered list of sidebar item ids (top-first). */
    order: z.array(blockIdSchema).min(1).max(40),
    /** Plain-text rationale shown to the owner. */
    reason: reasonSchema,
  })
  .strict();

export type NavRearrangeProposal = z.infer<typeof navRearrangeProposalSchema>;

// ─── Tag patterns ──────────────────────────────────────────────────

const TAB_REDESIGN_PATTERN = /<tab_redesign>\s*(\{[\s\S]*?\})\s*<\/tab_redesign>/i;
const DASHBOARD_COMPOSE_PATTERN =
  /<dashboard_compose>\s*(\{[\s\S]*?\})\s*<\/dashboard_compose>/i;
const NAV_REARRANGE_PATTERN =
  /<nav_rearrange>\s*(\{[\s\S]*?\})\s*<\/nav_rearrange>/i;

// ─── Extractor primitives ───────────────────────────────────────────

function safeParseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

interface ExtractOne<T> {
  readonly body: string;
  readonly proposal: T | null;
}

function extractOne<T>(
  text: string,
  pattern: RegExp,
  schema: z.ZodTypeAny,
  /** Closing tag used for unscoped-strip fallback. */
  closingTagPattern: RegExp,
): ExtractOne<T> {
  let proposal: T | null = null;
  let body = text.replace(pattern, (_m, json: string) => {
    const parsed = safeParseJson(json);
    if (!parsed || typeof parsed !== 'object') return '';
    const validated = schema.safeParse(parsed);
    if (validated.success) proposal = validated.data as T;
    return '';
  });
  // Strip any extra unscoped tag fragments so the bubble never shows raw XML.
  body = body.replace(closingTagPattern, '');
  return { body, proposal };
}

// ─── Public extractors ──────────────────────────────────────────────

export interface ExtractTabRedesignResult {
  readonly body: string;
  readonly proposal: TabRedesignProposal | null;
}

export function extractTabRedesign(text: string): ExtractTabRedesignResult {
  return extractOne<TabRedesignProposal>(
    text,
    TAB_REDESIGN_PATTERN,
    tabRedesignProposalSchema,
    /<\/?tab_redesign>/gi,
  );
}

export interface ExtractDashboardComposeResult {
  readonly body: string;
  readonly proposal: DashboardComposeProposal | null;
}

export function extractDashboardCompose(
  text: string,
): ExtractDashboardComposeResult {
  return extractOne<DashboardComposeProposal>(
    text,
    DASHBOARD_COMPOSE_PATTERN,
    dashboardComposeProposalSchema,
    /<\/?dashboard_compose>/gi,
  );
}

export interface ExtractNavRearrangeResult {
  readonly body: string;
  readonly proposal: NavRearrangeProposal | null;
}

export function extractNavRearrange(text: string): ExtractNavRearrangeResult {
  return extractOne<NavRearrangeProposal>(
    text,
    NAV_REARRANGE_PATTERN,
    navRearrangeProposalSchema,
    /<\/?nav_rearrange>/gi,
  );
}
