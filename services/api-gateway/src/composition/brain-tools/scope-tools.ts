/**
 * Scope brain tools — Wave SCOPE-SEGMENTATION.
 *
 * Five tools backing the owner-os scope intelligence layer. Each tool is
 * read-only and defers to the corresponding scope service via the
 * injected HTTP client so the LLM and the cockpit render identical data
 * (no parallel data paths).
 *
 * Tools registered:
 *   - `scope.resolve_label`            — turn a canonical kind into the
 *                                        tenant's preferred display label
 *                                        (sw + en).
 *   - `scope.roll_up_across_scopes`    — sum / mean / min / max / count a
 *                                        metric across a set of scope
 *                                        node ids.
 *   - `scope.compare_across_scopes`    — rank scope nodes against each
 *                                        other on one metric; surface
 *                                        top / bottom / delta-from-mean.
 *   - `scope.cross_domain_scope_matrix`— for a fixed scope set, build the
 *                                        per-scope × per-domain status
 *                                        matrix the MD renders as inline.
 *   - `scope.taxonomy_display_for`     — read the tenant's full label map
 *                                        (every canonical kind → sw + en
 *                                        label).
 *
 * Persona binding: every tool is exposed to BOTH the owner strategist
 * (T1) AND the admin strategist (T2) — admins frequently inspect tenant
 * scope hierarchies when debugging.
 *
 * Tier discipline: every tool is `isWrite: false`, `stakes: 'LOW'`, and
 * `requiresPolicyRuleLiteral: false`. None of them mutate state.
 */

import { z } from 'zod';
import type { PersonaToolDescriptor } from './types';

const OWNER_AND_ADMIN: ReadonlyArray<
  'T1_owner_strategist' | 'T2_admin_strategist'
> = ['T1_owner_strategist', 'T2_admin_strategist'];

// ─────────────────────────────────────────────────────────────────────
// 1. scope.resolve_label
// ─────────────────────────────────────────────────────────────────────

const ResolveLabelInput = z.object({
  kindCanonical: z.string().min(1).max(50),
  // English default per CLAUDE.md (flipped 2026-05).
  locale: z.enum(['en', 'sw']).default('en'),
});
const ResolveLabelOutput = z.object({
  kindCanonical: z.string(),
  labelEn: z.string(),
  labelSw: z.string(),
  resolved: z.string(),
});

export const scopeResolveLabelTool: PersonaToolDescriptor<
  typeof ResolveLabelInput,
  typeof ResolveLabelOutput
> = {
  id: 'scope.resolve_label',
  name: 'Scope — resolve label',
  description:
    'Resolve a canonical scope kind (pit / site / region / subsidiary / etc.) to the ' +
    "tenant's preferred display label in en + sw. Always honour the tenant's label " +
    'rather than the canonical kind when speaking back to the owner.',
  personaSlugs: OWNER_AND_ADMIN,
  inputSchema: ResolveLabelInput,
  outputSchema: ResolveLabelOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      const fallback = input.kindCanonical;
      return {
        kindCanonical: input.kindCanonical,
        labelEn: fallback,
        labelSw: fallback,
        resolved: fallback,
      };
    }
    return client.get<{
      kindCanonical: string;
      labelEn: string;
      labelSw: string;
      resolved: string;
    }>('/scope/labels/resolve', {
      query: {
        tenantId: ctx.tenantId,
        kindCanonical: input.kindCanonical,
        locale: input.locale,
      },
    });
  },
};

// ─────────────────────────────────────────────────────────────────────
// 2. scope.roll_up_across_scopes
// ─────────────────────────────────────────────────────────────────────

const RollUpInput = z.object({
  scopeNodeIds: z.array(z.string().uuid()).min(1).max(200),
  metricId: z.string().min(1).max(120),
});
const RollUpOutput = z.object({
  metricId: z.string(),
  total: z.number(),
  mean: z.number(),
  min: z.number().nullable(),
  max: z.number().nullable(),
  count: z.number().int().nonnegative(),
  perScope: z.array(
    z.object({
      scopeNodeId: z.string(),
      value: z.number(),
      unit: z.string().optional(),
    }),
  ),
});

export const scopeRollUpTool: PersonaToolDescriptor<
  typeof RollUpInput,
  typeof RollUpOutput
> = {
  id: 'scope.roll_up_across_scopes',
  name: 'Scope — roll up across scopes',
  description:
    'Sum / mean / min / max / count a metric across a set of scope node ids. Use when the ' +
    'owner asks "how is X across all my pits / sites / subsidiaries" — returns the rolled-up ' +
    'figure plus the per-scope breakdown.',
  personaSlugs: OWNER_AND_ADMIN,
  inputSchema: RollUpInput,
  outputSchema: RollUpOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return {
        metricId: input.metricId,
        total: 0,
        mean: 0,
        min: null,
        max: null,
        count: 0,
        perScope: [],
      };
    }
    return client.post<{
      metricId: string;
      total: number;
      mean: number;
      min: number | null;
      max: number | null;
      count: number;
      perScope: Array<{ scopeNodeId: string; value: number; unit?: string }>;
    }>('/scope/metrics/roll-up', {
      tenantId: ctx.tenantId,
      scopeNodeIds: input.scopeNodeIds,
      metricId: input.metricId,
    });
  },
};

// ─────────────────────────────────────────────────────────────────────
// 3. scope.compare_across_scopes
// ─────────────────────────────────────────────────────────────────────

const CompareInput = z.object({
  scopeNodeIds: z.array(z.string().uuid()).min(2).max(50),
  metricId: z.string().min(1).max(120),
});
const CompareOutput = z.object({
  metricId: z.string(),
  mean: z.number(),
  topScopeNodeId: z.string().nullable(),
  bottomScopeNodeId: z.string().nullable(),
  ranking: z.array(
    z.object({
      scopeNodeId: z.string(),
      value: z.number(),
      rank: z.number().int().positive(),
      deltaFromMean: z.number(),
    }),
  ),
});

export const scopeCompareTool: PersonaToolDescriptor<
  typeof CompareInput,
  typeof CompareOutput
> = {
  id: 'scope.compare_across_scopes',
  name: 'Scope — compare across scopes',
  description:
    'Rank multiple scope nodes against each other on a single metric. Use when the owner ' +
    'asks "which pit is leading on safety" or similar. Returns ranking + top + bottom + ' +
    'delta-from-mean per scope.',
  personaSlugs: OWNER_AND_ADMIN,
  inputSchema: CompareInput,
  outputSchema: CompareOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return {
        metricId: input.metricId,
        mean: 0,
        topScopeNodeId: null,
        bottomScopeNodeId: null,
        ranking: [],
      };
    }
    return client.post<{
      metricId: string;
      mean: number;
      topScopeNodeId: string | null;
      bottomScopeNodeId: string | null;
      ranking: Array<{
        scopeNodeId: string;
        value: number;
        rank: number;
        deltaFromMean: number;
      }>;
    }>('/scope/metrics/compare', {
      tenantId: ctx.tenantId,
      scopeNodeIds: input.scopeNodeIds,
      metricId: input.metricId,
    });
  },
};

// ─────────────────────────────────────────────────────────────────────
// 4. scope.cross_domain_scope_matrix
// ─────────────────────────────────────────────────────────────────────

const MatrixInput = z.object({
  scopeNodeIds: z.array(z.string().uuid()).min(1).max(50),
  domains: z.array(z.string().min(1).max(40)).min(1).max(14),
});
const MatrixOutput = z.object({
  scopeNodeIds: z.array(z.string()),
  domains: z.array(z.string()),
  cells: z.array(
    z.object({
      scopeNodeId: z.string(),
      domainId: z.string(),
      status: z.enum(['green', 'amber', 'red', 'unknown']),
      note: z.string().optional(),
    }),
  ),
});

export const scopeCrossDomainMatrixTool: PersonaToolDescriptor<
  typeof MatrixInput,
  typeof MatrixOutput
> = {
  id: 'scope.cross_domain_scope_matrix',
  name: 'Scope — cross-domain × scope matrix',
  description:
    'For a fixed scope set + a fixed domain set, build the per-scope × per-domain status ' +
    'matrix. Use when the owner asks for the health of every site across every domain — ' +
    'returns one cell per (scope, domain) with green / amber / red / unknown tone.',
  personaSlugs: OWNER_AND_ADMIN,
  inputSchema: MatrixInput,
  outputSchema: MatrixOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return {
        scopeNodeIds: input.scopeNodeIds,
        domains: input.domains,
        cells: [],
      };
    }
    return client.post<{
      scopeNodeIds: string[];
      domains: string[];
      cells: Array<{
        scopeNodeId: string;
        domainId: string;
        status: 'green' | 'amber' | 'red' | 'unknown';
        note?: string;
      }>;
    }>('/scope/matrix/cross-domain', {
      tenantId: ctx.tenantId,
      scopeNodeIds: input.scopeNodeIds,
      domains: input.domains,
    });
  },
};

// ─────────────────────────────────────────────────────────────────────
// 5. scope.taxonomy_display_for
// ─────────────────────────────────────────────────────────────────────

const TaxonomyDisplayInput = z.object({});
const TaxonomyDisplayOutput = z.object({
  defaultKind: z.string(),
  displayLabelEn: z.record(z.string()),
  displayLabelSw: z.record(z.string()),
  updatedAt: z.string(),
});

export const scopeTaxonomyDisplayTool: PersonaToolDescriptor<
  typeof TaxonomyDisplayInput,
  typeof TaxonomyDisplayOutput
> = {
  id: 'scope.taxonomy_display_for',
  name: 'Scope — taxonomy display for tenant',
  description:
    "Read the tenant's full scope-label map (every canonical kind → sw + en label) plus " +
    'the tenant default kind. Call this once per conversation to learn the labels then use ' +
    'scope.resolve_label for ad-hoc lookups.',
  personaSlugs: OWNER_AND_ADMIN,
  inputSchema: TaxonomyDisplayInput,
  outputSchema: TaxonomyDisplayOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(_input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return {
        defaultKind: 'site',
        displayLabelEn: {},
        displayLabelSw: {},
        updatedAt: new Date().toISOString(),
      };
    }
    return client.get<{
      defaultKind: string;
      displayLabelEn: Record<string, string>;
      displayLabelSw: Record<string, string>;
      updatedAt: string;
    }>('/scope/taxonomy', {
      query: { tenantId: ctx.tenantId },
    });
  },
};

// ─────────────────────────────────────────────────────────────────────
// Catalog export
// ─────────────────────────────────────────────────────────────────────

export const SCOPE_TOOLS: ReadonlyArray<
  PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>
> = Object.freeze([
  scopeResolveLabelTool,
  scopeRollUpTool,
  scopeCompareTool,
  scopeCrossDomainMatrixTool,
  scopeTaxonomyDisplayTool,
] as unknown as readonly PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>[]);
