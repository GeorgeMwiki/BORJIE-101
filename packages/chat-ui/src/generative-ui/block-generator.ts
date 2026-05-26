/**
 * UI Block Generator (BORJIE estate-management)
 *
 * Zero-LLM post-processing. Given the AI's raw text + tool calls, produce
 * structured UI blocks. Re-keyed from LitFin financial topics to estate
 * management topics: rent affordability, arrears, lease, maintenance,
 * property comparison, and the 5 Ps of tenancy risk.
 */

import { generateBlockId } from './types';
import type {
  UIBlock,
  RentAffordabilityCalculatorBlock,
  FivePsRiskWheelBlock,
  ArrearsProjectionChartBlock,
  LeaseTimelineDiagramBlock,
  MaintenanceCaseFlowDiagramBlock,
  PropertyComparisonTableBlock,
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
    // eslint-disable-next-line no-restricted-syntax
    return `block-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

const RENT_AFFORDABILITY_PATTERNS = [
  /rent affordability/i,
  /rent[- ]to[- ]income/i,
  /rent ratio/i,
  /can .{0,20}afford/i,
];

const ARREARS_PATTERNS = [
  /arrears/i,
  /unpaid rent/i,
  /rent overdue/i,
  /delinquen(t|cy)/i,
];

const LEASE_TIMELINE_PATTERNS = [
  /lease (timeline|lifecycle|period|term)/i,
  /renewal window/i,
  /lease end/i,
];

const MAINTENANCE_PATTERNS = [
  /maintenance (case|flow|workflow|request|ticket)/i,
  /work order/i,
  /repair request/i,
];

const FIVE_PS_PATTERNS = [
  /five ?p'?s/i,
  /5 ?p'?s/i,
  /tenancy risk/i,
  /payment history.{0,40}property fit/i,
];

const PROPERTY_COMPARISON_PATTERNS = [
  /compare (these )?properties/i,
  /property comparison/i,
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
  readonly leaseTimelineSigning?: string;
  readonly leaseTimelineRentStart?: string;
  readonly leaseTimelineRenewalWindow?: string;
  readonly leaseTimelineLeaseEnd?: string;
  readonly maintenanceInProgress?: string;
  readonly propertyComparisonMonthlyRent?: string;
  readonly propertyComparisonSecurityDeposit?: string;
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
    leaseTimelineSigning: labels.leaseTimelineSigning ?? 'Signing',
    leaseTimelineRentStart: labels.leaseTimelineRentStart ?? 'Rent start',
    leaseTimelineRenewalWindow: labels.leaseTimelineRenewalWindow ?? 'Renewal window',
    leaseTimelineLeaseEnd: labels.leaseTimelineLeaseEnd ?? 'Lease end',
    maintenanceInProgress: labels.maintenanceInProgress ?? 'In progress',
    propertyComparisonMonthlyRent: labels.propertyComparisonMonthlyRent ?? 'Monthly rent',
    propertyComparisonSecurityDeposit: labels.propertyComparisonSecurityDeposit ?? 'Security deposit',
    quickReplyGoDeeper: labels.quickReplyGoDeeper ?? 'Go deeper',
    quickReplyTestMe: labels.quickReplyTestMe ?? 'Test me',
  };

  if (
    toolCalls.includes('rent-affordability-calculator') ||
    matchAny(responseText, RENT_AFFORDABILITY_PATTERNS)
  ) {
    const block: RentAffordabilityCalculatorBlock = {
      id: safeId(),
      type: 'rent_affordability_calculator',
      position: 'below',
      defaultRent: 25000,
      defaultIncome: 100000,
      currency: defaultCurrency,
    };
    blocks.push(block);
  }

  if (matchAny(responseText, ARREARS_PATTERNS)) {
    const monthsDelinquent = 3;
    const monthlyRent = 25000;
    const lateFeePerMonth = 1000;
    const points = Array.from({ length: monthsDelinquent + 1 }, (_, i) => ({
      month: i,
      cumulative: i * (monthlyRent + lateFeePerMonth),
    }));
    const block: ArrearsProjectionChartBlock = {
      id: safeId(),
      type: 'arrears_projection_chart',
      position: 'below',
      title: 'Arrears projection',
      monthlyRent,
      currency: defaultCurrency,
      monthsDelinquent,
      lateFeePerMonth,
      points,
    };
    blocks.push(block);
  }

  if (matchAny(responseText, LEASE_TIMELINE_PATTERNS)) {
    const block: LeaseTimelineDiagramBlock = {
      id: safeId(),
      type: 'lease_timeline_diagram',
      position: 'below',
      title: 'Lease timeline',
      events: [
        { label: L.leaseTimelineSigning, date: 'Month 0', status: 'completed' },
        { label: L.leaseTimelineRentStart, date: 'Month 0', status: 'completed' },
        { label: L.leaseTimelineRenewalWindow, date: 'Month 10', status: 'current' },
        { label: L.leaseTimelineLeaseEnd, date: 'Month 12', status: 'upcoming' },
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
      type: 'five_ps_tenancy_risk_wheel',
      position: 'below',
      title: '5 Ps of tenancy risk',
      scores: {
        paymentHistory: 70,
        propertyFit: 85,
        purpose: 60,
        person: 80,
        protection: 55,
      },
      overallRating: 'B',
    };
    blocks.push(block);
  }

  if (matchAny(responseText, PROPERTY_COMPARISON_PATTERNS)) {
    const block: PropertyComparisonTableBlock = {
      id: safeId(),
      type: 'property_comparison_table',
      position: 'below',
      title: 'Property comparison',
      columns: [{ header: 'Unit A' }, { header: 'Unit B', highlight: true }],
      rows: [
        { label: L.propertyComparisonMonthlyRent, values: ['25,000', '30,000'] },
        { label: 'Bedrooms', values: ['2', '3'] },
        { label: L.propertyComparisonSecurityDeposit, values: ['50,000', '60,000'] },
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
