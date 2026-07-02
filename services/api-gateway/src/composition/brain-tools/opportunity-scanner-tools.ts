/**
 * Opportunity-Scanner — brain tool catalog (Wave UNWIRED-LOGIC-SWEEP-2).
 *
 * Wires the 33-rule opportunity scanner (`services/opportunity-scanner/`)
 * into the brain's persona-aware tool catalog. Previously the engine
 * shipped complete (rules + scanner + resolver) but no brain tool
 * existed and no UI path called it, leaving the entire upside-detection
 * surface dormant.
 *
 * Two tools surface here:
 *
 *   1. `mining.opportunities.scan`
 *        Read-only. Resolves a fresh `ScanState` for the current tenant,
 *        runs every rule in `SCAN_RULES`, returns the top N opportunities
 *        ranked by `expectedValueTzs × confidence × time urgency`. The
 *        brain calls this per turn from the owner home prompt and may
 *        emit ONE `opportunity_proposed` SSE block when a meaningful
 *        item surfaces.
 *
 *   2. `mining.opportunities.list_rules`
 *        Read-only. Lists every rule the engine carries with its id,
 *        kind, and short description. Used by the brain when the owner
 *        asks "what kinds of opportunities do you check for?" so the
 *        answer cites real rule ids instead of fabricating them.
 *
 * Persona binding: both tools target the T1 owner strategist persona
 * exclusively. The admin strategist (T2) gets the same surface only
 * when dogfooding against a specific tenant context.
 *
 * Tier discipline: every tool is `isWrite: false`, `stakes: 'LOW'`,
 * `requiresPolicyRuleLiteral: false`. The scanner has no side effects.
 *
 * Tenant isolation: handlers resolve `tenantId` from the persona
 * context. Brain tools run OUTSIDE the api-gateway databaseMiddleware, so
 * the scan handler binds the canonical `app.current_tenant_id` GUC itself
 * via `withTenantContext(...)` around the resolver reads — otherwise every
 * tenant-scoped SELECT returns 0 rows under FORCE-RLS. No tool reaches
 * across tenants.
 */

import { z } from 'zod';

import { withTenantContext } from '@borjie/database';

import {
  ALL_SCAN_RULES,
  OPPORTUNITY_KINDS,
  resolveScanStateReport,
  scanOpportunities,
  type ScanStateResolverDb,
} from '../../services/opportunity-scanner';
import { publishCockpitEvent } from '../../services/cockpit-events';
import type { PersonaToolDescriptor } from './types';

const OWNER_AND_ADMIN: ReadonlyArray<
  'T1_owner_strategist' | 'T2_admin_strategist'
> = ['T1_owner_strategist', 'T2_admin_strategist'];

interface ToolDeps {
  readonly db: ScanStateResolverDb;
}

let injectedDeps: ToolDeps | null = null;

/**
 * Wire the database client at composition time. Called once from the
 * api-gateway composition root with the tenant-scoped DB pool.
 */
export function configureOpportunityScannerTools(deps: ToolDeps): void {
  injectedDeps = Object.freeze({ db: deps.db });
}

function requireDb(): ScanStateResolverDb {
  if (!injectedDeps) {
    throw new Error(
      'opportunity-scanner-tools: configureOpportunityScannerTools(deps) was not called at composition time',
    );
  }
  return injectedDeps.db;
}

// ─────────────────────────────────────────────────────────────────────
// 1. mining.opportunities.scan
// ─────────────────────────────────────────────────────────────────────

const ScanInput = z.object({
  maxResults: z.number().int().min(1).max(5).default(3),
  minExpectedValueTzs: z.number().nonnegative().optional(),
  kindFilter: z.array(z.enum(OPPORTUNITY_KINDS)).max(12).optional(),
  scopeIds: z.array(z.string().min(1).max(40)).max(8).optional(),
});

const OpportunityRow = z.object({
  id: z.string(),
  kind: z.enum(OPPORTUNITY_KINDS),
  headlineEn: z.string(),
  headlineSw: z.string(),
  expectedValueTzs: z.number().nullable(),
  confidence: z.number(),
  timeWindowDays: z.number().int(),
  citations: z.array(z.string()),
});

const ScanOutput = z.object({
  generatedAt: z.string(),
  opportunities: z.array(OpportunityRow),
  ruleCount: z.number().int(),
  // Degraded-read self-report — TRUE when one or more backing relations could
  // NOT be read (undefined-table / undefined-column, e.g. a deploy/wiring
  // drift or the 0370-excluded lbma_fix_summary / fx_rates_intraday). The
  // persona MUST render an explicit "some data could not be read" note and
  // never present the empty `opportunities` list as an implicit all-clear.
  unavailable: z.boolean(),
  degradedRelations: z.array(z.string()),
});

export const opportunityScanTool: PersonaToolDescriptor<
  typeof ScanInput,
  typeof ScanOutput
> = {
  id: 'mining.opportunities.scan',
  name: 'Opportunities — scan',
  description:
    'Scan the tenant for upside (cost saves, revenue, tax windows, regulatory ' +
    'amnesties, capital routing, market timing, peer best-practice). Returns ' +
    'top N ranked opportunities. Read-only; no side effects. Default cap = 3.',
  personaSlugs: OWNER_AND_ADMIN,
  inputSchema: ScanInput,
  outputSchema: ScanOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const db = requireDb();
    // Brain tools run OUTSIDE the api-gateway databaseMiddleware, so the
    // raw pool carries no `app.current_tenant_id` GUC. Under FORCE-RLS
    // every tenant-scoped SELECT would return 0 rows. Bind the tenant
    // context around the resolver reads inside a pinned transaction —
    // same idiom as `data-analysis-tools.ts`. The `as unknown as` cast
    // sidesteps the TS2709 namespace-vs-type drift on `@borjie/database`.
    const report = await withTenantContext(
      db as unknown as Parameters<typeof withTenantContext>[0],
      ctx.tenantId,
      (tx) =>
        resolveScanStateReport(
          tx as unknown as ScanStateResolverDb,
          ctx.tenantId,
        ),
    );
    const state = report.state;
    const options: Parameters<typeof scanOpportunities>[1] = {
      maxResults: input.maxResults,
    };
    if (input.minExpectedValueTzs !== undefined) {
      (options as { minExpectedValueTzs?: number }).minExpectedValueTzs =
        input.minExpectedValueTzs;
    }
    if (input.kindFilter && input.kindFilter.length > 0) {
      (
        options as {
          kindFilter?: ReadonlyArray<(typeof OPPORTUNITY_KINDS)[number]>;
        }
      ).kindFilter = input.kindFilter;
    }
    if (input.scopeIds && input.scopeIds.length > 0) {
      (options as { scopeIds?: ReadonlyArray<string> }).scopeIds = input.scopeIds;
    }
    const opportunities = scanOpportunities(state, options);

    // R6 — cockpit SSE notify. We push only when at least one
    // opportunity surfaced so the toast carries actionable signal.
    if (opportunities.length > 0) {
      const top = opportunities[0];
      publishCockpitEvent({
        kind: 'opportunity.scan_completed',
        tenantId: ctx.tenantId,
        emittedAt: state.nowIso,
        opportunityCount: opportunities.length,
        topExpectedValueTzs: top?.expectedValueTzs ?? 0,
      });
    }

    return {
      generatedAt: state.nowIso,
      opportunities: opportunities.map((o) => ({
        id: o.id,
        kind: o.kind,
        headlineEn: o.headline.en,
        headlineSw: o.headline.sw,
        expectedValueTzs: o.expectedValueTzs ?? null,
        confidence: o.confidence,
        timeWindowDays: o.timeWindowDays,
        citations: [...o.citations],
      })),
      ruleCount: ALL_SCAN_RULES.length,
      // Surface the degraded-read signal so the persona renders an explicit
      // "some data could not be read" note instead of an implicit all-clear
      // over unreadable backing tables.
      unavailable: report.unavailable,
      degradedRelations: [...report.degradedRelations],
    };
  },
};

// ─────────────────────────────────────────────────────────────────────
// 2. mining.opportunities.list_rules
// ─────────────────────────────────────────────────────────────────────

const ListRulesInput = z.object({
  kindFilter: z.array(z.enum(OPPORTUNITY_KINDS)).max(12).optional(),
});

const RuleSummary = z.object({
  id: z.string(),
  kind: z.enum(OPPORTUNITY_KINDS),
  title: z.string(),
});

const ListRulesOutput = z.object({
  rules: z.array(RuleSummary),
  totalRules: z.number().int(),
});

export const opportunityListRulesTool: PersonaToolDescriptor<
  typeof ListRulesInput,
  typeof ListRulesOutput
> = {
  id: 'mining.opportunities.list_rules',
  name: 'Opportunities — list rules',
  description:
    'List every opportunity-detection rule the brain checks for. ' +
    'Each entry returns the rule id, opportunity kind, and a short title. ' +
    'Read-only; surfaces the rule catalogue so the brain can cite real ids.',
  personaSlugs: OWNER_AND_ADMIN,
  inputSchema: ListRulesInput,
  outputSchema: ListRulesOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input) {
    const kindFilter = input.kindFilter && input.kindFilter.length > 0
      ? new Set<(typeof OPPORTUNITY_KINDS)[number]>(input.kindFilter)
      : null;
    const rules = ALL_SCAN_RULES.filter(
      (r) => !kindFilter || kindFilter.has(r.kind),
    ).map((r) => ({
      id: r.id,
      kind: r.kind,
      // Rule descriptors do not carry a separate title field; use the id
      // canonical form ("fuel-supplier-arbitrage" → "Fuel supplier arbitrage").
      title: r.id
        .replace(/[-_.]/g, ' ')
        .replace(/^./, (c) => c.toUpperCase()),
    }));
    return { rules, totalRules: ALL_SCAN_RULES.length };
  },
};

// ─────────────────────────────────────────────────────────────────────
// Catalog barrel
// ─────────────────────────────────────────────────────────────────────

// Cast through `as unknown as` so the array literal of two descriptors
// with different concrete zod generics collapses to the catalog's
// covariant `PersonaToolDescriptor<ZodTypeAny, ZodTypeAny>` shape.
// Same pattern as `SHARED_TOOLS` in `shared-tools.ts`.
export const OPPORTUNITY_SCANNER_TOOLS: ReadonlyArray<
  PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>
> = Object.freeze([
  opportunityScanTool,
  opportunityListRulesTool,
] as unknown as readonly PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>[]);
