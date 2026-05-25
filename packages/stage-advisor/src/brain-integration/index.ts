/**
 * Brain integration — middleware to wrap any advisor-style port so it
 * receives stage context with every call.
 *
 * Two affordances:
 *   1. `wrapAdvisorWithStageContext(advisor, stageDetector)` — produces
 *      a new advisor port whose `advise` call attaches the stage
 *      context to a separate field. The original advisor is untouched.
 *   2. `seedConversationOpener({ stage, role })` — returns the opening
 *      line the brain (or a fallback UI) should use when a chat
 *      session first opens, tailored to stage + role.
 *
 * Pure — no I/O.
 */

import { STAGE_CARDS } from '../stages/definitions.js';
import type { OrgStage, StageContext, StageRole } from '../types.js';

// ─── Conversation opener ──────────────────────────────────────────

const ROLE_FRIENDLY: Readonly<Record<StageRole, string>> = {
  admin: 'Hey — what part of platform ops can I help with?',
  'property-manager':
    'Hey — what part of the portfolio do you want to look at today?',
  'estate-manager':
    'Hey — which maintenance, inspection, or vendor question is on your plate?',
  owner: 'Hey — what about your portfolio do you want to dig into?',
  tenant: 'Hi — anything I can help you with on your unit?',
  prospect: 'Hi — what brings you in today?',
  'service-provider':
    'Hey — which assigned job needs attention?',
};

export interface SeedConversationOpenerInput {
  readonly stage: OrgStage;
  readonly role: StageRole;
}

export function seedConversationOpener(
  input: SeedConversationOpenerInput,
): string {
  const card = STAGE_CARDS[input.stage];
  const stagePrefix = `Looks like you're at the ${card.displayName} stage`;
  const focusHint =
    card.focusAreas.length > 0
      ? ` — your focus areas right now are ${card.focusAreas.join(', ')}.`
      : '.';
  return `${stagePrefix}${focusHint} ${ROLE_FRIENDLY[input.role]}`;
}

// ─── Stage-context wrapper ────────────────────────────────────────

/**
 * Minimal structural shape an advisor needs to satisfy. The wrapper
 * doesn't care which advisor — it just needs to call `advise` with a
 * request that carries `tenantId` (for the stage lookup) and pass the
 * stage context through on the way out.
 *
 * Generic over the request + response shapes so the wrapper is
 * structurally compatible with both `role-aware-advisor` and any
 * other future advisor that follows the same call shape.
 */
export interface AdvisorLike<
  TReq extends { readonly user: { readonly tenantId: string } },
  TRes,
> {
  advise(req: TReq): Promise<TRes>;
}

export interface StageDetectorPort {
  detect(tenantId: string): Promise<StageContext | null>;
}

export interface StageEnrichedResponse<TRes> {
  readonly base: TRes;
  readonly stageContext: StageContext | null;
}

export interface WrapAdvisorInput<
  TReq extends { readonly user: { readonly tenantId: string } },
  TRes,
> {
  readonly advisor: AdvisorLike<TReq, TRes>;
  readonly stageDetector: StageDetectorPort;
}

/**
 * Wrap an advisor so every response carries the current stage context.
 * The wrapped call shape is `(req) → { base, stageContext }`. The
 * original advisor is invoked unchanged — this is purely additive.
 */
export function wrapAdvisorWithStageContext<
  TReq extends { readonly user: { readonly tenantId: string } },
  TRes,
>(
  input: WrapAdvisorInput<TReq, TRes>,
): AdvisorLike<TReq, StageEnrichedResponse<TRes>> {
  return {
    async advise(req: TReq): Promise<StageEnrichedResponse<TRes>> {
      // Resolve stage context (best-effort — never fails the advisor call).
      let stageContext: StageContext | null = null;
      try {
        stageContext = await input.stageDetector.detect(req.user.tenantId);
      } catch {
        stageContext = null;
      }
      const base = await input.advisor.advise(req);
      return { base, stageContext };
    },
  };
}
