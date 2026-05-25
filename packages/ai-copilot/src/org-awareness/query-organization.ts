/**
 * Query Organization — the orchestration layer behind Mr. Mwikila's
 * "talk to your organization" answers.
 *
 * Given a natural-language question, we route it to one of three
 * structured answers, each of which is evidence-backed:
 *
 *   1. "How are we doing?" / "Show me our improvements" → improvement report
 *   2. "What's our biggest bottleneck?" / "Where are bottlenecks?" → bottleneck top-N
 *   3. "Process stats for X" / "How long does maintenance take?" → process stats
 *
 * The answer shape is a discriminated union so the chat-ui generative-ui
 * layer can render a Sankey / rolling-trend / before-after chart without
 * coupling to the internal aggregation code.
 */

import type { Bottleneck, ProcessKind, ProcessStats } from './types.js';
import type { ImprovementReport } from './types.js';
import { ALL_METRICS, ImprovementTracker } from './improvement-tracker.js';
import type { BottleneckStore } from './types.js';
import type { ProcessMiner } from './process-miner.js';

export type OrgAnswerIntent =
  | 'improvement_report'
  | 'bottleneck_top'
  | 'process_stats'
  | 'general_status';

export interface OrgAnswerRequest {
  readonly tenantId: string;
  readonly question: string;
}

export interface OrgAnswerBase {
  readonly intent: OrgAnswerIntent;
  readonly headline: string;
  readonly question: string;
  readonly tenantId: string;
  readonly blackboardBlock:
    | 'before_after_chart'
    | 'bottleneck_sankey'
    | 'rolling_trend'
    | 'status_summary';
}

export interface ImprovementAnswer extends OrgAnswerBase {
  readonly intent: 'improvement_report';
  readonly blackboardBlock: 'before_after_chart';
  readonly report: ImprovementReport;
}

export interface BottleneckAnswer extends OrgAnswerBase {
  readonly intent: 'bottleneck_top';
  readonly blackboardBlock: 'bottleneck_sankey';
  readonly bottlenecks: readonly Bottleneck[];
}

export interface ProcessStatsAnswer extends OrgAnswerBase {
  readonly intent: 'process_stats';
  readonly blackboardBlock: 'rolling_trend';
  readonly stats: ProcessStats;
}

export interface GeneralStatusAnswer extends OrgAnswerBase {
  readonly intent: 'general_status';
  readonly blackboardBlock: 'status_summary';
  readonly report: ImprovementReport;
  readonly topBottlenecks: readonly Bottleneck[];
}

export type OrgAnswer =
  | ImprovementAnswer
  | BottleneckAnswer
  | ProcessStatsAnswer
  | GeneralStatusAnswer;

export interface OrgQueryServiceDeps {
  readonly miner: ProcessMiner;
  readonly bottleneckStore: BottleneckStore;
  readonly improvementTracker: ImprovementTracker;
}

export class OrgQueryService {
  private readonly deps: OrgQueryServiceDeps;

  constructor(deps: OrgQueryServiceDeps) {
    this.deps = deps;
  }

  async answer(req: OrgAnswerRequest): Promise<OrgAnswer> {
    if (!req.tenantId) {
      throw new Error('query_organization: tenantId required');
    }
    const intent = classifyQuestion(req.question);
    switch (intent) {
      case 'improvement_report':
        return this.buildImprovementAnswer(req);
      case 'bottleneck_top':
        return this.buildBottleneckAnswer(req);
      case 'process_stats':
        return this.buildProcessStatsAnswer(req);
      case 'general_status':
        return this.buildGeneralStatusAnswer(req);
      default:
        return this.buildGeneralStatusAnswer(req);
    }
  }

  private async buildImprovementAnswer(
    req: OrgAnswerRequest,
  ): Promise<ImprovementAnswer> {
    const report =
      await this.deps.improvementTracker.getImprovementReport(
        req.tenantId,
        { baseline: 'borjie_start', metrics: ALL_METRICS },
      );
    return {
      intent: 'improvement_report',
      blackboardBlock: 'before_after_chart',
      tenantId: req.tenantId,
      question: req.question,
      headline: report.summary,
      report,
    };
  }

  private async buildBottleneckAnswer(
    req: OrgAnswerRequest,
  ): Promise<BottleneckAnswer> {
    const bottlenecks = await this.deps.bottleneckStore.listOpen(
      req.tenantId,
    );
    const top3 = bottlenecks.slice(0, 3);
    const headline =
      top3.length === 0
        ? 'No open bottlenecks detected right now — every tracked process is within normal bands.'
        : `Top bottleneck: ${top3[0].bottleneckKind.replace('_', ' ')} at '${top3[0].stage}' (${top3[0].severity}).`;
    return {
      intent: 'bottleneck_top',
      blackboardBlock: 'bottleneck_sankey',
      tenantId: req.tenantId,
      question: req.question,
      headline,
      bottlenecks: top3,
    };
  }

  private async buildProcessStatsAnswer(
    req: OrgAnswerRequest,
  ): Promise<ProcessStatsAnswer> {
    const kind = extractProcessKind(req.question) ?? 'maintenance_case';
    const stats = await this.deps.miner.getProcessStats(
      req.tenantId,
      kind,
    );
    const headline =
      stats.totalObservations === 0
        ? `No ${kind.replace('_', ' ')} observations yet.`
        : `${kind.replace('_', ' ')}: ${stats.distinctInstances} instances, ${(stats.reopenRate * 100).toFixed(1)}% re-open rate.`;
    return {
      intent: 'process_stats',
      blackboardBlock: 'rolling_trend',
      tenantId: req.tenantId,
      question: req.question,
      headline,
      stats,
    };
  }

  private async buildGeneralStatusAnswer(
    req: OrgAnswerRequest,
  ): Promise<GeneralStatusAnswer> {
    const [report, bottlenecks] = await Promise.all([
      this.deps.improvementTracker.getImprovementReport(req.tenantId, {
        baseline: 'borjie_start',
      }),
      this.deps.bottleneckStore.listOpen(req.tenantId),
    ]);
    const top3 = bottlenecks.slice(0, 3);
    const headline =
      report.deltas.length === 0
        ? top3.length === 0
          ? 'All quiet — not enough history yet to diff, and no open bottlenecks.'
          : `${top3.length} open bottleneck(s); not enough history yet for a full improvement report.`
        : `${report.summary} ${top3.length} open bottleneck(s).`;
    return {
      intent: 'general_status',
      blackboardBlock: 'status_summary',
      tenantId: req.tenantId,
      question: req.question,
      headline,
      report,
      topBottlenecks: top3,
    };
  }
}

export function createOrgQueryService(
  deps: OrgQueryServiceDeps,
): OrgQueryService {
  return new OrgQueryService(deps);
}

export function classifyQuestion(question: string): OrgAnswerIntent {
  const q = question.toLowerCase();
  if (
    /bottleneck|stuck|slow|stall|wait/.test(q)
  ) {
    return 'bottleneck_top';
  }
  if (
    /improve|change|better|since we adopted|compared to|before|after|trend|progress/.test(
      q,
    )
  ) {
    return 'improvement_report';
  }
  if (
    /how (long|many|often)|process|stage|statistic|average|typical|p95|p50|reopen/.test(
      q,
    )
  ) {
    return 'process_stats';
  }
  if (
    /how are we|how's the org|health|overview|status|big picture|what's up/.test(
      q,
    )
  ) {
    return 'general_status';
  }
  return 'general_status';
}

export function extractProcessKind(
  question: string,
): ProcessKind | null {
  const q = question.toLowerCase();
  if (/maintenance|ticket|repair/.test(q)) return 'maintenance_case';
  if (/renewal|renew/.test(q)) return 'lease_renewal';
  if (/arrear|overdue|collection/.test(q)) return 'arrears_case';
  if (/payment|reconcile/.test(q)) return 'payment_reconcile';
  if (/approval|approve/.test(q)) return 'approval_decision';
  if (/tender|bid/.test(q)) return 'tender_bid';
  if (/inspection/.test(q)) return 'inspection';
  if (/letter|notice/.test(q)) return 'letter_generation';
  if (/training/.test(q)) return 'training_completion';
  return null;
}
