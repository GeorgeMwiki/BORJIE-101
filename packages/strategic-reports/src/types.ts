/**
 * `@borjie/strategic-reports` — public types.
 *
 * PhD-grade report engine contracts. Every report — leasing financial,
 * conditional survey, acquisition IC memo, disposition, refinancing,
 * sustainability, expansion, tenant credit, rent-roll, annual estate
 * operating review — flows through the same five-stage pipeline:
 *
 *   spec  →  gather evidence  →  multi-LLM synthesis  →  cite & verify  →  render & sign
 *
 * The contracts in this file are the only thing every stage shares.
 * Renderers, advisor ports, brain ports, audit stores, and document
 * studio composers are wired in `index.ts` via `createReportEngine`.
 *
 * Research basis:
 *   - HBR "Building a competitive intelligence function" (2024)
 *   - Royal Institute of Chartered Surveyors (RICS) Red Book Global VPS
 *   - IFRS S1/S2 climate-disclosure rendering norms
 *   - Anthropic Citations API (https://claude.com/blog/introducing-citations-api)
 *   - Mixture-of-Agents (Wang et al. 2024)
 *
 * Cross-package deps (composed at the edge in `index.ts`, never imported here):
 *   - `@borjie/sustainability-advisor`     — GHG / TCFD / EU Taxonomy
 *   - `@borjie/acquisition-advisor`        — comps / DD / LOI / PSA
 *   - `@borjie/lifecycle-advisor`          — disposition / refi / IR
 *   - `@borjie/expansion-advisor`          — HBU / absorption / IRR
 *   - `@borjie/green-angle-advisor`        — green opportunities
 *   - `@borjie/user-context-store`         — tenant profile + signals
 *   - `@borjie/document-studio`            — Carbone / Typst / Puppeteer
 *   - `@borjie/ai-copilot`                 — multi-LLM synthesizer
 *
 * Concurrent-agent boundary (per task brief):
 *   - We DO NOT touch `services/scientific-discovery-sidecar/`, `infra/document-render/`,
 *     `packages/role-aware-advisor/`, `packages/user-context-store/src/`,
 *     `packages/carbon-market/`, or `apps/tenant-portal/`.
 */

import { z } from 'zod';

// ────────────────────────────────────────────────────────────────────────────
// Report family — the 10 explicit report types from the questionnaire memo +
// the advisor packages. Extending this requires (a) a new gatherer file,
// (b) a new composer file, (c) a new golden test, and (d) at least one
// jurisdictional template binding.
// ────────────────────────────────────────────────────────────────────────────

export const REPORT_TYPES = [
  'leasing_financial_performance',
  'conditional_survey_of_assets',
  'acquisition_deal_ic_memo',
  'disposition_memo_asset_profile',
  'refinancing_strategy_memo',
  'sustainability_ghg_report',
  'expansion_strategy_memo',
  'tenant_credit_risk_profile',
  'rent_roll_arrears_ledger',
  'annual_estate_operating_review',
] as const;

export type ReportType = (typeof REPORT_TYPES)[number];

export function isReportType(value: unknown): value is ReportType {
  return typeof value === 'string' && (REPORT_TYPES as ReadonlyArray<string>).includes(value);
}

// ────────────────────────────────────────────────────────────────────────────
// Output formats. Mirrors `@borjie/document-studio` deliberately so the
// renderer wiring does not have to translate between two enums.
// ────────────────────────────────────────────────────────────────────────────

export const REPORT_FORMATS = ['pdf', 'docx', 'pptx', 'html'] as const;
export type ReportFormat = (typeof REPORT_FORMATS)[number];

// ────────────────────────────────────────────────────────────────────────────
// Audience controls the persona override, the page budget, and the
// disclosure depth. Owner reports omit competitive intel; board reports
// include scenario analysis; regulator reports include statute citations.
// ────────────────────────────────────────────────────────────────────────────

export const REPORT_AUDIENCES = ['owner', 'board', 'regulator', 'internal'] as const;
export type ReportAudience = (typeof REPORT_AUDIENCES)[number];

export const REPORT_DEPTHS = ['executive', 'standard', 'deep'] as const;
export type ReportDepth = (typeof REPORT_DEPTHS)[number];

// Page-count budget per depth. Renderer surfaces a warning if exceeded.
export const PAGE_BUDGET: Readonly<Record<ReportDepth, { readonly target: number; readonly tolerance: number }>> =
  Object.freeze({
    executive: { target: 8, tolerance: 2 },
    standard: { target: 20, tolerance: 5 },
    deep: { target: 50, tolerance: 10 },
  });

// ────────────────────────────────────────────────────────────────────────────
// Jurisdictions — aligned with `@borjie/document-studio` + authz-policy.
// ────────────────────────────────────────────────────────────────────────────

// UNIV-4: hardcoded report-jurisdiction set — TZ launch beachhead + reserved EA + NG.
// Future jurisdictions: import this list from @borjie/jurisdiction-profiles registry.
// Tracked gh-issue (universal-from-day-one). See Docs/QA/UNIVERSAL_HARDCODE_SCRUB_2026_05_26.md.
export const REPORT_JURISDICTIONS = ['TZ', 'KE', 'UG', 'NG'] as const;
export type ReportJurisdiction = (typeof REPORT_JURISDICTIONS)[number];

// ────────────────────────────────────────────────────────────────────────────
// Scope — what the report is about. Discriminated by `kind` so the gatherer
// knows whether to call portfolio-level rollups, single-property advisors,
// or tenant-context profiles.
// ────────────────────────────────────────────────────────────────────────────

export type ReportScope =
  | { readonly kind: 'tenant'; readonly tenantPersonId: string; readonly orgId: string }
  | { readonly kind: 'property'; readonly propertyId: string; readonly orgId: string }
  | { readonly kind: 'portfolio'; readonly orgId: string; readonly propertyIds?: ReadonlyArray<string> }
  | {
      readonly kind: 'deal';
      readonly dealId: string;
      readonly orgId: string;
      readonly propertyId?: string;
    };

// ────────────────────────────────────────────────────────────────────────────
// Reporting period — every report carries one. Composers may degrade
// gracefully if the period is omitted (e.g. an acquisition IC for a deal
// that hasn't closed yet), but persistence + audit still demand a window.
// ────────────────────────────────────────────────────────────────────────────

export interface ReportPeriod {
  readonly periodStart: string; // ISO date
  readonly periodEnd: string; // ISO date
  /** e.g. 'FY26', '2026-Q2', 'Apr 2026'. Free-form for narrative. */
  readonly label: string;
}

// ────────────────────────────────────────────────────────────────────────────
// ReportSpec — the call-site contract for every report. The orchestrator
// validates this once and threads it through every downstream stage.
// ────────────────────────────────────────────────────────────────────────────

export const ReportSpecSchema = z.object({
  type: z.enum(REPORT_TYPES),
  scope: z.union([
    z.object({
      kind: z.literal('tenant'),
      tenantPersonId: z.string().min(1),
      orgId: z.string().min(1),
    }),
    z.object({
      kind: z.literal('property'),
      propertyId: z.string().min(1),
      orgId: z.string().min(1),
    }),
    z.object({
      kind: z.literal('portfolio'),
      orgId: z.string().min(1),
      propertyIds: z.array(z.string().min(1)).optional(),
    }),
    z.object({
      kind: z.literal('deal'),
      dealId: z.string().min(1),
      orgId: z.string().min(1),
      propertyId: z.string().min(1).optional(),
    }),
  ]),
  audience: z.enum(REPORT_AUDIENCES),
  depth: z.enum(REPORT_DEPTHS),
  format: z.enum(REPORT_FORMATS),
  jurisdiction: z.enum(REPORT_JURISDICTIONS),
  period: z.object({
    periodStart: z.string().min(1),
    periodEnd: z.string().min(1),
    label: z.string().min(1),
  }),
  /** Free-text request from the caller — anchors the persona's framing. */
  prompt: z.string().min(1).max(4000).optional(),
  /** Caller identity for the WORM audit chain. */
  actorId: z.string().min(1),
  correlationId: z.string().min(1).optional(),
});

export type ReportSpec = z.infer<typeof ReportSpecSchema>;

// ────────────────────────────────────────────────────────────────────────────
// Citation — every quantitative claim, statute reference, and signed-off
// finding must carry one. Mirrors `@borjie/document-studio`'s Citation
// shape so the verifier in `document-studio/citations/` can be wired
// straight in without a translation layer.
// ────────────────────────────────────────────────────────────────────────────

export const CitationSchema = z.object({
  id: z.string().min(1),
  claim: z.string().min(1),
  source: z.object({
    kind: z.enum([
      'ledger_entry',
      'lease',
      'invoice',
      'message',
      'photo',
      'statute',
      'tenant_record',
      'computation',
      'survey',
      'advisor_output',
      'external',
    ]),
    ref: z.string().min(1),
    url: z.string().url().optional(),
  }),
  /** Optional confidence in [0,1] — surfaced by the persona to flag estimates. */
  confidence: z.number().min(0).max(1).optional(),
});

export type Citation = z.infer<typeof CitationSchema>;

// ────────────────────────────────────────────────────────────────────────────
// Chart + Table specs — structural only. The renderer turns these into
// SVG charts (for PDF/print) and Markdown/Carbone tables (for DOCX).
// ────────────────────────────────────────────────────────────────────────────

export interface ChartSeries {
  readonly name: string;
  readonly values: ReadonlyArray<number>;
}

export interface ChartSpec {
  readonly id: string;
  readonly title: string;
  readonly kind: 'line' | 'bar' | 'stacked_bar' | 'pie' | 'scatter';
  readonly xLabels: ReadonlyArray<string>;
  readonly series: ReadonlyArray<ChartSeries>;
  readonly yUnit?: string;
  /** Citation id(s) that ground the underlying figures. */
  readonly citationIds: ReadonlyArray<string>;
}

export interface TableSpec {
  readonly id: string;
  readonly title: string;
  readonly headers: ReadonlyArray<string>;
  readonly rows: ReadonlyArray<ReadonlyArray<string | number>>;
  readonly citationIds: ReadonlyArray<string>;
  /** Optional total row rendered with a top border in templates. */
  readonly totalRow?: ReadonlyArray<string | number>;
}

// ────────────────────────────────────────────────────────────────────────────
// Action plan — every report ends in one. Owner-assignable, dated,
// measurable. Empty action plans fail the quality-gate verifier.
// ────────────────────────────────────────────────────────────────────────────

export type ActionPriority = 'p0' | 'p1' | 'p2' | 'p3';

export interface ActionItem {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly owner: string;
  readonly dueDateIso: string;
  readonly priority: ActionPriority;
  /** What success looks like — must be measurable. */
  readonly successCriterion: string;
  /** Citations grounding the action in evidence from the report. */
  readonly citationIds: ReadonlyArray<string>;
}

// ────────────────────────────────────────────────────────────────────────────
// ReportSection — the building block. A report is an ordered list.
// ────────────────────────────────────────────────────────────────────────────

export interface ReportSection {
  readonly id: string;
  readonly title: string;
  /** Section depth — 1 = chapter, 2 = section, 3 = subsection. */
  readonly heading: 1 | 2 | 3;
  /** Rendered markdown narrative. Numeric claims must cite. */
  readonly body: string;
  readonly charts: ReadonlyArray<ChartSpec>;
  readonly tables: ReadonlyArray<TableSpec>;
  /**
   * When a gatherer fails to produce evidence for this section, the
   * composer emits a section with `body === ''` and this flag set so
   * the renderer can surface "Evidence unavailable — see appendix"
   * rather than silently dropping the section.
   */
  readonly evidenceUnavailable?: boolean;
}

// ────────────────────────────────────────────────────────────────────────────
// StrategicReport — the structured object the renderer consumes. Free
// of any rendering coupling so the same object can be re-rendered to a
// different format on the regenerate path without re-gathering.
// ────────────────────────────────────────────────────────────────────────────

export interface StrategicReport {
  readonly type: ReportType;
  readonly spec: ReportSpec;
  readonly title: string;
  /** ≤ 250 words. Quality-gated. */
  readonly executiveSummary: string;
  readonly sections: ReadonlyArray<ReportSection>;
  readonly citations: ReadonlyArray<Citation>;
  readonly charts: ReadonlyArray<ChartSpec>;
  readonly tables: ReadonlyArray<TableSpec>;
  /** ≥ 5 items. Quality-gated. */
  readonly actionPlan: ReadonlyArray<ActionItem>;
  readonly appendices: ReadonlyArray<ReportSection>;
  /** Multi-LLM synthesis metadata — surfaced to operators, not to readers. */
  readonly synthesis: {
    readonly agreement: number;
    readonly escalate: boolean;
    readonly proposerIds: ReadonlyArray<string>;
    readonly synthesizerId: string;
    readonly mode: 'merge' | 'jury' | 'race-verify';
  };
  /** Computed page count estimate from the renderer (post-render). */
  readonly estimatedPages?: number;
}

// ────────────────────────────────────────────────────────────────────────────
// Rendered artifact + persisted record. The renderer returns one; the
// engine persists it via the injected `ReportStore`. Download links are
// surfaced via the api-gateway routes.
// ────────────────────────────────────────────────────────────────────────────

export interface RenderedReportArtifact {
  readonly format: ReportFormat;
  readonly mimeType: string;
  readonly buffer: Uint8Array;
  readonly sha256: string;
}

export interface PersistedReport {
  readonly reportId: string;
  readonly orgId: string;
  readonly type: ReportType;
  readonly report: StrategicReport;
  readonly artifacts: ReadonlyArray<RenderedReportArtifact>;
  readonly auditEntryId: string;
  readonly createdAtIso: string;
}

// ────────────────────────────────────────────────────────────────────────────
// Errors — exhaustive enum so callers branch on the code, not the message.
// ────────────────────────────────────────────────────────────────────────────

export type ReportEngineErrorCode =
  | 'invalid_spec'
  | 'gather_failed_all_sources'
  | 'synthesis_failed'
  | 'citations_invalid'
  | 'page_budget_violated'
  | 'action_plan_too_small'
  | 'executive_summary_too_long'
  | 'render_failed'
  | 'persist_failed';

export interface ReportEngineError {
  readonly code: ReportEngineErrorCode;
  readonly message: string;
  readonly detail?: Readonly<Record<string, unknown>>;
}

export type ReportEngineResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ReportEngineError };

export function ok<T>(value: T): ReportEngineResult<T> {
  return { ok: true, value };
}

export function err<T>(code: ReportEngineErrorCode, message: string, detail?: Readonly<Record<string, unknown>>): ReportEngineResult<T> {
  return { ok: false, error: detail !== undefined ? { code, message, detail } : { code, message } };
}

// ────────────────────────────────────────────────────────────────────────────
// Quality gates — pure functions exported so callers (tests, the engine,
// the api-gateway route) all agree on the same rules.
// ────────────────────────────────────────────────────────────────────────────

export const EXECUTIVE_SUMMARY_WORD_LIMIT = 250;
export const MIN_ACTION_PLAN_ITEMS = 5;

export interface QualityGateViolation {
  readonly gate: 'executive_summary_too_long' | 'action_plan_too_small' | 'citations_missing' | 'page_budget_violated';
  readonly message: string;
  readonly detail?: Readonly<Record<string, unknown>>;
}

export function countWords(text: string): number {
  const cleaned = text.trim();
  if (cleaned.length === 0) return 0;
  return cleaned.split(/\s+/).length;
}

/**
 * Run the quality-gate checks that do NOT need a rendered page count.
 * The renderer runs the page-budget gate after measuring the artifact.
 */
export function runStructuralQualityGates(report: StrategicReport): ReadonlyArray<QualityGateViolation> {
  const violations: QualityGateViolation[] = [];

  const wordCount = countWords(report.executiveSummary);
  if (wordCount > EXECUTIVE_SUMMARY_WORD_LIMIT) {
    violations.push({
      gate: 'executive_summary_too_long',
      message: `Executive summary is ${wordCount} words (limit ${EXECUTIVE_SUMMARY_WORD_LIMIT}).`,
      detail: { wordCount, limit: EXECUTIVE_SUMMARY_WORD_LIMIT },
    });
  }

  if (report.actionPlan.length < MIN_ACTION_PLAN_ITEMS) {
    violations.push({
      gate: 'action_plan_too_small',
      message: `Action plan has ${report.actionPlan.length} items (minimum ${MIN_ACTION_PLAN_ITEMS}).`,
      detail: { count: report.actionPlan.length, minimum: MIN_ACTION_PLAN_ITEMS },
    });
  }

  // Action items must carry owner + due-date + success criterion. The
  // shape already requires them via the type — this catches degenerate
  // empty-string values that strict-mode TS cannot rule out at runtime.
  for (const item of report.actionPlan) {
    if (item.owner.trim().length === 0) {
      violations.push({
        gate: 'action_plan_too_small',
        message: `Action item ${item.id} is missing an owner.`,
        detail: { itemId: item.id },
      });
    }
    if (item.successCriterion.trim().length === 0) {
      violations.push({
        gate: 'action_plan_too_small',
        message: `Action item ${item.id} is missing a success criterion.`,
        detail: { itemId: item.id },
      });
    }
  }

  return Object.freeze(violations);
}

// ────────────────────────────────────────────────────────────────────────────
// Evidence pack — the gatherer-stage output. Composer takes this in and
// produces the StrategicReport draft (pre-citation-verification).
// ────────────────────────────────────────────────────────────────────────────

export interface EvidenceFragment {
  /** Stable id reused by the citation ([id]) and by the chart/table that grounds in it. */
  readonly id: string;
  readonly summary: string;
  readonly source: Citation['source'];
  /** Structured payload the composer may quote from. */
  readonly data?: Readonly<Record<string, unknown>>;
}

export interface EvidencePack {
  readonly type: ReportType;
  readonly spec: ReportSpec;
  readonly fragments: ReadonlyArray<EvidenceFragment>;
  readonly charts: ReadonlyArray<ChartSpec>;
  readonly tables: ReadonlyArray<TableSpec>;
  /**
   * Per-source health — when a gatherer's port throws / times out, the
   * orchestrator records it here so the composer can flag the gap rather
   * than silently dropping a section.
   */
  readonly sourceHealth: ReadonlyArray<{
    readonly sourceId: string;
    readonly status: 'ok' | 'partial' | 'unavailable';
    readonly note?: string;
  }>;
}

// ────────────────────────────────────────────────────────────────────────────
// Gatherer port — every report type implements this. Pure async function;
// the orchestrator injects the per-report advisor ports.
// ────────────────────────────────────────────────────────────────────────────

export interface GathererContext {
  readonly spec: ReportSpec;
  readonly now: () => Date;
}

export type Gatherer = (ctx: GathererContext) => Promise<EvidencePack>;

// ────────────────────────────────────────────────────────────────────────────
// Composer port — takes an EvidencePack + persona prompt, returns the
// StrategicReport (already with citations, charts, tables, action plan).
// ────────────────────────────────────────────────────────────────────────────

export interface ComposerContext {
  readonly evidence: EvidencePack;
  readonly persona: string;
  readonly spec: ReportSpec;
}

export type Composer = (ctx: ComposerContext) => Promise<StrategicReport>;

// ────────────────────────────────────────────────────────────────────────────
// Brain port — the multi-LLM synthesis hook. The engine wires the
// composer to this; in tests we substitute a deterministic echo brain.
// ────────────────────────────────────────────────────────────────────────────

export interface BrainSynthesizeArgs {
  readonly systemPrompt: string;
  readonly userPrompt: string;
  /** Mode hint for the multi-LLM synthesizer. */
  readonly mode?: 'merge' | 'jury' | 'race-verify';
}

export interface BrainSynthesizeResult {
  readonly content: string;
  readonly agreement: number;
  readonly escalate: boolean;
  readonly proposerIds: ReadonlyArray<string>;
  readonly synthesizerId: string;
  readonly mode: 'merge' | 'jury' | 'race-verify';
}

export interface BrainPort {
  synthesize(args: BrainSynthesizeArgs): Promise<BrainSynthesizeResult>;
}

// ────────────────────────────────────────────────────────────────────────────
// Document studio port — renderer + WORM signing. Wired in `index.ts`
// from `@borjie/document-studio`; tests pass an in-memory shim.
// ────────────────────────────────────────────────────────────────────────────

export interface RenderRequest {
  readonly report: StrategicReport;
  readonly format: ReportFormat;
  readonly templateRef?: string;
}

export interface DocumentStudioPort {
  render(req: RenderRequest): Promise<RenderedReportArtifact>;
}

export interface AuditEntry {
  readonly entryId: string;
  readonly orgId: string;
  readonly actorId: string;
  readonly reportType: ReportType;
  readonly reportId: string;
  readonly renderedSha256: string;
  readonly citationsSha256: string;
  readonly chainHash: string;
  readonly createdAtIso: string;
}

export interface AuditPort {
  append(entry: Omit<AuditEntry, 'entryId' | 'chainHash' | 'createdAtIso'>): Promise<AuditEntry>;
}

// ────────────────────────────────────────────────────────────────────────────
// Report store — persistence port. The api-gateway routes need list +
// fetch-by-id; the engine writes via `save`.
// ────────────────────────────────────────────────────────────────────────────

export interface ReportStoreListFilters {
  readonly orgId: string;
  readonly type?: ReportType;
  readonly sinceIso?: string;
  readonly untilIso?: string;
  readonly limit?: number;
}

export interface ReportStore {
  save(record: PersistedReport): Promise<PersistedReport>;
  get(reportId: string): Promise<PersistedReport | null>;
  list(filters: ReportStoreListFilters): Promise<ReadonlyArray<PersistedReport>>;
}

// ────────────────────────────────────────────────────────────────────────────
// Citation-verifier port — wired from `@borjie/document-studio/citations`.
// We re-state the function signature here so the engine doesn't have a
// hard import on document-studio at type-resolution time.
// ────────────────────────────────────────────────────────────────────────────

export interface CitationVerifierPort {
  verify(args: { text: string; citations: ReadonlyArray<Citation> }):
    | { readonly ok: true; readonly citedClaims: number }
    | {
        readonly ok: false;
        readonly missing: ReadonlyArray<{
          readonly fragment: string;
          readonly reason: 'numeric-uncited' | 'statute-uncited' | 'citation-id-not-found';
        }>;
      };
}
