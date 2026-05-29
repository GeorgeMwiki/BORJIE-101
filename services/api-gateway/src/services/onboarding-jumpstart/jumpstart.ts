/**
 * Day-1 jumpstart orchestrator — Wave COMPANY-BRAIN (Y-D).
 *
 * Fires exactly once per tenant. Decides whether the current
 * `IngestIntent` should also trigger the celebratory welcome card AND
 * the `mining.celebrate` cockpit-bus pulse, then atomically marks the
 * onboarding-state row so subsequent uploads only run the inferrer.
 *
 * Lifecycle:
 *   1. Mark first_ingest_at (idempotent).
 *   2. Check status — if 'demoed' or 'dismissed', skip jumpstart.
 *   3. Build the welcome card from the inferrer intent.
 *   4. Publish `mining.celebrate` to the per-tenant cockpit bus.
 *   5. Transition status → 'demoed' (idempotent).
 *   6. Return JumpstartResult so the caller can inline the card.
 */

import type {
  JumpstartCard,
  JumpstartInput,
  JumpstartResult,
} from './types.js';
import type { OnboardingPersistence } from './persistence.js';
import { buildJumpstartCard } from './card-builder.js';
import {
  publishCockpitEvent,
  type MiningCelebrateEvent,
} from '../cockpit-events/index.js';

export interface JumpstartDeps {
  readonly persistence: OnboardingPersistence;
  readonly now?: () => Date;
  readonly publish?: (event: MiningCelebrateEvent) => number;
  readonly logger?:
    | {
        info(obj: Record<string, unknown>, msg?: string): void;
        warn(obj: Record<string, unknown>, msg?: string): void;
      }
    | undefined;
}

export async function maybeFireJumpstart(
  deps: JumpstartDeps,
  input: JumpstartInput,
): Promise<JumpstartResult> {
  const now = deps.now?.() ?? new Date();
  const nowIso = now.toISOString();
  const publish = deps.publish ?? publishCockpitEvent;
  const log = deps.logger;

  // Always record the first-ingest timestamp, idempotent.
  const ingestState = await deps.persistence.markFirstIngest({
    tenantId: input.tenantId,
    nowIso,
  });

  // Already demoed or explicitly dismissed — skip jumpstart but still
  // surface the post-mark state so the caller knows.
  if (ingestState.status === 'demoed' || ingestState.status === 'dismissed') {
    return Object.freeze({
      fired: false,
      skippedReason: ingestState.status === 'demoed' ? 'already_demoed' : 'dismissed_by_owner',
      card: null,
      state: ingestState,
    });
  }

  // Build the welcome card.
  const card: JumpstartCard = buildJumpstartCard({
    filename: input.filename,
    summaryEn: input.summaryEn,
    summarySw: input.summarySw,
    intent: input.intent,
  });

  // Mark demoed BEFORE publishing so concurrent triggers see the new
  // status and skip (we still rely on the row's CASE-guarded upsert
  // for the actual at-most-once guarantee).
  const demoedState = await deps.persistence.markJumpstarted({
    tenantId: input.tenantId,
    nowIso,
    intent: input.intent,
  });

  // If a parallel jumpstart sneaked through and marked first, bail.
  // The card we built is still valid but we do NOT publish a second
  // celebrate event for the same tenant.
  if (
    demoedState.jumpstartedAt &&
    new Date(demoedState.jumpstartedAt).getTime() < now.getTime() - 1000
  ) {
    return Object.freeze({
      fired: false,
      skippedReason: 'raced_with_concurrent_jumpstart',
      card,
      state: demoedState,
    });
  }

  // Publish the celebrate pulse.
  const proposalCount =
    input.intent.proposedTabs.length +
    input.intent.proposedReminders.length +
    input.intent.proposedOpportunities.length +
    input.intent.proposedRisks.length;
  const event: MiningCelebrateEvent = Object.freeze({
    kind: 'mining.celebrate',
    tenantId: input.tenantId,
    emittedAt: nowIso,
    userId: input.userId,
    uploadId: input.uploadId,
    filename: input.filename,
    headerEn: card.headerEn,
    headerSw: card.headerSw,
    proposalCount,
  });
  try {
    publish(event);
  } catch (err) {
    log?.warn(
      {
        tenantId: input.tenantId,
        uploadId: input.uploadId,
        error: err instanceof Error ? err.message : String(err),
      },
      'onboarding-jumpstart: publish failed (non-fatal)',
    );
  }

  log?.info(
    {
      tenantId: input.tenantId,
      userId: input.userId,
      uploadId: input.uploadId,
      proposalCount,
    },
    'onboarding-jumpstart: Day-1 welcome fired',
  );

  return Object.freeze({
    fired: true,
    skippedReason: null,
    card,
    state: demoedState,
  });
}
