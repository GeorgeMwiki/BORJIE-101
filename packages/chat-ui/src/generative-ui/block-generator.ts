/**
 * UI Block Generator (BORJIE mining-estate)
 *
 * Zero-LLM post-processing. Given the AI's raw text + tool calls, produce
 * structured UI blocks. Re-keyed from LitFin financial topics to mining
 * estate topics: royalty affordability, outstanding royalties, offtake,
 * maintenance, asset comparison, and the 5 Ps of operator risk.
 */

import { generateBlockId } from './types';
import type {
  UIBlock,
  RoyaltyAffordabilityCalculatorBlock,
  FivePsRiskWheelBlock,
  OutstandingRoyaltyProjectionChartBlock,
  OfftakeTimelineDiagramBlock,
  MaintenanceCaseFlowDiagramBlock,
  AssetComparisonTableBlock,
  ConceptCardBlock,
  QuickRepliesBlock,
} from './types';

function safeId(): string {
  try {
    return generateBlockId();
  } catch {
    // Bug fix A-BUG-DEEP #11: fall back to crypto.randomUUID() when
    // available; Math.random() is the last-ditch shim.
    const cryptoApi =
      (typeof globalThis !== 'undefined' &&
        (globalThis as { crypto?: { randomUUID?: () => string } }).crypto) ||
      undefined;
    if (cryptoApi?.randomUUID) {
      return `block-${cryptoApi.randomUUID()}`;
    }
    // eslint-disable-next-line no-restricted-syntax -- SCRUB-5f: rule-disabled because Math.random is an acceptable last-ditch fallback for transient UI block ids when crypto.randomUUID is unavailable
    return `block-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

const ROYALTY_AFFORDABILITY_PATTERNS = [
  /royalty affordability/i,
  /royalty[- ]to[- ]income/i,
  /royalty ratio/i,
  /can .{0,20}afford/i,
];

const OUTSTANDING_ROYALTY_PATTERNS = [
  /outstanding royalt(y|ies)/i,
  /unpaid royalty/i,
  /royalty overdue/i,
  /delinquen(t|cy)/i,
];

const OFFTAKE_TIMELINE_PATTERNS = [
  /offtake (timeline|lifecycle|period|term)/i,
  /renewal window/i,
  /offtake end/i,
];

const MAINTENANCE_PATTERNS = [
  /maintenance (case|flow|workflow|request|ticket)/i,
  /work order/i,
  /repair request/i,
];

const FIVE_PS_PATTERNS = [
  /five ?p'?s/i,
  /5 ?p'?s/i,
  /operator risk/i,
  /payment history.{0,40}asset fit/i,
];

const ASSET_COMPARISON_PATTERNS = [
  /compare (these )?assets/i,
  /asset comparison/i,
  /unit A .{0,20}unit B/i,
  /side by side/i,
];

function matchAny(text: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

/**
 * Optional localised labels for blocks emitted by the generator.
 *
 * The generator produces UIBlock objects that the consumer app renders.
 * When `labels` is omitted the generator uses English defaults — this
 * preserves the previous behaviour. Callers in apps with `useTranslations`
 * are expected to pass localised strings (the package is library-only and
 * cannot resolve `t()` calls itself).
 */
export interface BlockGeneratorLabels {
  readonly offtakeTimelineSigning?: string;
  readonly offtakeTimelineRoyaltyStart?: string;
  readonly offtakeTimelineRenewalWindow?: string;
  readonly offtakeTimelineOfftakeEnd?: string;
  readonly maintenanceInProgress?: string;
  readonly assetComparisonMonthlyRoyalty?: string;
  readonly assetComparisonSecurityDeposit?: string;
  readonly quickReplyGoDeeper?: string;
  readonly quickReplyTestMe?: string;
}

export interface BlockGeneratorInput {
  readonly responseText: string;
  readonly toolCalls: readonly string[];
  readonly language?: 'en' | 'sw';
  readonly defaultCurrency?: string;
  readonly labels?: BlockGeneratorLabels;
}

export function generateBlocks(input: BlockGeneratorInput): readonly UIBlock[] {
  // Follow-up KI-005 (#33): resolve defaultCurrency from tenant.defaultCurrency /
  //   getDefaultCurrency(tenant.countryCode) via @borjie/compliance-plugins
  //   once tenants-table migration lands. USD is the neutral fallback.
  //   See Docs/KNOWN_ISSUES.md#ki-005.
  const { responseText, toolCalls, defaultCurrency = 'USD', labels = {} } = input;
  const blocks: UIBlock[] = [];

  // English defaults — consumer apps override via `labels` to localise.
  const L = {
    offtakeTimelineSigning: labels.offtakeTimelineSigning ?? 'Signing',
    offtakeTimelineRoyaltyStart: labels.offtakeTimelineRoyaltyStart ?? 'Royalty start',
    offtakeTimelineRenewalWindow: labels.offtakeTimelineRenewalWindow ?? 'Renewal window',
    offtakeTimelineOfftakeEnd: labels.offtakeTimelineOfftakeEnd ?? 'Offtake end',
    maintenanceInProgress: labels.maintenanceInProgress ?? 'In progress',
    assetComparisonMonthlyRoyalty: labels.assetComparisonMonthlyRoyalty ?? 'Monthly royalty',
    assetComparisonSecurityDeposit: labels.assetComparisonSecurityDeposit ?? 'Security deposit',
    quickReplyGoDeeper: labels.quickReplyGoDeeper ?? 'Go deeper',
    quickReplyTestMe: labels.quickReplyTestMe ?? 'Test me',
  };

  if (
    toolCalls.includes('royalty-affordability-calculator') ||
    matchAny(responseText, ROYALTY_AFFORDABILITY_PATTERNS)
  ) {
    const block: RoyaltyAffordabilityCalculatorBlock = {
      id: safeId(),
      type: 'royalty_affordability_calculator',
      position: 'below',
      defaultRoyalty: 25000,
      defaultIncome: 100000,
      currency: defaultCurrency,
    };
    blocks.push(block);
  }

  if (matchAny(responseText, OUTSTANDING_ROYALTY_PATTERNS)) {
    const monthsDelinquent = 3;
    const monthlyRoyalty = 25000;
    const lateFeePerMonth = 1000;
    const points = Array.from({ length: monthsDelinquent + 1 }, (_, i) => ({
      month: i,
      cumulative: i * (monthlyRoyalty + lateFeePerMonth),
    }));
    const block: OutstandingRoyaltyProjectionChartBlock = {
      id: safeId(),
      type: 'outstanding_royalty_projection_chart',
      position: 'below',
      title: 'Outstanding-royalty projection',
      monthlyRoyalty,
      currency: defaultCurrency,
      monthsDelinquent,
      lateFeePerMonth,
      points,
    };
    blocks.push(block);
  }

  if (matchAny(responseText, OFFTAKE_TIMELINE_PATTERNS)) {
    const block: OfftakeTimelineDiagramBlock = {
      id: safeId(),
      type: 'offtake_timeline_diagram',
      position: 'below',
      title: 'Offtake timeline',
      events: [
        { label: L.offtakeTimelineSigning, date: 'Month 0', status: 'completed' },
        { label: L.offtakeTimelineRoyaltyStart, date: 'Month 0', status: 'completed' },
        { label: L.offtakeTimelineRenewalWindow, date: 'Month 10', status: 'current' },
        { label: L.offtakeTimelineOfftakeEnd, date: 'Month 12', status: 'upcoming' },
      ],
    };
    blocks.push(block);
  }

  if (matchAny(responseText, MAINTENANCE_PATTERNS)) {
    const block: MaintenanceCaseFlowDiagramBlock = {
      id: safeId(),
      type: 'maintenance_case_flow_diagram',
      position: 'below',
      title: 'Maintenance case flow',
      currentStage: 'assigned',
      stages: [
        { id: 'reported', label: 'Reported' },
        { id: 'triaged', label: 'Triaged' },
        { id: 'assigned', label: 'Assigned' },
        { id: 'in_progress', label: L.maintenanceInProgress },
        { id: 'resolved', label: 'Resolved' },
      ],
    };
    blocks.push(block);
  }

  if (matchAny(responseText, FIVE_PS_PATTERNS)) {
    const block: FivePsRiskWheelBlock = {
      id: safeId(),
      type: 'five_ps_operator_risk_wheel',
      position: 'below',
      title: '5 Ps of operator risk',
      scores: {
        paymentHistory: 70,
        assetFit: 85,
        purpose: 60,
        person: 80,
        protection: 55,
      },
      overallRating: 'B',
    };
    blocks.push(block);
  }

  if (matchAny(responseText, ASSET_COMPARISON_PATTERNS)) {
    const block: AssetComparisonTableBlock = {
      id: safeId(),
      type: 'asset_comparison_table',
      position: 'below',
      title: 'Asset comparison',
      columns: [{ header: 'Unit A' }, { header: 'Unit B', highlight: true }],
      rows: [
        { label: L.assetComparisonMonthlyRoyalty, values: ['25,000', '30,000'] },
        { label: 'Pits', values: ['2', '3'] },
        { label: L.assetComparisonSecurityDeposit, values: ['50,000', '60,000'] },
      ],
    };
    blocks.push(block);
  }

  // Always include quick replies if blocks were emitted
  if (blocks.length > 0) {
    const replies: QuickRepliesBlock = {
      id: safeId(),
      type: 'quick_replies',
      position: 'below',
      replies: [
        { label: L.quickReplyGoDeeper, prompt: 'Can you go deeper on this concept?' },
        { label: L.quickReplyTestMe, prompt: 'Quiz me on what we just discussed' },
      ],
    };
    blocks.push(replies);
  }

  return blocks;
}

/**
 * Helper: promote an InsightCard-style payload into a ConceptCard with
 * extracted key points (used by renderer when the AI returns bare text).
 */
export function promoteInsightToConcept(
  title: string,
  message: string,
): ConceptCardBlock {
  const sentences = message
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 10);
  const keyPoints = sentences.length >= 2 ? sentences.slice(0, 4) : [message.slice(0, 150)];
  return {
    id: safeId(),
    type: 'concept_card',
    position: 'below',
    title,
    description: '',
    keyPoints,
    bloomLevel: 'understand',
  };
}
