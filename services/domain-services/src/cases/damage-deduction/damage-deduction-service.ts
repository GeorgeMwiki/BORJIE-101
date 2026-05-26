/**
 * Damage-Deduction Service.
 *
 * Implements state + negotiation-turn tracking. AI mediation is wired
 * through a pluggable `AiMediatorGateway` (optional); when no gateway is
 * supplied the service dynamically imports `@borjie/ai-copilot`'s
 * `draftDamageMediatorTurn` at call time, falling back to a deterministic
 * midpoint when neither the gateway nor the package is available.
 *
 * Evidence bundle assembly delegates to an optional `EvidenceBundleGateway`.
 * Ledger posting is tracked under MISSING_FEATURES_DESIGN.md §4 and is
 * intentionally left as an additive future step.
 *
 * Spec: Docs/analysis/MISSING_FEATURES_DESIGN.md §8.
 */

import type { TenantId, UserId, ISOTimestamp, Result } from '@borjie/domain-models';
import { ok, err } from '@borjie/domain-models';
import { randomHex } from '../../common/id-generator.js';
import type {
  DamageDeductionCase,
  DamageDeductionCaseId,
  FileClaimInput,
  TenantRespondInput,
  AgreeAndSettleInput,
  NegotiationTurn,
} from './damage-deduction-case.js';
import { asDamageDeductionCaseId } from './damage-deduction-case.js';

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export const DamageDeductionError = {
  CLAIM_NOT_FOUND: 'CLAIM_NOT_FOUND',
  INVALID_INPUT: 'INVALID_INPUT',
  ILLEGAL_STATUS: 'ILLEGAL_STATUS',
  NOT_IMPLEMENTED: 'NOT_IMPLEMENTED',
} as const;

export type DamageDeductionErrorCode =
  (typeof DamageDeductionError)[keyof typeof DamageDeductionError];

export interface DamageDeductionErrorResult {
  code: DamageDeductionErrorCode;
  message: string;
}

// ---------------------------------------------------------------------------
// Repository contract
// ---------------------------------------------------------------------------

export interface DamageDeductionRepository {
  findById(id: DamageDeductionCaseId, tenantId: TenantId): Promise<DamageDeductionCase | null>;
  create(entity: DamageDeductionCase): Promise<DamageDeductionCase>;
  update(entity: DamageDeductionCase): Promise<DamageDeductionCase>;
}

// ---------------------------------------------------------------------------
// Evidence bundle gateway (thin wrapper over document-intelligence)
// ---------------------------------------------------------------------------

export interface EvidenceBundleGateway {
  buildForDamageClaim(params: {
    tenantId: TenantId;
    damageCaseId: DamageDeductionCaseId;
    actor: UserId;
  }): Promise<{ bundleId: string }>;
}

// ---------------------------------------------------------------------------
// AI mediator gateway — pluggable surface so the service does not take a
// hard dep on @borjie/ai-copilot. Callers wire the real adapter at
// composition time; if absent the service dynamically imports the shared
// `draftDamageMediatorTurn` and finally falls back to a deterministic
// midpoint calculation.
// ---------------------------------------------------------------------------

export interface AiMediatorGateway {
  draft(input: {
    readonly claimedDeductionMinor: number;
    readonly tenantCounterMinor: number | null;
    readonly findings: ReadonlyArray<{ component: string; severity: string; note?: string }>;
    readonly priorTurns: ReadonlyArray<{ actor: string; text: string }>;
    readonly floorMinor: number;
    readonly ceilingMinor: number;
    readonly advisorGate?: boolean;
  }): Promise<{
    readonly proposedDeductionMinor: number;
    readonly rationale: string;
    readonly turnText: string;
    readonly escalate: boolean;
  }>;
}

export interface DamageDeductionServiceOptions {
  /** Threshold (minor units) above which the advisor gate fires. */
  readonly advisorGateThresholdMinor?: number;
  /** Hard floor passed to the mediator. Defaults to 0. */
  readonly floorMinor?: number;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class DamageDeductionService {
  private readonly options: Required<DamageDeductionServiceOptions>;

  constructor(
    private repo: DamageDeductionRepository,
    private readonly evidenceBundle?: EvidenceBundleGateway,
    private readonly aiMediator?: AiMediatorGateway,
    options: DamageDeductionServiceOptions = {}
  ) {
    this.options = {
      advisorGateThresholdMinor: options.advisorGateThresholdMinor ?? 500_000_00,
      floorMinor: options.floorMinor ?? 0,
    };
  }

  /**
   * Swap the backing repository at runtime (additive hook for Wave 3
   * wiring — stub-based tests use the constructor path, production wires
   * the Postgres repo via `attachRepository`).
   */
  attachRepository(repo: DamageDeductionRepository): void {
    this.repo = repo;
  }

  async fileClaim(
    tenantId: TenantId,
    input: FileClaimInput,
    actor: UserId
  ): Promise<Result<DamageDeductionCase, DamageDeductionErrorResult>> {
    if (!input.claimedDeductionMinor || input.claimedDeductionMinor <= 0) {
      return err({
        code: DamageDeductionError.INVALID_INPUT,
        message: 'claimedDeductionMinor must be positive',
      });
    }
    const now = new Date().toISOString() as ISOTimestamp;
    const entity: DamageDeductionCase = {
      id: asDamageDeductionCaseId(`ddc_${Date.now()}_${randomHex(4)}`),
      tenantId,
      ...(input.leaseId !== undefined ? { leaseId: input.leaseId } : {}),
      ...(input.caseId !== undefined ? { caseId: input.caseId } : {}),
      ...(input.moveOutInspectionId !== undefined
        ? { moveOutInspectionId: input.moveOutInspectionId }
        : {}),
      claimedDeductionMinor: input.claimedDeductionMinor,
      // Callers resolve currency from tenant region-config before
      // invoking. Empty string surfaces misconfigured input rather than
      // silently persisting as TZS.
      currency: input.currency ?? '',
      status: 'claim_filed',
      aiMediatorTurns: [
        {
          id: `turn_${Date.now()}_${randomHex(2)}`,
          actor: 'owner',
          actorId: actor,
          proposedAmountMinor: input.claimedDeductionMinor,
          rationale: input.rationale,
          createdAt: now,
        },
      ],
      createdAt: now,
      updatedAt: now,
      createdBy: actor,
      updatedBy: actor,
    };
    const saved = await this.repo.create(entity);
    return ok(saved);
  }

  async tenantRespond(
    id: DamageDeductionCaseId,
    tenantId: TenantId,
    input: TenantRespondInput,
    actor: UserId
  ): Promise<Result<DamageDeductionCase, DamageDeductionErrorResult>> {
    const entity = await this.repo.findById(id, tenantId);
    if (!entity) {
      return err({ code: DamageDeductionError.CLAIM_NOT_FOUND, message: 'Claim not found' });
    }
    if (entity.status !== 'claim_filed' && entity.status !== 'negotiating') {
      return err({
        code: DamageDeductionError.ILLEGAL_STATUS,
        message: `Cannot respond when status is ${entity.status}`,
      });
    }
    const now = new Date().toISOString() as ISOTimestamp;
    const turn: NegotiationTurn = {
      id: `turn_${Date.now()}_${randomHex(2)}`,
      actor: 'tenant',
      actorId: actor,
      ...(input.counterProposalMinor !== undefined
        ? { proposedAmountMinor: input.counterProposalMinor }
        : {}),
      rationale: input.rationale,
      createdAt: now,
    };
    const resolvedCounterProposalMinor =
      input.counterProposalMinor ?? entity.tenantCounterProposalMinor;
    const updated: DamageDeductionCase = {
      ...entity,
      ...(resolvedCounterProposalMinor !== undefined
        ? { tenantCounterProposalMinor: resolvedCounterProposalMinor }
        : {}),
      status: 'tenant_responded',
      aiMediatorTurns: [...entity.aiMediatorTurns, turn],
      updatedAt: now,
      updatedBy: actor,
    };
    const saved = await this.repo.update(updated);
    return ok(saved);
  }

  /**
   * AI mediation — produces a neutral midpoint proposal (with rationale)
   * and persists it as an `ai_mediator` negotiation turn.
   *
   * Resolution order for the mediator gateway:
   *  1. Injected `aiMediator` (preferred — tests can stub it).
   *  2. Dynamic import of `@borjie/ai-copilot` which itself degrades to
   *     a deterministic midpoint when `ANTHROPIC_API_KEY` is unset.
   *  3. In-service deterministic midpoint clamped to floor/ceiling.
   *
   * Advisor gate (threshold configurable) flips any proposal above the
   * threshold into an `escalated` status so an Opus advisor (or human)
   * must review before settlement.
   */
  async aiMediate(
    id: DamageDeductionCaseId,
    tenantId: TenantId,
    actor: UserId
  ): Promise<Result<DamageDeductionCase, DamageDeductionErrorResult>> {
    const entity = await this.repo.findById(id, tenantId);
    if (!entity) {
      return err({
        code: DamageDeductionError.CLAIM_NOT_FOUND,
        message: 'Claim not found',
      });
    }
    if (entity.status !== 'claim_filed' && entity.status !== 'tenant_responded' && entity.status !== 'negotiating') {
      return err({
        code: DamageDeductionError.ILLEGAL_STATUS,
        message: `Cannot mediate when status is ${entity.status}`,
      });
    }

    const ceilingMinor = entity.claimedDeductionMinor;
    const floorMinor = Math.min(
      this.options.floorMinor,
      entity.tenantCounterProposalMinor ?? this.options.floorMinor
    );
    const priorTurns = entity.aiMediatorTurns.map((t) => ({
      actor: t.actor,
      text: t.rationale,
    }));
    const mediatorInput = {
      claimedDeductionMinor: entity.claimedDeductionMinor,
      tenantCounterMinor: entity.tenantCounterProposalMinor ?? null,
      findings: [] as ReadonlyArray<{ component: string; severity: string; note?: string }>,
      priorTurns,
      floorMinor,
      ceilingMinor,
      advisorGate: entity.claimedDeductionMinor >= this.options.advisorGateThresholdMinor,
    };

    let proposal: {
      proposedDeductionMinor: number;
      rationale: string;
      turnText: string;
      escalate: boolean;
    };
    try {
      proposal = await this.resolveMediator(mediatorInput);
    } catch {
      // Ultimate fallback — deterministic midpoint clamped to [floor, ceiling].
      const counter = entity.tenantCounterProposalMinor ?? 0;
      const midpoint = Math.max(
        floorMinor,
        Math.min(ceilingMinor, Math.round((entity.claimedDeductionMinor + counter) / 2))
      );
      proposal = {
        proposedDeductionMinor: midpoint,
        rationale:
          'Deterministic fallback: midpoint of claim and tenant counter clamped to floor/ceiling.',
        turnText: `Proposed settlement: ${midpoint} (midpoint).`,
        escalate: entity.claimedDeductionMinor >= this.options.advisorGateThresholdMinor,
      };
    }

    const now = new Date().toISOString() as ISOTimestamp;
    const turn: NegotiationTurn = {
      id: `turn_${Date.now()}_${randomHex(2)}`,
      actor: 'ai_mediator',
      actorId: actor,
      proposedAmountMinor: proposal.proposedDeductionMinor,
      rationale: proposal.rationale,
      createdAt: now,
    };
    const updated: DamageDeductionCase = {
      ...entity,
      proposedDeductionMinor: proposal.proposedDeductionMinor,
      status: proposal.escalate ? 'escalated' : 'negotiating',
      aiMediatorTurns: [...entity.aiMediatorTurns, turn],
      updatedAt: now,
      updatedBy: actor,
    };
    const saved = await this.repo.update(updated);
    return ok(saved);
  }

  private async resolveMediator(input: {
    claimedDeductionMinor: number;
    tenantCounterMinor: number | null;
    findings: ReadonlyArray<{ component: string; severity: string; note?: string }>;
    priorTurns: ReadonlyArray<{ actor: string; text: string }>;
    floorMinor: number;
    ceilingMinor: number;
    advisorGate?: boolean;
  }): Promise<{
    proposedDeductionMinor: number;
    rationale: string;
    turnText: string;
    escalate: boolean;
  }> {
    if (this.aiMediator) {
      return this.aiMediator.draft(input);
    }
    // Dynamic import keeps domain-services free of a hard ai-copilot dep
    // at type-check time. If the package is unavailable at runtime, the
    // caller handles the thrown error and degrades to the in-service
    // midpoint.
    //
    // The module specifier is held in a runtime-computed string so tsc
    // does not try to resolve it (ai-copilot is not a declared dep of
    // this package — it's loaded at runtime only when present).
    const aiCopilotModuleId = '@borjie/' + 'ai-copilot';
    // Use a native dynamic import() with a bundler-ignore hint; this avoids
    // the Function/eval constructor entirely while still deferring resolution
    // to runtime.
    const mod = (await import(
      /* webpackIgnore: true */ /* @vite-ignore */ aiCopilotModuleId
    )) as {
      draftDamageMediatorTurn?: (i: typeof input) => Promise<{
        proposedDeductionMinor: number;
        rationale: string;
        turnText: string;
        escalate: boolean;
      }>;
    };
    if (!mod.draftDamageMediatorTurn) {
      throw new Error('ai-copilot: draftDamageMediatorTurn not exported');
    }
    return mod.draftDamageMediatorTurn(input);
  }

  /**
   * Evidence bundle — DELEGATES to document-intelligence builder.
   * Throws NOT_IMPLEMENTED if the gateway was not wired at construction.
   */
  async buildEvidenceBundle(
    id: DamageDeductionCaseId,
    tenantId: TenantId,
    actor: UserId
  ): Promise<Result<{ bundleId: string }, DamageDeductionErrorResult>> {
    if (!this.evidenceBundle) {
      return err({
        code: DamageDeductionError.NOT_IMPLEMENTED,
        message: 'EvidenceBundleGateway not configured',
      });
    }
    const result = await this.evidenceBundle.buildForDamageClaim({
      tenantId,
      damageCaseId: id,
      actor,
    });
    return ok(result);
  }

  /**
   * Agree + settle — STUBBED ledger write.
   *
   * Will post an adjustment ledger entry via #4 mechanism once the
   * deposit ledger is complete. For now the service records agreement
   * state only.
   */
  async agreeAndSettle(
    id: DamageDeductionCaseId,
    tenantId: TenantId,
    input: AgreeAndSettleInput,
    actor: UserId
  ): Promise<Result<DamageDeductionCase, DamageDeductionErrorResult>> {
    const entity = await this.repo.findById(id, tenantId);
    if (!entity) {
      return err({ code: DamageDeductionError.CLAIM_NOT_FOUND, message: 'Claim not found' });
    }
    const now = new Date().toISOString() as ISOTimestamp;
    const updated: DamageDeductionCase = {
      ...entity,
      proposedDeductionMinor: input.agreedAmountMinor,
      status: 'agreed',
      updatedAt: now,
      updatedBy: actor,
    };
    const saved = await this.repo.update(updated);
    // NOTE: ledger posting stub — tracked under MISSING_FEATURES_DESIGN.md §4 (Deposit Ledger).
    return ok(saved);
  }
}
