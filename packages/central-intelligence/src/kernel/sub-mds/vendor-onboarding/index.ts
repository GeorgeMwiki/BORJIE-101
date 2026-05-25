/**
 * vendor.onboarding — public API for the Tier-C sub-MD.
 *
 * KYC (via jurisdictional MCP server) → classify capabilities → draft
 * MSA (owner signs) → set up payment rail. Payment rail is reversible
 * within recall window; MSA is draft-only and never signed by the
 * sub-MD.
 */

import { createOutcomeRecorder, type OutcomeRecorder } from '../shared/outcome-recorder.js';
import type {
  ActualOutcome,
  AutomationArtifact,
  ObservedEvent,
  PredictedOutcome,
  ProcessGraph,
  RedesignProposal,
  ScopeFilter,
  SubMd,
  SubMdContext,
} from '../shared/sub-md-base.js';
import { automateVendor } from './automate.js';
import { mapVendor } from './map.js';
import { observeVendor } from './observe.js';
import { VENDOR_ONBOARDING_PERSONA } from './persona.js';
import { redesignVendor } from './redesign.js';

export const VENDOR_ONBOARDING_NAME = 'vendor.onboarding';

export const VENDOR_ONBOARDING_TOOLS = Object.freeze([
  'vendor.verify_kyc',
  'vendor.classify_capabilities',
  'vendor.draft_msa',
  'vendor.setup_payment_rail',
] as const);

export interface VendorOnboardingSubMdArgs {
  readonly scope: ScopeFilter;
  readonly recorder?: OutcomeRecorder;
}

export function createVendorOnboardingSubMd(
  args: VendorOnboardingSubMdArgs,
): SubMd {
  const recorder = args.recorder ?? createOutcomeRecorder();
  return Object.freeze({
    name: VENDOR_ONBOARDING_NAME,
    persona: VENDOR_ONBOARDING_PERSONA,
    scope: args.scope,
    toolBelt: VENDOR_ONBOARDING_TOOLS,
    riskTier: 'mutate',

    observe(ctx: SubMdContext): AsyncIterable<ObservedEvent> {
      return {
        [Symbol.asyncIterator]: async function* () {
          const collected = await observeVendor(ctx);
          for (const evt of collected) yield evt;
        },
      };
    },
    async map(events: ReadonlyArray<ObservedEvent>, _ctx: SubMdContext): Promise<ProcessGraph> {
      return mapVendor(events);
    },
    async redesign(graph: ProcessGraph, ctx: SubMdContext): Promise<RedesignProposal> {
      return redesignVendor(graph, ctx);
    },
    async automate(proposal: RedesignProposal, ctx: SubMdContext): Promise<AutomationArtifact> {
      return automateVendor(proposal, ctx.budget);
    },
    async recordOutcome(actual: ActualOutcome, predicted: PredictedOutcome): Promise<void> {
      await recorder.record({ subMdName: VENDOR_ONBOARDING_NAME, predicted, actual });
    },
  });
}

export { verifyKyc } from './tools/verify-kyc.js';
export type {
  KycJurisdiction,
  KycLookupPort,
  KycLookupResult,
  VerifyKycArgs,
  VerifyKycResult,
} from './tools/verify-kyc.js';
export { classifyCapabilities } from './tools/classify-capabilities.js';
export type { CapabilityTag, ClassifiedCapabilities } from './tools/classify-capabilities.js';
export { draftMsa } from './tools/draft-msa.js';
export type { DraftMsaArgs, DraftedMsa } from './tools/draft-msa.js';
export { setupPaymentRail } from './tools/setup-payment-rail.js';
export type {
  PaymentMethodRecord,
  PaymentRail,
  PaymentRegistryPort,
  SetupPaymentRailArgs,
  SetupPaymentRailResult,
} from './tools/setup-payment-rail.js';
export { VENDOR_ONBOARDING_PERSONA } from './persona.js';
