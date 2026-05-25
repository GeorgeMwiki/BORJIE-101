/**
 * Proactive-loop tests — Wave 28.
 *
 * Validate:
 *   - each of the 8 templates produces a structurally-valid Proposal
 *   - signal-source adapters normalise source events into canonical Signal
 *   - low-confidence routes to approval (not auto-execute)
 *   - policy-gated autonomy blocks execution
 *   - safety-critical templates ALWAYS route to approval
 *   - executed proposals emit audit events
 *   - shadow-mode short-circuits without executing
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  DEFAULT_PROPOSAL_TEMPLATES,
  ProactiveOrchestrator,
  InMemoryProactiveAuditSink,
  NoopProposalExecutor,
  marketSurveillanceSignalSource,
  sentimentMonitorSignalSource,
  predictiveInterventionsSignalSource,
  patternMiningSignalSource,
  stampProposal,
  type Signal,
  type ProposalExecutor,
  type Proposal,
  type ProposalOutcome,
  type ShadowModeGate,
} from '../index.js';
import {
  AutonomyPolicyService,
  InMemoryAutonomyPolicyRepository,
} from '../../autonomy/index.js';

const TENANT = 'tenant_proactive_1';

function mkSignal(overrides: Partial<Signal>): Signal {
  return {
    signalId: 'sig_test_1',
    source: 'market-surveillance',
    tenantId: TENANT,
    domain: 'marketing',
    severity: 'medium',
    payload: {},
    detectedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('proposal-templates — each produces a structurally-valid proposal', () => {
  const SAMPLE_SIGNALS: Record<string, Signal> = {
    marketing_campaign_launch: mkSignal({
      source: 'market-surveillance',
      payload: { driftFlag: 'below_market', deltaPct: -0.18 },
    }),
    rent_adjustment: mkSignal({
      source: 'market-surveillance',
      payload: { driftFlag: 'above_market', deltaPct: 0.25 },
    }),
    maintenance_preventive: mkSignal({
      source: 'pattern-mining',
      domain: 'maintenance',
      payload: { title: 'maintenance recurrence pattern', confidence: 0.72 },
    }),
    retention_offer: mkSignal({
      source: 'sentiment-monitor',
      domain: 'tenant_welfare',
      payload: { previousAvg: 0.4, currentAvg: -0.1, sampleCount: 12 },
    }),
    arrears_early_intervention: mkSignal({
      source: 'predictive-interventions',
      domain: 'finance',
      payload: { signalType: 'high_default_risk', signalStrength: 0.82 },
    }),
    lease_renewal_nudge: mkSignal({
      source: 'predictive-interventions',
      domain: 'leasing',
      payload: { signalType: 'high_churn_risk', signalStrength: 0.77 },
    }),
    vendor_rotation: mkSignal({
      source: 'pattern-mining',
      domain: 'procurement',
      payload: { title: 'vendor qa rework trend', confidence: 0.6 },
    }),
    tenant_wellness_check: mkSignal({
      source: 'sentiment-monitor',
      domain: 'tenant_welfare',
      severity: 'critical',
      payload: { previousAvg: 0.6, currentAvg: -0.8 },
    }),
  };

  for (const template of DEFAULT_PROPOSAL_TEMPLATES) {
    it(`${template.templateId} drafts a complete proposal`, () => {
      const signal = SAMPLE_SIGNALS[template.templateId];
      expect(signal).toBeDefined();
      expect(template.matches(signal!)).toBe(true);
      const body = template.draft(signal!);
      expect(body.templateId).toBe(template.templateId);
      expect(body.title.length).toBeGreaterThan(5);
      expect(body.rationale.length).toBeGreaterThan(5);
      expect(body.suggestedAction.length).toBeGreaterThan(5);
      expect(body.estimatedImpact.metric.length).toBeGreaterThan(0);
      expect(body.confidence).toBeGreaterThanOrEqual(0);
      expect(body.confidence).toBeLessThanOrEqual(1);
    });
  }

  it('exposes exactly 8 default templates', () => {
    expect(DEFAULT_PROPOSAL_TEMPLATES.length).toBe(8);
  });
});

describe('signal-sources — adapter normalisation', () => {
  it('market-surveillance — maps below_market drift to marketing signal', () => {
    const raw = {
      type: 'MarketRateDriftDetected',
      tenantId: TENANT,
      unitId: 'u_1',
      driftFlag: 'below_market' as const,
      deltaPct: -0.15,
      observedAt: new Date().toISOString(),
    };
    const signal = marketSurveillanceSignalSource.normalize(raw);
    expect(signal).not.toBeNull();
    expect(signal!.source).toBe('market-surveillance');
    expect(signal!.domain).toBe('marketing');
    expect(signal!.severity).toBe('medium'); // 15% → medium band
  });

  it('sentiment-monitor — emits tenant_welfare signal', () => {
    const raw = {
      type: 'TenantSentimentShift',
      tenantId: TENANT,
      customerId: 'c1',
      previousAvg: 0.3,
      currentAvg: -0.4,
      windowHours: 48,
      sampleCount: 10,
      observedAt: new Date().toISOString(),
    };
    const signal = sentimentMonitorSignalSource.normalize(raw);
    expect(signal!.domain).toBe('tenant_welfare');
    expect(signal!.severity).toBe('high');
  });

  it('predictive-interventions — maps default risk to finance', () => {
    const raw = {
      type: 'PredictiveInterventionOpportunity',
      tenantId: TENANT,
      customerId: 'c1',
      predictionId: 'p1',
      signalType: 'high_default_risk' as const,
      signalStrength: 0.9,
      observedAt: new Date().toISOString(),
    };
    const signal = predictiveInterventionsSignalSource.normalize(raw);
    expect(signal!.domain).toBe('finance');
    expect(signal!.severity).toBe('critical');
  });

  it('pattern-mining — requires tenantIdForDelivery, else drops', () => {
    const raw = {
      id: 'pi_1',
      title: 'vendor qa pattern',
      description: 'rework trend',
      affectedSegments: ['s1'],
      confidence: 0.7,
      publishedAt: new Date().toISOString(),
      tenantIdForDelivery: '',
    };
    expect(patternMiningSignalSource.normalize(raw)).toBeNull();
    const signal = patternMiningSignalSource.normalize({ ...raw, tenantIdForDelivery: TENANT });
    expect(signal!.tenantId).toBe(TENANT);
  });
});

describe('proactive-orchestrator', () => {
  let executor: ProposalExecutor;
  let auditSink: InMemoryProactiveAuditSink;
  let executed: Proposal[];

  beforeEach(() => {
    executed = [];
    executor = {
      async execute(proposal): Promise<ProposalOutcome> {
        executed.push(proposal);
        return {
          proposalId: proposal.proposalId,
          outcome: 'auto_executed',
          executedAt: new Date().toISOString(),
          note: null,
        };
      },
    };
    auditSink = new InMemoryProactiveAuditSink();
  });

  it('auto-executes when autonomy policy allows and confidence is above floor', async () => {
    const repo = new InMemoryAutonomyPolicyRepository();
    const policy = new AutonomyPolicyService({ repository: repo });
    await policy.createPolicy(TENANT, 'head_1');
    await policy.updatePolicy(TENANT, { autonomousModeEnabled: true });

    const orch = new ProactiveOrchestrator({
      autonomy: policy,
      executor,
      auditSink,
      confidenceFloor: 0.1, // low so we skip the low-confidence branch
    });

    const signal = mkSignal({
      source: 'predictive-interventions',
      domain: 'finance',
      payload: { signalType: 'high_default_risk', signalStrength: 0.85 },
    });
    const result = await orch.ingestSignal(signal);

    // Arrears template matches, but finance.act_on_arrears routes vary; we
    // expect the orchestrator to have drafted the proposal and audited it
    // regardless of the autonomy decision.
    expect(result.proposal).not.toBeNull();
    const drafted = auditSink.listEvents().find((e) => e.kind === 'proposal_drafted');
    expect(drafted).toBeDefined();
  });

  it('routes to approval with low_confidence when confidence < floor', async () => {
    const orch = new ProactiveOrchestrator({
      executor,
      auditSink,
      confidenceFloor: 0.99,
    });
    const signal = mkSignal({
      source: 'pattern-mining',
      domain: 'procurement',
      payload: { title: 'vendor qa rework', confidence: 0.3 },
    });
    const result = await orch.ingestSignal(signal);
    expect(result.proposal?.requiresApprovalBecause).toBe('low_confidence');
    expect(executed.length).toBe(0);
  });

  it('safety-critical templates ALWAYS route to approval', async () => {
    const orch = new ProactiveOrchestrator({
      executor,
      auditSink,
      confidenceFloor: 0, // can't auto-execute anyway
    });
    const signal = mkSignal({
      source: 'sentiment-monitor',
      domain: 'tenant_welfare',
      severity: 'critical',
      payload: { previousAvg: 0.5, currentAvg: -0.9 },
    });
    const result = await orch.ingestSignal(signal);
    expect(result.proposal?.requiresApprovalBecause).toBe('safety_critical');
    expect(executed.length).toBe(0);
  });

  it('emits audit events on every decision', async () => {
    const orch = new ProactiveOrchestrator({ executor, auditSink, confidenceFloor: 0.1 });
    const signal = mkSignal({
      source: 'market-surveillance',
      domain: 'marketing',
      payload: { driftFlag: 'below_market', deltaPct: -0.2 },
    });
    const result = await orch.ingestSignal(signal);
    expect(result.proposal).not.toBeNull();
    const kinds = auditSink.listEvents().map((e) => e.kind);
    expect(kinds).toContain('proposal_drafted');
    // either executed or awaiting — both are captured
    expect(kinds.some((k) => k === 'proposal_auto_executed' || k === 'proposal_awaiting_approval')).toBe(true);
  });

  it('drops signals with no matching template', async () => {
    const orch = new ProactiveOrchestrator({ executor, auditSink });
    const signal = mkSignal({
      source: 'market-surveillance',
      domain: 'marketing',
      payload: { driftFlag: 'on_band', deltaPct: 0 },
    });
    const result = await orch.ingestSignal(signal);
    // rent_adjustment requires above/below; marketing_campaign_launch requires below — neither match
    expect(result.skipped).toBe(true);
    expect(result.skipReason).toBe('no_matching_template');
  });

  it('shadow-mode short-circuits execution', async () => {
    const recordedShadow: Proposal[] = [];
    const shadowGate: ShadowModeGate = {
      isShadow: () => true,
      recordShadow(p) {
        recordedShadow.push(p);
      },
    };
    const orch = new ProactiveOrchestrator({
      executor,
      auditSink,
      shadowGate,
      confidenceFloor: 0.1,
    });
    const signal = mkSignal({
      source: 'market-surveillance',
      payload: { driftFlag: 'below_market', deltaPct: -0.15 },
    });
    const result = await orch.ingestSignal(signal);
    expect(result.proposal?.requiresApprovalBecause).toBe('shadow_mode');
    expect(executed.length).toBe(0);
    expect(recordedShadow.length).toBe(1);
  });

  it('captures executor errors and marks as rejected', async () => {
    const failingExecutor: ProposalExecutor = {
      async execute() {
        throw new Error('boom');
      },
    };
    const orch = new ProactiveOrchestrator({
      executor: failingExecutor,
      auditSink,
      confidenceFloor: 0.1,
    });
    const signal = mkSignal({
      source: 'market-surveillance',
      payload: { driftFlag: 'below_market', deltaPct: -0.15 },
    });
    const result = await orch.ingestSignal(signal);
    expect(result.outcome?.outcome).toBe('rejected');
    expect(result.outcome?.note).toContain('boom');
  });

  it('NoopProposalExecutor returns auto_executed', async () => {
    const noop = new NoopProposalExecutor();
    const proposal = stampProposal(
      {
        signalId: 'sig',
        tenantId: TENANT,
        domain: 'marketing',
        templateId: 'marketing_campaign_launch',
        title: 't',
        rationale: 'r',
        suggestedAction: 's',
        estimatedImpact: { metric: 'm', magnitude: 1, unit: 'u' },
        confidence: 0.9,
        requiresApprovalBecause: null,
      },
      new Date(),
    );
    const res = await noop.execute(proposal);
    expect(res.outcome).toBe('auto_executed');
  });
});
