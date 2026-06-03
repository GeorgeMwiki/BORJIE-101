/**
 * `reviseBelief` — the single guarded entry point for belief writes.
 *
 * This is the ONLY function callers use to mutate the belief store. It
 * enforces the CLAUDE.md hard rule "beliefs are never written directly":
 *   - If a prior belief exists for the (subject, scope), it runs the
 *     convince-loop, which gates the write behind the 0.25 delta.
 *   - If no prior belief exists, it CREATES one from the claim (investigate
 *     path) at the claim's initial confidence, with the claim as its sole
 *     source. A creation is never a "revision" of an existing value, so the
 *     gate does not apply — but it is still logged as an initial revision row.
 *
 * No leaf module imports this; the kernel composition root wires it as the
 * belief sink for the signal-emitter.
 */

import { computeConfidence } from './belief-store.js';
import {
  convinceLoop,
  type ConvinceDeps,
} from './convince-loop.js';
import type {
  Belief,
  BeliefSource,
  ConvinceResult,
  ExtractedClaim,
} from './types.js';

export interface ReviseBeliefDeps extends ConvinceDeps {
  /** Mints belief ids when creating a brand-new belief. */
  readonly idFactory?: () => string;
}

/**
 * Look up the prior belief for the claim's (subject, scope), then either
 * convince-loop it or create a fresh belief. Returns the ConvinceResult so
 * callers can audit the action taken.
 */
export async function reviseBelief(
  claim: ExtractedClaim,
  deps: ReviseBeliefDeps,
): Promise<ConvinceResult> {
  const scope = {
    subjectUserId: claim.subjectUserId ?? null,
    subjectOrgId: claim.subjectOrgId ?? null,
  };
  const prior = await deps.store.findBySubject(claim.subject, scope);
  if (prior) {
    return convinceLoop({ claim, priorBelief: prior }, deps);
  }
  return createBelief(claim, deps);
}

async function createBelief(
  claim: ExtractedClaim,
  deps: ReviseBeliefDeps,
): Promise<ConvinceResult> {
  const nowMs = (deps.now ?? Date.now)();
  const nowIso = new Date(nowMs).toISOString();
  const verified = claim.portal === 'owner' || claim.portal === 'admin';
  const source: BeliefSource = {
    kind: 'user-claim',
    authority: verified ? 0.65 : 0.45,
    excerpt: claim.evidenceFromTurn,
    capturedAt: nowIso,
    authorRef: claim.conversationId,
  };
  const draft: Belief = {
    id: deps.idFactory ? deps.idFactory() : '',
    domain: claim.domain,
    subject: claim.subject,
    description: claim.description,
    value: claim.proposedValue,
    confidence: Math.min(computeConfidence([source]), claim.confidence || 0.45),
    sources: [source],
    revisedAt: nowIso,
    revisionCount: 0,
    tags: [],
    subjectUserId: claim.subjectUserId ?? null,
    subjectOrgId: claim.subjectOrgId ?? null,
  };
  const persisted = await deps.store.upsert(draft);
  await deps.store.recordRevision({
    beliefId: persisted.id,
    before: { ...persisted, confidence: 0, sources: [], revisionCount: -1 },
    after: persisted,
    rationale: `Created new belief '${persisted.subject}' from a ${claim.portal} claim (no prior belief existed).`,
    newSources: [source],
    triggeredBy: 'chat-hook',
  });
  return {
    action: 'strengthen',
    priorBelief: null,
    newBelief: persisted,
    confidenceDelta: persisted.confidence,
    rationale: `New belief created (initial confidence ${persisted.confidence.toFixed(2)}).`,
    newSourcesAdded: 1,
    contradictionDetected: false,
  };
}
