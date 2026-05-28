/**
 * MD-Intelligence brain tools — Wave MD-INTELLIGENCE.
 *
 * Four cross-domain intelligence tools that turn the brain from "AI
 * assistant" into "AI Managing Director". Each tool is a thin wrapper
 * over the corresponding pure-functional module in
 * `services/api-gateway/src/services/md-intelligence/`:
 *
 *   - `md.correlation_for_question`  → correlation-engine.correlate()
 *   - `md.trace_causes`              → causation-tracer.trace()
 *   - `md.compare_baselines`         → comparison-framework.compare()
 *   - `md.emit_insights`             → insight-emitter.emit()
 *
 * Persona binding: owner strategist (T1) only — these tools surface
 * strategic, cross-domain insights that the owner uses to think with
 * Mr. Mwikila.
 *
 * Tier discipline: every tool is `isWrite: false`, `stakes: 'LOW'`, and
 * `requiresPolicyRuleLiteral: false`. None of them mutate state. Tools
 * defer the heavy lifting to the underlying pure functions plus the
 * api-gateway HTTP layer for data fetching.
 *
 * Grounding contract: `md.emit_insights` echoes the upstream emitter's
 * hard rule — every insight must cite a real data point surfaced in the
 * same turn. Ungrounded candidates are filtered server-side; the tool
 * surfaces only validated insights.
 */

import { z } from 'zod';
import type { PersonaToolDescriptor } from './types';

const OWNER: ReadonlyArray<'T1_owner_strategist'> = ['T1_owner_strategist'];

// ─────────────────────────────────────────────────────────────────────
// 1. md.correlation_for_question
// ─────────────────────────────────────────────────────────────────────

const CorrelationInput = z.object({
  domain: z.string().min(1).max(40),
  scopeNodeId: z.string().uuid().optional(),
  limit: z.number().int().positive().max(10).default(3),
});
const CorrelationOutput = z.object({
  domain: z.string(),
  probedNodes: z.number().int().nonnegative(),
  touches: z.array(
    z.object({
      from: z.string(),
      to: z.string(),
      touchedDomain: z.string(),
      strength: z.number(),
      lagDays: z.number().int().nonnegative(),
      direction: z.enum(['forward', 'bidirectional']),
      kind: z.enum(['causal', 'correlational', 'composite']),
      rationale: z.string(),
    }),
  ),
});

export const mdCorrelationForQuestionTool: PersonaToolDescriptor<
  typeof CorrelationInput,
  typeof CorrelationOutput
> = {
  id: 'md.correlation_for_question',
  name: 'MD — correlations for the asked-about state',
  description:
    'For the asked-about domain, surface which OTHER domains the currently-lit state ' +
    'touches via the signal graph (≥60 cross-domain edges). Always anchor cross-domain ' +
    'claims with a touch returned here — never improvise a link.',
  personaSlugs: OWNER,
  inputSchema: CorrelationInput,
  outputSchema: CorrelationOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return { domain: input.domain, probedNodes: 0, touches: [] };
    }
    return client.post<{
      domain: string;
      probedNodes: number;
      touches: Array<{
        from: string;
        to: string;
        touchedDomain: string;
        strength: number;
        lagDays: number;
        direction: 'forward' | 'bidirectional';
        kind: 'causal' | 'correlational' | 'composite';
        rationale: string;
      }>;
    }>('/md/correlations', {
      tenantId: ctx.tenantId,
      domain: input.domain,
      ...(input.scopeNodeId !== undefined ? { scopeNodeId: input.scopeNodeId } : {}),
      limit: input.limit,
    });
  },
};

// ─────────────────────────────────────────────────────────────────────
// 2. md.trace_causes
// ─────────────────────────────────────────────────────────────────────

const TraceCausesInput = z.object({
  symptom: z.string().min(1).max(120),
  scopeNodeId: z.string().uuid().optional(),
  maxDepth: z.number().int().positive().max(6).default(3),
  limit: z.number().int().positive().max(10).default(3),
});
const TraceCausesOutput = z.object({
  symptomNode: z.string(),
  maxDepth: z.number().int().positive(),
  chains: z.array(
    z.object({
      rootCause: z.string(),
      cumulativeStrength: z.number(),
      cumulativeLagDays: z.number().int().nonnegative(),
      confidence: z.number(),
      steps: z.array(
        z.object({
          from: z.string(),
          to: z.string(),
          strength: z.number(),
          lagDays: z.number().int().nonnegative(),
          rationale: z.string(),
          kind: z.enum(['causal', 'correlational', 'composite']),
        }),
      ),
    }),
  ),
});

export const mdTraceCausesTool: PersonaToolDescriptor<
  typeof TraceCausesInput,
  typeof TraceCausesOutput
> = {
  id: 'md.trace_causes',
  name: 'MD — trace causes upstream from a symptom',
  description:
    'Walk upstream from a present-tense symptom (e.g. "production 12% under target") to ' +
    'surface the most likely root causes. Only causal / composite edges are followed; ' +
    'correlational links are surfaced separately via md.correlation_for_question. ' +
    'Returns ranked chains for inline_workflow rendering.',
  personaSlugs: OWNER,
  inputSchema: TraceCausesInput,
  outputSchema: TraceCausesOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return {
        symptomNode: input.symptom,
        maxDepth: input.maxDepth,
        chains: [],
      };
    }
    return client.post<{
      symptomNode: string;
      maxDepth: number;
      chains: Array<{
        rootCause: string;
        cumulativeStrength: number;
        cumulativeLagDays: number;
        confidence: number;
        steps: Array<{
          from: string;
          to: string;
          strength: number;
          lagDays: number;
          rationale: string;
          kind: 'causal' | 'correlational' | 'composite';
        }>;
      }>;
    }>('/md/causation/trace', {
      tenantId: ctx.tenantId,
      symptom: input.symptom,
      ...(input.scopeNodeId !== undefined ? { scopeNodeId: input.scopeNodeId } : {}),
      maxDepth: input.maxDepth,
      limit: input.limit,
    });
  },
};

// ─────────────────────────────────────────────────────────────────────
// 3. md.compare_baselines
// ─────────────────────────────────────────────────────────────────────

const CompareBaselinesInput = z.object({
  metricId: z.string().min(1).max(120),
  tenantValue: z.number(),
  cohortKey: z.string().min(1).max(120).optional(),
});
const CompareBaselinesOutput = z.object({
  metricId: z.string(),
  tenant: z.number(),
  historical: z
    .object({
      day30: z.number().nullable(),
      day90: z.number().nullable(),
      yoy: z.number().nullable(),
      note: z.string().optional(),
    })
    .nullable(),
  peer: z
    .object({
      cohortKey: z.string(),
      p25: z.number().nullable(),
      p50: z.number().nullable(),
      p75: z.number().nullable(),
      sampleSize: z.number().int().nonnegative(),
      note: z.string().optional(),
    })
    .nullable(),
  benchmark: z
    .object({
      source: z.string(),
      value: z.number().nullable(),
      asOf: z.string().nullable(),
      note: z.string().optional(),
    })
    .nullable(),
  delta: z.object({
    vsDay30: z.number().nullable(),
    vsDay90: z.number().nullable(),
    vsYoy: z.number().nullable(),
    vsPeerP50: z.number().nullable(),
    vsBenchmark: z.number().nullable(),
  }),
  percentile: z.number().nullable(),
  note: z.string().optional(),
});

export const mdCompareBaselinesTool: PersonaToolDescriptor<
  typeof CompareBaselinesInput,
  typeof CompareBaselinesOutput
> = {
  id: 'md.compare_baselines',
  name: 'MD — compare against historical / peer / benchmark baselines',
  description:
    'Never let a raw number speak alone. Returns historical (this tenant, 30d / 90d / YoY), ' +
    'peer cohort (anonymised p25 / p50 / p75 across the same licence-class + commodity ' +
    'bucket), and external benchmark (LBMA / BoT / TRA / NEMC). Missing baselines surface as ' +
    "null with a 'awaiting seed' note so we render an honest gap instead of fabricating.",
  personaSlugs: OWNER,
  inputSchema: CompareBaselinesInput,
  outputSchema: CompareBaselinesOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return {
        metricId: input.metricId,
        tenant: input.tenantValue,
        historical: null,
        peer: null,
        benchmark: null,
        delta: {
          vsDay30: null,
          vsDay90: null,
          vsYoy: null,
          vsPeerP50: null,
          vsBenchmark: null,
        },
        percentile: null,
        note: 'awaiting seed',
      };
    }
    return client.post<z.infer<typeof CompareBaselinesOutput>>(
      '/md/baselines/compare',
      {
        tenantId: ctx.tenantId,
        metricId: input.metricId,
        tenantValue: input.tenantValue,
        ...(input.cohortKey !== undefined ? { cohortKey: input.cohortKey } : {}),
      },
    );
  },
};

// ─────────────────────────────────────────────────────────────────────
// 4. md.emit_insights
// ─────────────────────────────────────────────────────────────────────

const EmitInsightsInput = z.object({
  domain: z.string().min(1).max(40),
  scopeNodeId: z.string().uuid().optional(),
  limit: z.number().int().positive().max(5).default(3),
});
const EmitInsightsOutput = z.object({
  groundedDataPoints: z.number().int().nonnegative(),
  rejectedForUngrounded: z.number().int().nonnegative(),
  insights: z.array(
    z.object({
      kind: z.enum(['opportunity', 'risk', 'anomaly', 'trend', 'comparison']),
      headline: z.object({ en: z.string(), sw: z.string() }),
      rationale: z.object({ en: z.string(), sw: z.string() }),
      confidence: z.number(),
      grounding: z.array(z.string()),
      suggestedActions: z.array(
        z.object({
          actionId: z.string(),
          label: z.object({ en: z.string(), sw: z.string() }),
        }),
      ),
    }),
  ),
});

export const mdEmitInsightsTool: PersonaToolDescriptor<
  typeof EmitInsightsInput,
  typeof EmitInsightsOutput
> = {
  id: 'md.emit_insights',
  name: 'MD — emit grounded insights',
  description:
    'Close the turn with 0-3 NON-OBVIOUS insights the MD would surface. EVERY insight is ' +
    'grounded in real data points returned by other tools in the same turn — ungrounded ' +
    'candidates are filtered server-side. Never call this without first calling the domain ' +
    'tools that supply the grounding.',
  personaSlugs: OWNER,
  inputSchema: EmitInsightsInput,
  outputSchema: EmitInsightsOutput,
  stakes: 'LOW',
  isWrite: false,
  requiresPolicyRuleLiteral: false,
  async handler(input, ctx) {
    const client = ctx.httpClient;
    if (!client) {
      return {
        groundedDataPoints: 0,
        rejectedForUngrounded: 0,
        insights: [],
      };
    }
    return client.post<z.infer<typeof EmitInsightsOutput>>(
      '/md/insights/emit',
      {
        tenantId: ctx.tenantId,
        domain: input.domain,
        ...(input.scopeNodeId !== undefined ? { scopeNodeId: input.scopeNodeId } : {}),
        limit: input.limit,
      },
    );
  },
};

// ─────────────────────────────────────────────────────────────────────
// Catalog export
// ─────────────────────────────────────────────────────────────────────

export const MD_INTELLIGENCE_TOOLS: ReadonlyArray<
  PersonaToolDescriptor<z.ZodTypeAny, z.ZodTypeAny>
> = Object.freeze([
  mdCorrelationForQuestionTool,
  mdTraceCausesTool,
  mdCompareBaselinesTool,
  mdEmitInsightsTool,
]);
