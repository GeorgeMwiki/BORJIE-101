/**
 * Negotiation domain service.
 *
 * Orchestrates the AI-sandboxed price negotiation flow:
 *
 *   startNegotiation()  – open session, record the opening offer.
 *   submitCounter()     – record prospect/owner offer; if AI is next,
 *                         run policy check → (eventually) call LLM →
 *                         re-check policy → append AI turn.
 *   acceptOffer()       – close with agreed price; emits event.
 *   rejectOffer()       – close with reason; emits event.
 *   getAudit()          – replay turns (append-only log).
 *
 * The LLM call itself is stubbed (see KI-008). Policy enforcement runs
 * both before (upper-bound) and after (re-check) the LLM so that a
 * prompt-injected counter below floor is still rejected.
 */

import pino from 'pino';
import { prefixedId } from '../common/id-generator.js';
import type { EventBus } from '../common/events.js';
import {
  createEventEnvelope,
  generateEventId,
} from '../common/events.js';
import type {
  TenantId,
  UserId,
  ISOTimestamp,
  Result,
} from '@borjie/domain-models';
import { ok, err } from '@borjie/domain-models';

const logger = pino({ name: 'negotiation-service' });

import {
  NegotiationServiceError,
  asNegotiationId,
  asNegotiationPolicyId,
  asNegotiationTurnId,
  type Negotiation,
  type NegotiationId,
  type NegotiationPolicy,
  type NegotiationPolicyId,
  type NegotiationPolicyRepository,
  type NegotiationRepository,
  type NegotiationTurn,
  type NegotiationTurnId,
  type NegotiationTurnRepository,
  type NegotiationActor,
  type NegotiationConcession,
  type StartNegotiationInput,
  type SubmitCounterInput,
  type CloseNegotiationInput,
} from './types.js';
import {
  checkPolicy,
  computeAiCounterLowerBound,
  isBlocking,
  type PolicyCheckOutcome,
} from './policy-enforcement.js';

// ============================================================================
// Events
// ============================================================================

export interface NegotiationOpenedEvent {
  readonly eventId: string;
  readonly eventType: 'NegotiationOpened';
  readonly timestamp: ISOTimestamp;
  readonly tenantId: TenantId;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly metadata: Record<string, unknown>;
  readonly payload: {
    readonly negotiationId: NegotiationId;
    readonly policyId: NegotiationPolicyId;
    readonly domain: string;
  };
}

export interface NegotiationCounterEvent {
  readonly eventId: string;
  readonly eventType: 'NegotiationCounter';
  readonly timestamp: ISOTimestamp;
  readonly tenantId: TenantId;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly metadata: Record<string, unknown>;
  readonly payload: {
    readonly negotiationId: NegotiationId;
    readonly actor: NegotiationActor;
    readonly offer: number;
  };
}

export interface NegotiationEscalatedEvent {
  readonly eventId: string;
  readonly eventType: 'NegotiationEscalated';
  readonly timestamp: ISOTimestamp;
  readonly tenantId: TenantId;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly metadata: Record<string, unknown>;
  readonly payload: {
    readonly negotiationId: NegotiationId;
    readonly violations: ReadonlyArray<string>;
    readonly reason: string;
  };
}

export interface NegotiationAcceptedEvent {
  readonly eventId: string;
  readonly eventType: 'NegotiationAccepted';
  readonly timestamp: ISOTimestamp;
  readonly tenantId: TenantId;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly metadata: Record<string, unknown>;
  readonly payload: {
    readonly negotiationId: NegotiationId;
    readonly agreedPrice: number;
  };
}

export interface NegotiationRejectedEvent {
  readonly eventId: string;
  readonly eventType: 'NegotiationRejected';
  readonly timestamp: ISOTimestamp;
  readonly tenantId: TenantId;
  readonly correlationId: string;
  readonly causationId: string | null;
  readonly metadata: Record<string, unknown>;
  readonly payload: {
    readonly negotiationId: NegotiationId;
    readonly reason: string;
  };
}

// ============================================================================
// AI Counter Generator (injectable; stubbed by default)
// ============================================================================

export interface AiCounterRequest {
  readonly policy: NegotiationPolicy;
  readonly negotiation: Negotiation;
  readonly history: ReadonlyArray<NegotiationTurn>;
  readonly lowerBound: number; // AI may not propose below this
}

export interface AiCounterResult {
  readonly offer: number;
  readonly concessions: ReadonlyArray<NegotiationConcession>;
  readonly rationale: string;
  readonly modelTier: string;
}

export type AiCounterGenerator = (
  req: AiCounterRequest
) => Promise<AiCounterResult>;

/**
 * Default stub — clamps midway between last offer and lowerBound.
 * Follow-up KI-008 (#33): wire to Anthropic client (see
 *   packages/ai-copilot/src/providers/). When wiring, do NOT remove
 *   the post-LLM policy re-check in this service — it is the
 *   compliance safety net. See Docs/KNOWN_ISSUES.md#ki-008.
 */
export const defaultStubAiCounterGenerator: AiCounterGenerator = async (
  req
) => {
  const lastProspectOffer =
    req.history
      .slice()
      .reverse()
      .find((t) => t.actor !== 'ai')?.offer ?? req.policy.listPrice;
  const targetBand = Math.max(
    req.lowerBound,
    Math.round((lastProspectOffer + req.policy.listPrice) / 2)
  );
  return {
    offer: targetBand,
    concessions: [],
    rationale:
      '[STUB] Deterministic midpoint counter pending Anthropic wiring',
    modelTier: 'stub',
  };
};

// ============================================================================
// Service
// ============================================================================

export interface NegotiationServiceDeps {
  readonly policyRepo: NegotiationPolicyRepository;
  readonly negotiationRepo: NegotiationRepository;
  readonly turnRepo: NegotiationTurnRepository;
  readonly eventBus: EventBus;
  readonly aiCounterGenerator?: AiCounterGenerator;
  readonly now?: () => ISOTimestamp;
}

function nowIso(): ISOTimestamp {
  return new Date().toISOString() as ISOTimestamp;
}

export class NegotiationService {
  private readonly policyRepo: NegotiationPolicyRepository;
  private readonly negotiationRepo: NegotiationRepository;
  private readonly turnRepo: NegotiationTurnRepository;
  private readonly eventBus: EventBus;
  private readonly ai: AiCounterGenerator;
  private readonly now: () => ISOTimestamp;

  constructor(deps: NegotiationServiceDeps) {
    this.policyRepo = deps.policyRepo;
    this.negotiationRepo = deps.negotiationRepo;
    this.turnRepo = deps.turnRepo;
    this.eventBus = deps.eventBus;
    this.ai = deps.aiCounterGenerator ?? defaultStubAiCounterGenerator;
    this.now = deps.now ?? nowIso;
  }

  // ------------------------------------------------------------------------
  // startNegotiation
  // ------------------------------------------------------------------------

  async startNegotiation(
    tenantId: TenantId,
    input: StartNegotiationInput,
    correlationId: string,
    actorUserId: UserId | null = null
  ): Promise<Result<Negotiation, NegotiationServiceError>> {
    const policy = await this.policyRepo.findById(input.policyId, tenantId);
    if (!policy) {
      return err(
        new NegotiationServiceError(
          `Policy not found: ${input.policyId}`,
          'POLICY_NOT_FOUND'
        )
      );
    }
    if (!policy.active) {
      return err(
        new NegotiationServiceError('Policy is not active', 'POLICY_INACTIVE')
      );
    }

    // Opening offer is recorded as a prospect/counterparty turn; policy
    // check runs deterministically (prospects may propose anything, so
    // the opening offer is never rejected here, only audited).
    const openingActor: NegotiationActor =
      input.domain === 'tender_bid' ? 'vendor' : 'prospect';

    const openingCheck = checkPolicy({
      policy,
      actor: openingActor,
      offer: input.openingOffer,
      concessions: input.openingConcessions ?? [],
    });

    const negotiationId = asNegotiationId(prefixedId('neg'));
    const timestamp = this.now();

    const negotiation: Negotiation = {
      id: negotiationId,
      tenantId,
      unitId: input.unitId ?? null,
      propertyId: input.propertyId ?? null,
      prospectCustomerId: input.prospectCustomerId ?? null,
      counterpartyId: input.counterpartyId ?? null,
      listingId: input.listingId ?? null,
      tenderId: input.tenderId ?? null,
      bidId: input.bidId ?? null,
      policyId: policy.id,
      domain: input.domain,
      status: 'open',
      aiPersona:
        input.aiPersona ??
        (input.domain === 'tender_bid'
          ? 'TENDER_NEGOTIATOR'
          : 'PRICE_NEGOTIATOR'),
      currentOffer: input.openingOffer,
      currentOfferBy: openingActor,
      roundCount: 1,
      agreedPrice: null,
      closedAt: null,
      closureReason: null,
      escalatedAt: null,
      escalatedTo: null,
      createdAt: timestamp,
      lastActivityAt: timestamp,
      expiresAt: input.expiresAt ?? null,
    };

    const created = await this.negotiationRepo.create(negotiation);

    const openingTurn: NegotiationTurn = {
      id: asNegotiationTurnId(prefixedId('negtrn')),
      tenantId,
      negotiationId: created.id,
      sequence: 1,
      actor: openingActor,
      actorUserId,
      offer: input.openingOffer,
      concessionsProposed: input.openingConcessions ?? [],
      rationale: input.openingRationale ?? null,
      aiModelTier: null,
      policySnapshotId: policy.id,
      policyCheckPassed: !isBlocking(openingCheck),
      policyCheckViolations:
        openingCheck.kind === 'deny' || openingCheck.kind === 'escalate'
          ? openingCheck.violations
          : [],
      advisorConsulted: false,
      advisorDecision: null,
      rawPayload: { source: 'startNegotiation' },
      createdAt: timestamp,
    };

    await this.turnRepo.append(openingTurn);

    await this.eventBus.publish(
      createEventEnvelope<NegotiationOpenedEvent>(
        {
          eventId: generateEventId(),
          eventType: 'NegotiationOpened',
          timestamp,
          tenantId,
          correlationId,
          causationId: null,
          metadata: {},
          payload: {
            negotiationId: created.id,
            policyId: policy.id,
            domain: input.domain,
          },
        },
        created.id,
        'Negotiation'
      )
    );

    return ok(created);
  }

  // ------------------------------------------------------------------------
  // submitCounter
  //
  // Records a counter from `actor` (prospect / owner / agent / vendor).
  // If the counter does not close the deal and the negotiation is still
  // open, generate an AI counter via the policy-sandboxed flow.
  // ------------------------------------------------------------------------

  async submitCounter(
    tenantId: TenantId,
    input: SubmitCounterInput,
    correlationId: string
  ): Promise<
    Result<
      {
        readonly negotiation: Negotiation;
        readonly counterpartyTurn: NegotiationTurn;
        readonly aiTurn: NegotiationTurn | null;
      },
      NegotiationServiceError
    >
  > {
    const negotiation = await this.negotiationRepo.findById(
      input.negotiationId,
      tenantId
    );
    if (!negotiation) {
      return err(
        new NegotiationServiceError('Negotiation not found', 'NOT_FOUND')
      );
    }
    if (negotiation.status === 'accepted' || negotiation.status === 'rejected') {
      return err(
        new NegotiationServiceError(
          `Cannot submit into a ${negotiation.status} negotiation`,
          'ALREADY_CLOSED'
        )
      );
    }

    const policy = await this.policyRepo.findById(
      negotiation.policyId,
      tenantId
    );
    if (!policy) {
      return err(
        new NegotiationServiceError(
          'Policy missing for negotiation',
          'POLICY_NOT_FOUND'
        )
      );
    }

    // Record the counterparty turn (no floor check applies to non-AI).
    const counterCheck = checkPolicy({
      policy,
      actor: input.actor,
      offer: input.offer,
      concessions: input.concessions ?? [],
    });

    const nextSeq = await this.turnRepo.nextSequence(
      negotiation.id,
      tenantId
    );
    const timestamp = this.now();

    const counterpartyTurn: NegotiationTurn = {
      id: asNegotiationTurnId(prefixedId('negtrn')),
      tenantId,
      negotiationId: negotiation.id,
      sequence: nextSeq,
      actor: input.actor,
      actorUserId: input.actorUserId ?? null,
      offer: input.offer,
      concessionsProposed: input.concessions ?? [],
      rationale: input.rationale ?? null,
      aiModelTier: null,
      policySnapshotId: policy.id,
      policyCheckPassed: !isBlocking(counterCheck),
      policyCheckViolations:
        counterCheck.kind === 'deny' || counterCheck.kind === 'escalate'
          ? counterCheck.violations
          : [],
      advisorConsulted:
        counterCheck.kind === 'allow_with_advisor' ||
        counterCheck.kind === 'escalate',
      advisorDecision: null,
      rawPayload: input.rawPayload ?? null,
      createdAt: timestamp,
    };

    await this.turnRepo.append(counterpartyTurn);

    await this.eventBus.publish(
      createEventEnvelope<NegotiationCounterEvent>(
        {
          eventId: generateEventId(),
          eventType: 'NegotiationCounter',
          timestamp,
          tenantId,
          correlationId,
          causationId: null,
          metadata: {},
          payload: {
            negotiationId: negotiation.id,
            actor: input.actor,
            offer: input.offer,
          },
        },
        negotiation.id,
        'Negotiation'
      )
    );

    // If the human counterparty's offer breaches the approval gate AND the
    // actor is AI (impossible here since actor is counterparty) we'd
    // escalate. For owner/agent overrides we just flag. For prospect
    // offers below floor we still happily respond.

    // Update negotiation snapshot.
    let updated = await this.negotiationRepo.updateStatus(
      negotiation.id,
      tenantId,
      {
        currentOffer: input.offer,
        currentOfferBy: input.actor,
        roundCount: negotiation.roundCount + 1,
        lastActivityAt: timestamp,
        status:
          counterCheck.kind === 'escalate'
            ? 'escalated'
            : negotiation.status === 'open'
              ? 'counter_sent'
              : negotiation.status,
      }
    );

    if (counterCheck.kind === 'escalate') {
      await this.eventBus.publish(
        createEventEnvelope<NegotiationEscalatedEvent>(
          {
            eventId: generateEventId(),
            eventType: 'NegotiationEscalated',
            timestamp,
            tenantId,
            correlationId,
            causationId: null,
            metadata: {},
            payload: {
              negotiationId: negotiation.id,
              violations: counterCheck.violations,
              reason: counterCheck.reason,
            },
          },
          negotiation.id,
          'Negotiation'
        )
      );
      return ok({
        negotiation: updated,
        counterpartyTurn,
        aiTurn: null,
      });
    }

    // If counterparty met or exceeded list price, we don't bother the AI.
    if (input.offer >= policy.listPrice) {
      return ok({
        negotiation: updated,
        counterpartyTurn,
        aiTurn: null,
      });
    }

    // ------------------------------------------------------------------
    // Generate AI counter — policy-sandboxed.
    // ------------------------------------------------------------------

    const lowerBound = computeAiCounterLowerBound(policy);

    // Pre-flight: if the lowerBound is already >= the counterparty offer,
    // escalate instead of countering below floor.
    if (lowerBound >= input.offer) {
      // Mark escalated — AI cannot counter below what counterparty offered
      // without crossing policy thresholds.
      updated = await this.negotiationRepo.updateStatus(
        negotiation.id,
        tenantId,
        {
          status: 'escalated',
          escalatedAt: timestamp,
          escalatedTo: 'owner',
        }
      );
      await this.eventBus.publish(
        createEventEnvelope<NegotiationEscalatedEvent>(
          {
            eventId: generateEventId(),
            eventType: 'NegotiationEscalated',
            timestamp,
            tenantId,
            correlationId,
            causationId: null,
            metadata: {},
            payload: {
              negotiationId: negotiation.id,
              violations: ['NO_VIABLE_AI_COUNTER'],
              reason: `lowerBound ${lowerBound} >= counterparty offer ${input.offer}`,
            },
          },
          negotiation.id,
          'Negotiation'
        )
      );
      return ok({
        negotiation: updated,
        counterpartyTurn,
        aiTurn: null,
      });
    }

    const history = await this.turnRepo.listByNegotiation(
      negotiation.id,
      tenantId
    );

    // Call LLM (stubbed). If this throws, we escalate rather than breaching.
    let aiResult: AiCounterResult;
    try {
      aiResult = await this.ai({
        policy,
        negotiation: updated,
        history,
        lowerBound,
      });
    } catch (error) {
      logger.error({ err: error }, 'AI counter generator failed');
      updated = await this.negotiationRepo.updateStatus(
        negotiation.id,
        tenantId,
        {
          status: 'escalated',
          escalatedAt: timestamp,
          escalatedTo: 'owner',
        }
      );
      return ok({ negotiation: updated, counterpartyTurn, aiTurn: null });
    }

    // RE-CHECK policy on the AI's proposed counter. This is the critical
    // second gate: even if the LLM was prompt-injected into suggesting a
    // below-floor offer, we reject here.
    const aiCheck = checkPolicy({
      policy,
      actor: 'ai',
      offer: aiResult.offer,
      concessions: aiResult.concessions,
    });

    const aiSeq = await this.turnRepo.nextSequence(negotiation.id, tenantId);
    const aiTimestamp = this.now();

    if (aiCheck.kind === 'deny' || aiCheck.kind === 'escalate') {
      // Append a rejected AI-candidate turn for audit; set negotiation to escalated.
      const rejectedAiTurn: NegotiationTurn = {
        id: asNegotiationTurnId(prefixedId('negtrn')),
        tenantId,
        negotiationId: negotiation.id,
        sequence: aiSeq,
        actor: 'ai',
        actorUserId: null,
        offer: aiResult.offer,
        concessionsProposed: aiResult.concessions,
        rationale: `[POLICY_BLOCKED] ${aiResult.rationale}`,
        aiModelTier: aiResult.modelTier,
        policySnapshotId: policy.id,
        policyCheckPassed: false,
        policyCheckViolations:
          aiCheck.kind === 'deny' || aiCheck.kind === 'escalate'
            ? aiCheck.violations
            : [],
        advisorConsulted: true,
        advisorDecision: 'escalated',
        rawPayload: { source: 'ai_counter_blocked' },
        createdAt: aiTimestamp,
      };
      await this.turnRepo.append(rejectedAiTurn);

      updated = await this.negotiationRepo.updateStatus(
        negotiation.id,
        tenantId,
        {
          status: 'escalated',
          escalatedAt: aiTimestamp,
          escalatedTo: 'owner',
          lastActivityAt: aiTimestamp,
        }
      );

      await this.eventBus.publish(
        createEventEnvelope<NegotiationEscalatedEvent>(
          {
            eventId: generateEventId(),
            eventType: 'NegotiationEscalated',
            timestamp: aiTimestamp,
            tenantId,
            correlationId,
            causationId: null,
            metadata: {},
            payload: {
              negotiationId: negotiation.id,
              violations:
                aiCheck.kind === 'deny' || aiCheck.kind === 'escalate'
                  ? aiCheck.violations
                  : [],
              reason:
                aiCheck.kind === 'escalate'
                  ? aiCheck.reason
                  : 'AI counter breached policy',
            },
          },
          negotiation.id,
          'Negotiation'
        )
      );

      return ok({
        negotiation: updated,
        counterpartyTurn,
        aiTurn: rejectedAiTurn,
      });
    }

    // Happy path — AI counter accepted.
    const aiTurn: NegotiationTurn = {
      id: asNegotiationTurnId(prefixedId('negtrn')),
      tenantId,
      negotiationId: negotiation.id,
      sequence: aiSeq,
      actor: 'ai',
      actorUserId: null,
      offer: aiResult.offer,
      concessionsProposed: aiResult.concessions,
      rationale: aiResult.rationale,
      aiModelTier: aiResult.modelTier,
      policySnapshotId: policy.id,
      policyCheckPassed: true,
      policyCheckViolations: [],
      advisorConsulted: aiCheck.kind === 'allow_with_advisor',
      advisorDecision:
        aiCheck.kind === 'allow_with_advisor' ? 'approved' : null,
      rawPayload: { source: 'ai_counter' },
      createdAt: aiTimestamp,
    };
    await this.turnRepo.append(aiTurn);

    updated = await this.negotiationRepo.updateStatus(
      negotiation.id,
      tenantId,
      {
        currentOffer: aiResult.offer,
        currentOfferBy: 'ai',
        roundCount: updated.roundCount + 1,
        lastActivityAt: aiTimestamp,
        status: 'counter_sent',
      }
    );

    await this.eventBus.publish(
      createEventEnvelope<NegotiationCounterEvent>(
        {
          eventId: generateEventId(),
          eventType: 'NegotiationCounter',
          timestamp: aiTimestamp,
          tenantId,
          correlationId,
          causationId: null,
          metadata: {},
          payload: {
            negotiationId: negotiation.id,
            actor: 'ai',
            offer: aiResult.offer,
          },
        },
        negotiation.id,
        'Negotiation'
      )
    );

    return ok({ negotiation: updated, counterpartyTurn, aiTurn });
  }

  // ------------------------------------------------------------------------
  // acceptOffer
  // ------------------------------------------------------------------------

  async acceptOffer(
    tenantId: TenantId,
    input: CloseNegotiationInput,
    correlationId: string
  ): Promise<Result<Negotiation, NegotiationServiceError>> {
    const negotiation = await this.negotiationRepo.findById(
      input.negotiationId,
      tenantId
    );
    if (!negotiation) {
      return err(new NegotiationServiceError('Not found', 'NOT_FOUND'));
    }
    if (negotiation.status === 'accepted' || negotiation.status === 'rejected') {
      return err(
        new NegotiationServiceError('Already closed', 'ALREADY_CLOSED')
      );
    }

    const agreed =
      input.agreedPrice ?? negotiation.currentOffer ?? 0;

    const timestamp = this.now();
    const updated = await this.negotiationRepo.updateStatus(
      negotiation.id,
      tenantId,
      {
        status: 'accepted',
        agreedPrice: agreed,
        closedAt: timestamp,
        closureReason: input.reason ?? 'accepted',
        lastActivityAt: timestamp,
      }
    );

    const seq = await this.turnRepo.nextSequence(negotiation.id, tenantId);
    await this.turnRepo.append({
      id: asNegotiationTurnId(prefixedId('negtrn')),
      tenantId,
      negotiationId: negotiation.id,
      sequence: seq,
      actor: input.actor,
      actorUserId: input.actorUserId ?? null,
      offer: agreed,
      concessionsProposed: [],
      rationale: input.reason ?? 'accepted',
      aiModelTier: null,
      policySnapshotId: negotiation.policyId,
      policyCheckPassed: true,
      policyCheckViolations: [],
      advisorConsulted: false,
      advisorDecision: null,
      rawPayload: { source: 'accept' },
      createdAt: timestamp,
    });

    await this.eventBus.publish(
      createEventEnvelope<NegotiationAcceptedEvent>(
        {
          eventId: generateEventId(),
          eventType: 'NegotiationAccepted',
          timestamp,
          tenantId,
          correlationId,
          causationId: null,
          metadata: {},
          payload: {
            negotiationId: negotiation.id,
            agreedPrice: agreed,
          },
        },
        negotiation.id,
        'Negotiation'
      )
    );

    return ok(updated);
  }

  // ------------------------------------------------------------------------
  // rejectOffer
  // ------------------------------------------------------------------------

  async rejectOffer(
    tenantId: TenantId,
    input: CloseNegotiationInput,
    correlationId: string
  ): Promise<Result<Negotiation, NegotiationServiceError>> {
    const negotiation = await this.negotiationRepo.findById(
      input.negotiationId,
      tenantId
    );
    if (!negotiation) {
      return err(new NegotiationServiceError('Not found', 'NOT_FOUND'));
    }
    if (negotiation.status === 'accepted' || negotiation.status === 'rejected') {
      return err(
        new NegotiationServiceError('Already closed', 'ALREADY_CLOSED')
      );
    }

    const timestamp = this.now();
    const updated = await this.negotiationRepo.updateStatus(
      negotiation.id,
      tenantId,
      {
        status: 'rejected',
        closedAt: timestamp,
        closureReason: input.reason ?? 'rejected',
        lastActivityAt: timestamp,
      }
    );

    const seq = await this.turnRepo.nextSequence(negotiation.id, tenantId);
    await this.turnRepo.append({
      id: asNegotiationTurnId(prefixedId('negtrn')),
      tenantId,
      negotiationId: negotiation.id,
      sequence: seq,
      actor: input.actor,
      actorUserId: input.actorUserId ?? null,
      offer: null,
      concessionsProposed: [],
      rationale: input.reason ?? 'rejected',
      aiModelTier: null,
      policySnapshotId: negotiation.policyId,
      policyCheckPassed: true,
      policyCheckViolations: [],
      advisorConsulted: false,
      advisorDecision: null,
      rawPayload: { source: 'reject' },
      createdAt: timestamp,
    });

    await this.eventBus.publish(
      createEventEnvelope<NegotiationRejectedEvent>(
        {
          eventId: generateEventId(),
          eventType: 'NegotiationRejected',
          timestamp,
          tenantId,
          correlationId,
          causationId: null,
          metadata: {},
          payload: {
            negotiationId: negotiation.id,
            reason: input.reason ?? 'rejected',
          },
        },
        negotiation.id,
        'Negotiation'
      )
    );

    return ok(updated);
  }

  // ------------------------------------------------------------------------
  // getAudit
  // ------------------------------------------------------------------------

  async getAudit(
    tenantId: TenantId,
    negotiationId: NegotiationId
  ): Promise<
    Result<
      {
        readonly negotiation: Negotiation;
        readonly turns: ReadonlyArray<NegotiationTurn>;
      },
      NegotiationServiceError
    >
  > {
    const negotiation = await this.negotiationRepo.findById(
      negotiationId,
      tenantId
    );
    if (!negotiation) {
      return err(new NegotiationServiceError('Not found', 'NOT_FOUND'));
    }
    const turns = await this.turnRepo.listByNegotiation(
      negotiationId,
      tenantId
    );
    return ok({ negotiation, turns });
  }
}
