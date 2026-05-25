/**
 * Compliance-deadline-near detector.
 *
 * Flags deadlines coming up within their kind-specific window:
 *   - kra-filing: 7 days out (P1), 3 days out (P0)
 *   - firs-filing: 7 days out (P1), 3 days out (P0)
 *   - lease-renewal: 60 days out (P2), 30 days out (P1)
 *   - business-permit: 30 days out (P1), 7 days out (P0)
 *   - insurance-renewal: 30 days out (P2), 7 days out (P0)
 */
import type { AnomalyEvent, Confidence, Severity } from '../contracts/events.js';
import type { TickContext } from '../scheduler/tick-context.js';
import type {
  ComplianceDeadline,
  ComplianceDeadlineKind,
} from '../contracts/forecast-input.js';

const DAY_MS = 24 * 60 * 60 * 1000;

interface KindThresholds {
  readonly p0Days: number;
  readonly p1Days: number;
  readonly p2Days: number;
}

const THRESHOLDS: Readonly<Record<ComplianceDeadlineKind, KindThresholds>> = {
  'kra-filing': { p0Days: 3, p1Days: 7, p2Days: 14 },
  'firs-filing': { p0Days: 3, p1Days: 7, p2Days: 14 },
  'lease-renewal': { p0Days: 14, p1Days: 30, p2Days: 60 },
  'business-permit': { p0Days: 7, p1Days: 30, p2Days: 60 },
  'insurance-renewal': { p0Days: 7, p1Days: 30, p2Days: 60 },
};

export function detectComplianceDeadlineNear(
  ctx: TickContext,
): ReadonlyArray<AnomalyEvent> {
  const deadlines = ctx.inputs.complianceDeadlines ?? [];
  const out: AnomalyEvent[] = [];

  for (const dl of deadlines) {
    if (dl.tenantId !== ctx.tenantId) continue;
    const daysOut = (dl.dueAtMs - ctx.nowMs) / DAY_MS;
    if (daysOut < 0) continue; // past deadlines are someone else's problem
    const thr = THRESHOLDS[dl.kind];
    if (daysOut > thr.p2Days) continue;

    const severity = severityFor(daysOut, thr);
    out.push(buildEvent(ctx, dl, daysOut, severity));
  }
  return out;
}

function severityFor(daysOut: number, thr: KindThresholds): Severity {
  if (daysOut <= thr.p0Days) return 'P0';
  if (daysOut <= thr.p1Days) return 'P1';
  if (daysOut <= thr.p2Days) return 'P2';
  return 'P3';
}

function buildEvent(
  ctx: TickContext,
  dl: ComplianceDeadline,
  daysOut: number,
  severity: Severity,
): AnomalyEvent {
  const confidence: Confidence = { label: 'high', score: 1 };
  return {
    type: 'anomaly',
    kind: 'compliance-deadline-near',
    id: `compliance-deadline:${dl.tenantId}:${dl.kind}:${dl.subjectId}`,
    tenantId: ctx.tenantId,
    scope: ctx.scope,
    detectedAt: new Date(ctx.nowMs).toISOString(),
    confidence,
    severity,
    headline: `${dl.subjectLabel} (${dl.kind}) due in ${Math.max(0, Math.ceil(daysOut))} day(s).`,
    evidence: {
      kind: dl.kind,
      subjectId: dl.subjectId,
      subjectLabel: dl.subjectLabel,
      dueAtMs: dl.dueAtMs,
      daysOut,
    },
  };
}
