/**
 * BriefingComposer — Wave 28.
 *
 * Assembles a BriefingDocument from six independent source ports. Each
 * source is fetched in parallel; failures fall back to empty sections so
 * a single upstream hiccup can't black-screen the head's morning login.
 *
 * The composer is transport-free and deterministic over its inputs. Tests
 * inject in-memory stubs; production wires AutonomousActionAudit,
 * ApprovalGrantService, ExceptionInbox, StrategicAdvisor + a KPI source
 * provided by the composition root.
 */

import type {
  AnomaliesSource,
  BriefingAnomaly,
  BriefingDocument,
  BriefingRecommendation,
  EscalationsSection,
  EscalationsSource,
  KpiDeltasSection,
  KpiSource,
  OvernightSection,
  OvernightSource,
  PendingApprovalsSection,
  PendingApprovalsSource,
  RecommendationsSource,
} from './types.js';
import { logger } from '../logger.js';

export interface BriefingComposerDeps {
  readonly overnightSource: OvernightSource;
  readonly pendingApprovalsSource: PendingApprovalsSource;
  readonly escalationsSource: EscalationsSource;
  readonly kpiSource: KpiSource;
  readonly recommendationsSource: RecommendationsSource;
  readonly anomaliesSource: AnomaliesSource;
  readonly clock?: () => Date;
  /** Window for overnight activity — defaults to 16h before `now`. */
  readonly overnightWindowMs?: number;
}

export interface BriefingComposer {
  readonly compose: (tenantId: string) => Promise<BriefingDocument>;
}

const DEFAULT_OVERNIGHT_WINDOW_MS = 16 * 60 * 60 * 1000;

const EMPTY_OVERNIGHT: OvernightSection = {
  totalAutonomousActions: 0,
  byDomain: {},
  notableActions: [],
};

const EMPTY_APPROVALS: PendingApprovalsSection = {
  count: 0,
  items: [],
};

const EMPTY_ESCALATIONS: EscalationsSection = {
  count: 0,
  byPriority: { P1: 0, P2: 0, P3: 0 },
  items: [],
};

const EMPTY_KPIS: KpiDeltasSection = {
  occupancyPct: { value: 0, delta7d: 0 },
  collectionsRate: { value: 0, delta7d: 0 },
  arrearsDays: { value: 0, delta7d: 0 },
  maintenanceSLA: { value: 0, delta7d: 0 },
  tenantSatisfaction: { value: 0, delta30d: 0 },
  noi: { value: 0, delta30d: 0 },
};

export function createBriefingComposer(
  deps: BriefingComposerDeps,
): BriefingComposer {
  const clock = deps.clock ?? (() => new Date());
  const windowMs = deps.overnightWindowMs ?? DEFAULT_OVERNIGHT_WINDOW_MS;

  return {
    async compose(tenantId: string): Promise<BriefingDocument> {
      if (!tenantId || typeof tenantId !== 'string') {
        throw new Error('tenantId is required');
      }
      const now = clock();
      const since = new Date(now.getTime() - windowMs);

      const [
        overnight,
        pendingApprovals,
        escalations,
        kpiDeltas,
      ] = await Promise.all([
        safeFetch(
          () => deps.overnightSource.summarize(tenantId, since),
          EMPTY_OVERNIGHT,
        ),
        safeFetch(
          () => deps.pendingApprovalsSource.list(tenantId),
          EMPTY_APPROVALS,
        ),
        safeFetch(
          () => deps.escalationsSource.list(tenantId),
          EMPTY_ESCALATIONS,
        ),
        safeFetch(() => deps.kpiSource.fetch(tenantId), EMPTY_KPIS),
      ]);

      // Recommendations depend on KPIs + anomalies is independent — run in
      // parallel once KPIs have landed.
      const [recommendations, anomalies] = await Promise.all([
        safeFetch(
          () => deps.recommendationsSource.list(tenantId, kpiDeltas),
          [] as readonly BriefingRecommendation[],
        ),
        safeFetch(
          () => deps.anomaliesSource.list(tenantId),
          [] as readonly BriefingAnomaly[],
        ),
      ]);

      const headline = buildHeadline({
        overnight,
        pendingApprovals,
        escalations,
        kpiDeltas,
      });

      return {
        tenantId,
        generatedAt: now.toISOString(),
        headline,
        overnight,
        pendingApprovals,
        escalations,
        kpiDeltas,
        recommendations,
        anomalies,
      };
    },
  };
}

async function safeFetch<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    const result = await fn();
    return result ?? fallback;
  } catch (err) {
    // Do not let a single source knock out the whole briefing — log and
    // degrade. The head sees an empty section instead of a 5xx.
     
    logger.error('head-briefing: source fetch failed — using empty fallback', { error: err instanceof Error ? err.message : String(err) });
    return fallback;
  }
}

function buildHeadline(input: {
  readonly overnight: OvernightSection;
  readonly pendingApprovals: PendingApprovalsSection;
  readonly escalations: EscalationsSection;
  readonly kpiDeltas: KpiDeltasSection;
}): string {
  const parts: string[] = [];
  if (input.overnight.totalAutonomousActions > 0) {
    parts.push(
      `${input.overnight.totalAutonomousActions} action${
        input.overnight.totalAutonomousActions === 1 ? '' : 's'
      } handled overnight`,
    );
  }
  if (input.escalations.byPriority.P1 > 0) {
    parts.push(
      `${input.escalations.byPriority.P1} P1 escalation${
        input.escalations.byPriority.P1 === 1 ? '' : 's'
      } awaiting you`,
    );
  }
  if (input.pendingApprovals.count > 0) {
    parts.push(
      `${input.pendingApprovals.count} approval${
        input.pendingApprovals.count === 1 ? '' : 's'
      } pending`,
    );
  }
  const occ = input.kpiDeltas.occupancyPct;
  if (Number.isFinite(occ.value) && occ.value > 0) {
    parts.push(`occupancy ${Math.round(occ.value)}%`);
  }
  if (parts.length === 0) {
    return 'A quiet start — no overnight activity and no pending decisions.';
  }
  return capitalise(parts.join('; ')) + '.';
}

function capitalise(s: string): string {
  if (!s) return s;
  return (s[0] ?? '').toUpperCase() + s.slice(1);
}
