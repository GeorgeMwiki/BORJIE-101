/**
 * Brain Adapter — non-invasive wiring between the Brain Orchestrator
 * turn result and the Intelligence Orchestrator.
 *
 * Callers of `orchestrator.handleTurn(...)` can pass the result through
 * `enrichTurnWithIntelligence` to:
 *   1. materialise proactive-alert context for the scope mentioned in the
 *      turn (if any)
 *   2. capture operator feedback when a PROPOSED_ACTION completes
 *
 * This lives under intelligence-orchestrator so Agent A's personas and
 * Agent D's security/memory subtrees stay untouched.
 *
 * @module intelligence-orchestrator/brain-adapter
 */

import { IntelligenceOrchestrator } from './orchestrator-service.js';
import { DecisionFeedbackService, type OperatorVerdict } from './decision-feedback-service.js';
import { routeAdminQuery } from './intelligent-routing.js';
import type { UnifiedEstateContext, ProactiveAlert } from './types.js';

export interface BrainTurnLike {
  readonly threadId: string;
  readonly finalPersonaId: string;
  readonly responseText: string;
  readonly proposedAction?: {
    readonly verb: string;
    readonly object: string;
    readonly riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
    readonly reviewRequired: boolean;
    readonly executionHeld?: boolean;
  };
}

export interface EnrichInput {
  readonly turn: BrainTurnLike;
  readonly tenantId: string;
  readonly userText: string;
  readonly scopeKind?: 'property' | 'unit' | 'tenant' | 'portfolio';
  readonly scopeId?: string;
}

export interface EnrichedTurn {
  readonly turn: BrainTurnLike;
  readonly routing: ReturnType<typeof routeAdminQuery>;
  readonly intelligence: UnifiedEstateContext | null;
  readonly alerts: readonly ProactiveAlert[];
}

/**
 * Enrich a Brain turn with intelligence-orchestrator context.
 *
 * - Routes the user text to the right sub-persona (LLM-free)
 * - If a scope is known, pulls the unified estate context
 * - Returns the top proactive alerts the UI should surface alongside the
 *   persona response
 */
export async function enrichTurnWithIntelligence(
  intel: IntelligenceOrchestrator,
  input: EnrichInput,
): Promise<EnrichedTurn> {
  if (!input.tenantId) {
    throw new Error('brain-adapter: tenantId required');
  }
  const routing = routeAdminQuery(input.userText);
  let intelligence: UnifiedEstateContext | null = null;
  if (input.scopeKind && input.scopeId) {
    try {
      intelligence = await intel.generateContext({
        scopeKind: input.scopeKind,
        scopeId: input.scopeId,
        tenantId: input.tenantId,
      });
    } catch {
      intelligence = null;
    }
  }
  const alerts = intelligence?.proactiveAlerts ?? [];
  return { turn: input.turn, routing, intelligence, alerts };
}

export interface CaptureFeedbackInput {
  readonly tenantId: string;
  readonly turnId: string;
  readonly personaId: string;
  readonly proposedAction: {
    readonly verb: string;
    readonly object: string;
    readonly riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  };
  readonly operatorVerdict: OperatorVerdict;
  readonly reason?: string;
}

/** Capture operator verdict on a PROPOSED_ACTION emitted by the Brain. */
export async function captureProposedActionFeedback(
  feedback: DecisionFeedbackService,
  input: CaptureFeedbackInput,
): Promise<void> {
  await feedback.processDecisionFeedback(input);
}
