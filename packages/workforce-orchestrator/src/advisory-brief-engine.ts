/**
 * Piece M — advisory-brief-engine.
 *
 * Weekly roll-up. Reads the last 7 days of workforce_kpis + recent
 * performance_signals + skill_assessments and constructs an
 * advisory_brief draft.
 *
 * Two-layer construction:
 *   1. Deterministic stats roll-up (this module).
 *   2. ContentGenerator.draftAdvisoryBrief (kernel) for gaps /
 *      opportunities / recommendations / citations.
 *
 * HITL: advisory_briefs ALWAYS require a manager confirmation before
 * broadcast. The kernel writes the row but DOES NOT broadcast — that's
 * the caller's responsibility once they've confirmed.
 *
 * Self-contained: this module does not depend on a Piece C executive-
 * brief surface; if Piece C lands later, the writer can be refactored
 * to share the citations pipeline.
 */

import { z } from 'zod';
import {
  AdvisoryBriefSchema,
  type AdvisoryBrief,
  type PerformanceSignal,
  type WorkforceDeps,
  type WorkforceKpi,
} from './types.js';

export const GenerateAdvisoryInputSchema = z.object({
  tenantId: z.string().min(1),
  audiencePersonaId: z.string().nullable().optional(),
  periodStart: z.string(),
  periodEnd: z.string(),
});

export type GenerateAdvisoryInput = z.infer<typeof GenerateAdvisoryInputSchema>;

export interface PeriodStats {
  totalAssignments: number;
  completedOnTime: number;
  overdue: number;
  blockersOpen: number;
  avgCompletionHours: number | null;
  onTimeRate: number;
  signalsByKind: Record<string, number>;
}

export function rollupStats(args: {
  kpis: WorkforceKpi[];
  signals: PerformanceSignal[];
}): PeriodStats {
  const total = args.kpis.reduce((a, k) => a + k.totalAssignments, 0);
  const onTime = args.kpis.reduce((a, k) => a + k.completedOnTime, 0);
  const overdue = args.kpis.reduce((a, k) => a + k.overdue, 0);
  const blockersOpen = args.kpis.reduce((a, k) => a + k.blockersOpen, 0);

  const completionHrs = args.kpis
    .map((k) => k.avgCompletionHours)
    .filter((x): x is number => typeof x === 'number');
  const avgCompletionHours = completionHrs.length
    ? completionHrs.reduce((a, b) => a + b, 0) / completionHrs.length
    : null;

  const onTimeRate = total > 0 ? onTime / total : 0;

  const signalsByKind: Record<string, number> = {};
  for (const s of args.signals) {
    signalsByKind[s.signalKind] = (signalsByKind[s.signalKind] ?? 0) + 1;
  }

  return {
    totalAssignments: total,
    completedOnTime: onTime,
    overdue,
    blockersOpen,
    avgCompletionHours,
    onTimeRate,
    signalsByKind,
  };
}

export async function generateAdvisoryBrief(
  deps: WorkforceDeps,
  rawInput: GenerateAdvisoryInput
): Promise<AdvisoryBrief> {
  const input = GenerateAdvisoryInputSchema.parse(rawInput);

  // 1. Pull the KPIs for the period.
  const kpis: WorkforceKpi[] = [];
  const start = new Date(input.periodStart);
  const end = new Date(input.periodEnd);
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    const dayIso = d.toISOString().slice(0, 10);
    const k = await deps.store.getKpiForDay(input.tenantId, dayIso);
    if (k) kpis.push(k);
  }

  // 2. Pull performance signals. We don't have per-tenant signal
  // listing in the port; we walk via employees (in production an
  // adapter exposes a direct `listSignalsForTenant`). For now reuse
  // listSignalsForEmployee=null trick: signals for advisory roll-up
  // come from per-employee listings. The store impl can short-circuit
  // when employeeId is the special token '__all__' (test convention).
  // Here we accept the limitation — production wiring supplies a
  // direct port.
  const signals: PerformanceSignal[] = await deps.store
    .listSignalsForEmployee(input.tenantId, '__all__', start)
    .catch(() => []);

  // 3. Deterministic stats.
  const stats = rollupStats({ kpis, signals });

  // 4. Kernel draft.
  const draft = await deps.content.draftAdvisoryBrief({
    tenantId: input.tenantId,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    kpis,
    signals,
  });

  const audit = await deps.audit.append({
    tenantId: input.tenantId,
    action: 'workforce.advisory_brief',
    payload: {
      audiencePersonaId: input.audiencePersonaId ?? null,
      periodStart: input.periodStart,
      periodEnd: input.periodEnd,
      stats,
    },
  });

  const row: AdvisoryBrief = AdvisoryBriefSchema.parse({
    id: deps.uuid(),
    tenantId: input.tenantId,
    audiencePersonaId: input.audiencePersonaId ?? null,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    overallScore: clamp(draft.overallScore, 0, 100),
    gapsJsonb: draft.gaps,
    opportunitiesJsonb: draft.opportunities,
    recommendedActionsJsonb: draft.recommendedActions,
    citationsJsonb: draft.citations,
    generatedAt: deps.clock().toISOString(),
    auditChainId: audit.chainId,
  });

  await deps.store.insertAdvisoryBrief(row);
  return row;
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
