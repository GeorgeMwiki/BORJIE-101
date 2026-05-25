/**
 * Signal-source adapters.
 *
 * Each AI-native capability (market-surveillance, sentiment-monitor,
 * predictive-interventions, pattern-mining) emits its own event shape.
 * This module provides a uniform `SignalSource` adapter that wraps those
 * shapes into the canonical `Signal` the proactive orchestrator consumes.
 *
 * Adapters are pure functions over the source event — they do NOT own a
 * subscription loop. The orchestrator subscribes to its event bus and
 * feeds raw events into `adapter.normalize(rawEvent)`. This keeps the
 * existing AI-native capability sources untouched (Goal #2 constraint).
 */
import { randomUUID } from 'node:crypto';
import type { Signal, SignalSeverity, SignalSourceId } from './types.js';
import type { AutonomyDomain } from '../autonomy/types.js';

/**
 * Adapter contract. Each adapter knows how to take a source-native event
 * and produce zero-or-one Signal. Returning `null` means "not relevant —
 * drop on the floor". The orchestrator filters nulls upstream.
 */
export interface SignalSource<RawEvent = unknown> {
  readonly sourceId: SignalSourceId;
  readonly eventType: string;
  normalize(raw: RawEvent): Signal | null;
}

// ---------------------------------------------------------------------------
// Shared helpers (kept tiny so adapters stay sub-40-line readable units)
// ---------------------------------------------------------------------------

function freshSignalId(source: SignalSourceId): string {
  // Prefer randomUUID when available (Node >= 18); fall back to time-slug.
  try {
    return `sig_${source}_${randomUUID()}`;
  } catch {
    return `sig_${source}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

// ---------------------------------------------------------------------------
// Market-surveillance adapter
// Source emits `MarketRateDriftDetected` — an above/below-market deviation.
// Maps to `marketing` domain because the corrective action is a listing
// adjustment or ad-campaign bump.
// ---------------------------------------------------------------------------

interface MarketDriftRaw {
  readonly type: 'MarketRateDriftDetected';
  readonly tenantId: string;
  readonly unitId: string;
  readonly driftFlag: 'below_market' | 'above_market';
  readonly deltaPct: number;
  readonly observedAt: string;
}

export const marketSurveillanceSignalSource: SignalSource<MarketDriftRaw> = {
  sourceId: 'market-surveillance',
  eventType: 'MarketRateDriftDetected',
  normalize(raw) {
    if (!isObject(raw) || raw.type !== 'MarketRateDriftDetected') return null;
    const abs = Math.abs(Number(raw.deltaPct));
    const severity: SignalSeverity =
      abs >= 0.3 ? 'critical' : abs >= 0.2 ? 'high' : abs >= 0.1 ? 'medium' : 'low';
    const domain: AutonomyDomain = 'marketing';
    return {
      signalId: freshSignalId('market-surveillance'),
      source: 'market-surveillance',
      tenantId: raw.tenantId,
      domain,
      severity,
      payload: {
        unitId: raw.unitId,
        driftFlag: raw.driftFlag,
        deltaPct: raw.deltaPct,
      },
      detectedAt: raw.observedAt,
    };
  },
};

// ---------------------------------------------------------------------------
// Sentiment-monitor adapter
// Source emits `TenantSentimentShift` — a rolling-average tenant sentiment
// has dropped below a threshold. Maps to `tenant_welfare` (retention /
// wellness check) and `communications` — we pick tenant_welfare because
// the canonical template is a retention offer.
// ---------------------------------------------------------------------------

interface SentimentShiftRaw {
  readonly type: 'TenantSentimentShift';
  readonly tenantId: string;
  readonly customerId: string | null;
  readonly previousAvg: number;
  readonly currentAvg: number;
  readonly windowHours: number;
  readonly sampleCount: number;
  readonly observedAt: string;
}

export const sentimentMonitorSignalSource: SignalSource<SentimentShiftRaw> = {
  sourceId: 'sentiment-monitor',
  eventType: 'TenantSentimentShift',
  normalize(raw) {
    if (!isObject(raw) || raw.type !== 'TenantSentimentShift') return null;
    const drop = Number(raw.previousAvg) - Number(raw.currentAvg);
    const severity: SignalSeverity =
      drop >= 0.8 ? 'critical' : drop >= 0.5 ? 'high' : drop >= 0.25 ? 'medium' : 'low';
    return {
      signalId: freshSignalId('sentiment-monitor'),
      source: 'sentiment-monitor',
      tenantId: raw.tenantId,
      domain: 'tenant_welfare',
      severity,
      payload: {
        customerId: raw.customerId,
        previousAvg: raw.previousAvg,
        currentAvg: raw.currentAvg,
        sampleCount: raw.sampleCount,
      },
      detectedAt: raw.observedAt,
    };
  },
};

// ---------------------------------------------------------------------------
// Predictive-interventions adapter
// Source emits `PredictiveInterventionOpportunity`. Maps to `finance` when
// signalType is default/late risk, `communications` when sentiment collapse,
// `tenant_welfare` for churn risk.
// ---------------------------------------------------------------------------

type PredictiveSignalType =
  | 'high_default_risk'
  | 'high_churn_risk'
  | 'high_dispute_risk'
  | 'sentiment_collapse';

interface PredictiveOpportunityRaw {
  readonly type: 'PredictiveInterventionOpportunity';
  readonly tenantId: string;
  readonly customerId: string;
  readonly predictionId: string;
  readonly signalType: PredictiveSignalType;
  readonly signalStrength: number;
  readonly observedAt: string;
}

function predictiveDomain(signalType: PredictiveSignalType): AutonomyDomain {
  switch (signalType) {
    case 'high_default_risk':
      return 'finance';
    case 'high_dispute_risk':
      return 'legal_proceedings';
    case 'sentiment_collapse':
      return 'communications';
    case 'high_churn_risk':
    default:
      return 'tenant_welfare';
  }
}

export const predictiveInterventionsSignalSource: SignalSource<PredictiveOpportunityRaw> = {
  sourceId: 'predictive-interventions',
  eventType: 'PredictiveInterventionOpportunity',
  normalize(raw) {
    if (!isObject(raw) || raw.type !== 'PredictiveInterventionOpportunity') return null;
    const s = Number(raw.signalStrength);
    const severity: SignalSeverity =
      s >= 0.85 ? 'critical' : s >= 0.7 ? 'high' : s >= 0.5 ? 'medium' : 'low';
    return {
      signalId: freshSignalId('predictive-interventions'),
      source: 'predictive-interventions',
      tenantId: raw.tenantId,
      domain: predictiveDomain(raw.signalType),
      severity,
      payload: {
        customerId: raw.customerId,
        predictionId: raw.predictionId,
        signalType: raw.signalType,
        signalStrength: raw.signalStrength,
      },
      detectedAt: raw.observedAt,
    };
  },
};

// ---------------------------------------------------------------------------
// Pattern-mining adapter
// Source emits anonymised cross-tenant `PatternInsight` rows. Because the
// insights are cross-tenant, we synthesize one Signal per TENANT SCOPE the
// caller asks about — the orchestrator routes these as advisory signals.
// Maps to `strategic` via the `tenant_welfare` domain (closest autonomous
// domain) but severity is always <= medium (these are slow-moving trends).
// ---------------------------------------------------------------------------

interface PatternInsightRaw {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly affectedSegments: readonly string[];
  readonly confidence: number;
  readonly publishedAt: string;
  /** Orchestrator-provided: the tenant we are routing this insight to. */
  readonly tenantIdForDelivery: string;
}

export const patternMiningSignalSource: SignalSource<PatternInsightRaw> = {
  sourceId: 'pattern-mining',
  eventType: 'PatternInsight',
  normalize(raw) {
    if (!isObject(raw) || typeof raw.id !== 'string') return null;
    if (!raw.tenantIdForDelivery) return null;
    const c = Number(raw.confidence);
    const severity: SignalSeverity = c >= 0.8 ? 'medium' : 'low';
    return {
      signalId: freshSignalId('pattern-mining'),
      source: 'pattern-mining',
      tenantId: raw.tenantIdForDelivery,
      domain: 'tenant_welfare',
      severity,
      payload: {
        insightId: raw.id,
        title: raw.title,
        description: raw.description,
        affectedSegments: raw.affectedSegments,
        confidence: raw.confidence,
      },
      detectedAt: raw.publishedAt,
    };
  },
};

/**
 * The 4 default adapters the orchestrator wires. Callers may add more
 * sources (e.g. multimodal-inspection) by constructing their own
 * `SignalSource` and registering it separately.
 */
export const DEFAULT_SIGNAL_SOURCES: readonly SignalSource<unknown>[] = [
  marketSurveillanceSignalSource as unknown as SignalSource<unknown>,
  sentimentMonitorSignalSource as unknown as SignalSource<unknown>,
  predictiveInterventionsSignalSource as unknown as SignalSource<unknown>,
  patternMiningSignalSource as unknown as SignalSource<unknown>,
] as const;
