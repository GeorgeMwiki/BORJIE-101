/**
 * ProactiveOrchestrator — signal → proposal → approval → execute.
 *
 * The orchestrator is a pure coordinator. It does NOT own a subscription
 * loop (signal-source events come in via `ingestSignal`), and it does NOT
 * execute actions directly — it delegates to a `ProposalExecutor` port the
 * caller wires to the concrete orchestrator or task-agents executor.
 *
 * The flow per signal:
 *   1. find the first matching template (iteration order == registration)
 *   2. draft a Proposal
 *   3. check `autonomy.isAuthorized(tenant, domain, action)` — if the gate
 *      closes OR the template is safety-critical OR confidence is below
 *      `confidenceFloor` OR a shadow-mode check says shadow-only: route to
 *      approval (record + return).
 *   4. otherwise execute via `executor.execute(proposal)`.
 *
 * The orchestrator never throws — errors are captured, recorded as audit
 * events, and the proposal is returned with `rejected` outcome so
 * supervisors can iterate a batch of signals without a bad one tearing down
 * the loop.
 */
import type { AutonomyPolicyService } from '../autonomy/autonomy-policy-service.js';
import type {
  Proposal,
  ProposalOutcome,
  Signal,
  ProactiveAuditSink,
  ProposalExecutor,
  ApprovalReason,
} from './types.js';
import {
  DEFAULT_PROPOSAL_TEMPLATES,
  stampProposal,
  type ProposalTemplate,
} from './proposal-templates.js';

export interface ShadowModeGate {
  /**
   * Returns true if the (tenant, domain) is currently in shadow mode —
   * the orchestrator must short-circuit BEFORE execute.
   */
  isShadow(tenantId: string, domain: string): boolean | Promise<boolean>;
  /**
   * Called when the orchestrator records a shadow "would-have-done"
   * decision. The implementation persists it for later report generation.
   */
  recordShadow(proposal: Proposal): Promise<void> | void;
}

export interface ProactiveOrchestratorDeps {
  readonly templates?: readonly ProposalTemplate[];
  readonly autonomy?: AutonomyPolicyService | null;
  readonly executor: ProposalExecutor;
  readonly auditSink?: ProactiveAuditSink | null;
  readonly shadowGate?: ShadowModeGate | null;
  readonly clock?: () => Date;
  /**
   * Minimum confidence required for auto-execution. Below this the
   * proposal routes to approval with reason `low_confidence`. Default 0.6.
   */
  readonly confidenceFloor?: number;
}

export interface IngestResult {
  readonly signalId: string;
  readonly proposal: Proposal | null;
  readonly outcome: ProposalOutcome | null;
  readonly skipped: boolean;
  readonly skipReason: string | null;
}

export class ProactiveOrchestrator {
  private readonly templates: readonly ProposalTemplate[];
  private readonly confidenceFloor: number;

  constructor(private readonly deps: ProactiveOrchestratorDeps) {
    this.templates = deps.templates ?? DEFAULT_PROPOSAL_TEMPLATES;
    this.confidenceFloor = deps.confidenceFloor ?? 0.6;
  }

  /**
   * Drop-in helper: find the first template that matches the signal.
   * Exposed for tests + to allow callers to pre-check coverage.
   */
  matchTemplate(signal: Signal): ProposalTemplate | null {
    for (const t of this.templates) {
      if (t.matches(signal)) return t;
    }
    return null;
  }

  async ingestSignal(signal: Signal): Promise<IngestResult> {
    const template = this.matchTemplate(signal);
    if (!template) {
      return {
        signalId: signal.signalId,
        proposal: null,
        outcome: null,
        skipped: true,
        skipReason: 'no_matching_template',
      };
    }

    const now = this.now();
    const body = template.draft(signal);
    // Compute the approval gate.
    const gate = await this.resolveApprovalReason(template, body.confidence, signal);
    const proposal = stampProposal(body, now, gate);

    await this.emitAudit({
      kind: 'proposal_drafted',
      proposalId: proposal.proposalId,
      tenantId: proposal.tenantId,
      domain: proposal.domain,
      occurredAt: proposal.draftedAt,
      detail: {
        templateId: template.templateId,
        signalId: signal.signalId,
        requiresApprovalBecause: gate,
      },
    });

    // Shadow mode short-circuit — record + return without executing.
    if (gate === 'shadow_mode') {
      if (this.deps.shadowGate) {
        await this.deps.shadowGate.recordShadow(proposal);
      }
      await this.emitAudit({
        kind: 'proposal_awaiting_approval',
        proposalId: proposal.proposalId,
        tenantId: proposal.tenantId,
        domain: proposal.domain,
        occurredAt: now.toISOString(),
        detail: { reason: 'shadow_mode' },
      });
      return {
        signalId: signal.signalId,
        proposal,
        outcome: null,
        skipped: false,
        skipReason: null,
      };
    }

    if (gate !== null) {
      await this.emitAudit({
        kind: 'proposal_awaiting_approval',
        proposalId: proposal.proposalId,
        tenantId: proposal.tenantId,
        domain: proposal.domain,
        occurredAt: now.toISOString(),
        detail: { reason: gate },
      });
      return {
        signalId: signal.signalId,
        proposal,
        outcome: null,
        skipped: false,
        skipReason: null,
      };
    }

    // Auto-execute path.
    let outcome: ProposalOutcome;
    try {
      outcome = await this.deps.executor.execute(proposal);
      await this.emitAudit({
        kind: 'proposal_auto_executed',
        proposalId: proposal.proposalId,
        tenantId: proposal.tenantId,
        domain: proposal.domain,
        occurredAt: outcome.executedAt ?? now.toISOString(),
        detail: { outcomeKind: outcome.outcome },
      });
    } catch (err) {
      outcome = {
        proposalId: proposal.proposalId,
        outcome: 'rejected',
        executedAt: null,
        note: `executor_failed: ${err instanceof Error ? err.message : String(err)}`,
      };
      await this.emitAudit({
        kind: 'proposal_rejected',
        proposalId: proposal.proposalId,
        tenantId: proposal.tenantId,
        domain: proposal.domain,
        occurredAt: now.toISOString(),
        detail: { error: outcome.note },
      });
    }
    return {
      signalId: signal.signalId,
      proposal,
      outcome,
      skipped: false,
      skipReason: null,
    };
  }

  private async resolveApprovalReason(
    template: ProposalTemplate,
    confidence: number,
    signal: Signal,
  ): Promise<ApprovalReason> {
    if (template.safetyCritical) return 'safety_critical';

    // Shadow mode gate — caller-configured.
    if (this.deps.shadowGate) {
      const shadow = await this.deps.shadowGate.isShadow(signal.tenantId, template.domain);
      if (shadow) return 'shadow_mode';
    }

    if (confidence < this.confidenceFloor) return 'low_confidence';

    if (!this.deps.autonomy) return null;
    try {
      const decision = await this.deps.autonomy.isAuthorized(
        signal.tenantId,
        template.domain,
        template.autonomyAction,
      );
      if (decision.authorized) return null;
      return 'policy_threshold';
    } catch {
      // If the policy call fails, default to requiring approval — fail safe.
      return 'policy_threshold';
    }
  }

  private async emitAudit(event: Parameters<ProactiveAuditSink['record']>[0]): Promise<void> {
    if (!this.deps.auditSink) return;
    try {
      await this.deps.auditSink.record(event);
    } catch {
      // Swallow — audit failures must never tear down the loop.
    }
  }

  private now(): Date {
    return this.deps.clock?.() ?? new Date();
  }
}

/**
 * In-memory audit sink — collects events for test introspection. Not for
 * production use; production wires the `AutonomousActionAudit` sink.
 */
export class InMemoryProactiveAuditSink implements ProactiveAuditSink {
  private readonly events: Array<Parameters<ProactiveAuditSink['record']>[0]> = [];

  record(event: Parameters<ProactiveAuditSink['record']>[0]): void {
    this.events.push(event);
  }

  listEvents(): readonly Parameters<ProactiveAuditSink['record']>[0][] {
    return [...this.events];
  }
}

/**
 * No-op executor — used in tests + in shadow-only deployments.
 */
export class NoopProposalExecutor implements ProposalExecutor {
  async execute(proposal: Proposal): Promise<ProposalOutcome> {
    return {
      proposalId: proposal.proposalId,
      outcome: 'auto_executed',
      executedAt: new Date().toISOString(),
      note: 'noop',
    };
  }
}
