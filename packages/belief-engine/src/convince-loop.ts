/**
 * Convince-loop — handle a claim that contradicts (or restates) a prior
 * belief. The brain doesn't change its mind for no reason.
 *
 * Light pass (values overlap):
 *   "strengthen" — add the claim source, recompute confidence. No value change.
 *
 * Heavy pass (contradiction):
 *   1. Optional web research (injected port) for corroborating evidence.
 *   2. Authority + recency weighting.
 *   3. confidenceDelta = newSideWeight − priorSideWeight.
 *   4. Threshold (CLAUDE.md belief-revision gate):
 *        delta >  REVISE_DELTA_THRESHOLD (0.25)          → "revise" (replace value)
 *        SPLIT (0.05) < delta <= REVISE (0.25)           → "split"  (queue for review,
 *                                                            reduce prior confidence)
 *        delta <= SPLIT (0.05)                           → "no-change" (log only)
 *   5. Always record a rationale + an immutable revision row.
 *
 * The loop NEVER writes a belief directly — it routes every write through
 * the injected `BeliefStorePort.upsert`, which is the sole authorised writer.
 * Quarantined claims raise the revise floor from 0.25 to 0.4.
 *
 * Ported from LITFIN litfin-ai/learning/convince-loop.ts.
 */

import { computeConfidence, clamp01 } from './belief-store.js';
import {
  ageInDays,
  newSideEvidenceWeight,
  PORTAL_AUTHORITY,
  priorSideEvidenceWeight,
} from './evidence-weight.js';
import { valuesOverlap } from './value-overlap.js';
import type {
  Belief,
  BeliefSource,
  BeliefStorePort,
  ConvinceAction,
  ConvinceResult,
  ExtractedClaim,
  WebSearchResult,
} from './types.js';

/** Revise gate — replace the belief value only above this delta. */
export const REVISE_DELTA_THRESHOLD = 0.25;
/** Split gate — below this delta the claim is a no-op. */
export const SPLIT_DELTA_THRESHOLD = 0.05;
/** Quarantined claims must clear this higher floor to revise. */
export const QUARANTINE_REVISE_FLOOR = 0.4;

/** Web-search port — injected. Default returns no corroborating evidence. */
export type WebSearchPort = (
  query: string,
  opts: { readonly maxResults: number },
) => Promise<ReadonlyArray<WebSearchResult>>;

const NO_WEB_SEARCH: WebSearchPort = async () => [];

export interface ConvinceDeps {
  readonly store: BeliefStorePort;
  readonly webSearch?: WebSearchPort;
  readonly now?: () => number;
}

export interface ConvinceArgs {
  readonly claim: ExtractedClaim;
  readonly priorBelief: Belief;
}

/**
 * Run the convince-loop for a claim against a prior belief.
 */
export async function convinceLoop(
  args: ConvinceArgs,
  deps: ConvinceDeps,
): Promise<ConvinceResult> {
  const overlap = valuesOverlap(
    args.priorBelief.value,
    args.claim.proposedValue,
  );
  if (overlap) {
    return strengthenPass(args, deps);
  }
  return heavyPass(args, deps);
}

// ─── Light pass — strengthen ──────────────────────────────────────────

async function strengthenPass(
  args: ConvinceArgs,
  deps: ConvinceDeps,
): Promise<ConvinceResult> {
  const nowIso = new Date(now(deps)).toISOString();
  const newSource = buildClaimSource(args.claim, nowIso);
  const sources = [...args.priorBelief.sources, newSource];
  const newBelief: Belief = {
    ...args.priorBelief,
    sources,
    confidence: computeConfidence(sources),
    revisedAt: nowIso,
    revisionCount: args.priorBelief.revisionCount + 1,
    subjectUserId: args.priorBelief.subjectUserId ?? null,
    subjectOrgId: args.priorBelief.subjectOrgId ?? null,
  };
  const persisted = await deps.store.upsert(newBelief);
  const delta = persisted.confidence - args.priorBelief.confidence;

  await deps.store.recordRevision({
    beliefId: persisted.id,
    before: args.priorBelief,
    after: persisted,
    rationale: `Strengthened — new ${args.claim.portal} claim agrees with prior value (overlap). Confidence ${args.priorBelief.confidence.toFixed(2)} → ${persisted.confidence.toFixed(2)}.`,
    newSources: [newSource],
    triggeredBy: 'chat-hook',
  });

  return {
    action: 'strengthen',
    priorBelief: args.priorBelief,
    newBelief: persisted,
    confidenceDelta: delta,
    rationale: 'Prior belief corroborated by new claim; no value change.',
    newSourcesAdded: 1,
    contradictionDetected: false,
  };
}

// ─── Heavy pass — revise / split / no-change ──────────────────────────

async function heavyPass(
  args: ConvinceArgs,
  deps: ConvinceDeps,
): Promise<ConvinceResult> {
  const search = deps.webSearch ?? NO_WEB_SEARCH;
  const query = sanitizeSearchQuery(
    `${args.claim.subject} ${args.claim.description}`,
  );
  const webResults = query ? await search(query, { maxResults: 5 }) : [];

  const newSide = newSideEvidenceWeight({
    portal: args.claim.portal,
    claimConfidence: args.claim.confidence,
    webResults,
  });
  const priorSide = priorSideEvidenceWeight(args.priorBelief, now(deps));
  const delta = newSide - priorSide;

  const reviseFloor = args.claim.quarantined
    ? QUARANTINE_REVISE_FLOOR
    : REVISE_DELTA_THRESHOLD;

  if (delta > reviseFloor) {
    return revisePass(args, deps, webResults, delta);
  }
  if (delta > SPLIT_DELTA_THRESHOLD) {
    return splitPass(args, deps, webResults, delta);
  }
  return noChangePass(args, deps, webResults, delta);
}

async function revisePass(
  args: ConvinceArgs,
  deps: ConvinceDeps,
  webResults: ReadonlyArray<WebSearchResult>,
  delta: number,
): Promise<ConvinceResult> {
  const nowIso = new Date(now(deps)).toISOString();
  const newSources = [
    ...keepTopSources(args.priorBelief.sources, 2),
    buildClaimSource(args.claim, nowIso),
    ...webResults.map((r) => webResultToSource(r, nowIso)),
  ];
  const newBelief: Belief = {
    ...args.priorBelief,
    value: args.claim.proposedValue,
    description: args.claim.description,
    sources: newSources,
    confidence: computeConfidence(newSources),
    revisedAt: nowIso,
    revisionCount: args.priorBelief.revisionCount + 1,
    subjectUserId: args.priorBelief.subjectUserId ?? null,
    subjectOrgId: args.priorBelief.subjectOrgId ?? null,
  };
  const persisted = await deps.store.upsert(newBelief);
  const rationale = formatRationale('revise', delta, args, webResults, deps);

  await deps.store.recordRevision({
    beliefId: persisted.id,
    before: args.priorBelief,
    after: persisted,
    rationale,
    newSources: newSources.filter(
      (s) =>
        !args.priorBelief.sources.some(
          (p) => p.url === s.url && p.kind === s.kind,
        ),
    ),
    triggeredBy: 'chat-hook',
  });

  return {
    action: 'revise',
    priorBelief: args.priorBelief,
    newBelief: persisted,
    confidenceDelta: persisted.confidence - args.priorBelief.confidence,
    rationale,
    newSourcesAdded: 1 + webResults.length,
    contradictionDetected: true,
  };
}

async function splitPass(
  args: ConvinceArgs,
  deps: ConvinceDeps,
  webResults: ReadonlyArray<WebSearchResult>,
  delta: number,
): Promise<ConvinceResult> {
  const nowIso = new Date(now(deps)).toISOString();
  // Keep the prior value but reduce its confidence + flag as contested, and
  // queue the contradicting claim for human / sleep-pass adjudication.
  const reduced = Math.max(0.05, args.priorBelief.confidence * 0.85);
  const newSources = [
    ...args.priorBelief.sources,
    buildClaimSource(args.claim, nowIso),
    ...webResults.map((r) => webResultToSource(r, nowIso)),
  ];
  const newBelief: Belief = {
    ...args.priorBelief,
    sources: newSources,
    confidence: reduced,
    revisedAt: nowIso,
    revisionCount: args.priorBelief.revisionCount + 1,
    tags: Array.from(new Set([...args.priorBelief.tags, 'contested'])),
    subjectUserId: args.priorBelief.subjectUserId ?? null,
    subjectOrgId: args.priorBelief.subjectOrgId ?? null,
  };
  const persisted = await deps.store.upsert(newBelief);
  const rationale = formatRationale('split', delta, args, webResults, deps);

  await deps.store.recordRevision({
    beliefId: persisted.id,
    before: args.priorBelief,
    after: persisted,
    rationale,
    newSources: [
      buildClaimSource(args.claim, nowIso),
      ...webResults.map((r) => webResultToSource(r, nowIso)),
    ],
    triggeredBy: 'chat-hook',
  });
  await deps.store.enqueueReview({
    beliefId: persisted.id,
    subject: persisted.subject,
    proposedValue: args.claim.proposedValue,
    confidenceDelta: delta,
    rationale,
    subjectUserId: persisted.subjectUserId ?? null,
    subjectOrgId: persisted.subjectOrgId ?? null,
  });

  return {
    action: 'split',
    priorBelief: args.priorBelief,
    newBelief: persisted,
    confidenceDelta: persisted.confidence - args.priorBelief.confidence,
    rationale,
    newSourcesAdded: 1 + webResults.length,
    contradictionDetected: true,
    reviewQueued: true,
  };
}

async function noChangePass(
  args: ConvinceArgs,
  deps: ConvinceDeps,
  webResults: ReadonlyArray<WebSearchResult>,
  delta: number,
): Promise<ConvinceResult> {
  const rationale = formatRationale('no-change', delta, args, webResults, deps);
  await deps.store.recordRevision({
    beliefId: args.priorBelief.id,
    before: args.priorBelief,
    after: args.priorBelief,
    rationale,
    newSources: [],
    triggeredBy: 'chat-hook',
  });
  return {
    action: 'no-change',
    priorBelief: args.priorBelief,
    newBelief: args.priorBelief,
    confidenceDelta: 0,
    rationale,
    newSourcesAdded: 0,
    contradictionDetected: true,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────

function now(deps: ConvinceDeps): number {
  return (deps.now ?? Date.now)();
}

/**
 * Strip search operators + embedded quotes before any web search so a claim
 * containing `site:evil.com` cannot smuggle a query-pivot; clamp to 200 chars
 * so the adapter never sees a pathological prompt-injection payload.
 */
export function sanitizeSearchQuery(text: string): string {
  if (!text || typeof text !== 'string') return '';
  const ops = /\b(?:site|inurl|intitle|filetype|before|after|cache|link):/gi;
  return text
    .replace(ops, '')
    .replace(/"/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

function buildClaimSource(claim: ExtractedClaim, nowIso: string): BeliefSource {
  const verified = claim.portal === 'owner' || claim.portal === 'admin';
  return {
    kind: 'user-claim',
    authority: verified ? 0.65 : 0.45,
    excerpt: claim.evidenceFromTurn,
    capturedAt: nowIso,
    authorRef: claim.conversationId,
  };
}

function webResultToSource(r: WebSearchResult, nowIso: string): BeliefSource {
  return {
    kind: 'web-research',
    authority: clamp01(r.authority),
    url: r.url,
    excerpt: r.snippet || r.title,
    capturedAt: nowIso,
  };
}

function keepTopSources(
  sources: ReadonlyArray<BeliefSource>,
  k: number,
): ReadonlyArray<BeliefSource> {
  return [...sources].sort((a, b) => b.authority - a.authority).slice(0, k);
}

function formatRationale(
  action: ConvinceAction,
  delta: number,
  args: ConvinceArgs,
  webResults: ReadonlyArray<WebSearchResult>,
  deps: ConvinceDeps,
): string {
  const portalAuth = PORTAL_AUTHORITY[args.claim.portal] ?? 0.4;
  const ageDays = Math.round(ageInDays(args.priorBelief.revisedAt, now(deps)));
  const webAuth =
    webResults.length === 0
      ? 'no corroborating web evidence'
      : `web evidence avg authority ${(
          webResults.reduce((a, r) => a + r.authority, 0) / webResults.length
        ).toFixed(2)} across ${webResults.length} results`;
  const head =
    action === 'revise'
      ? 'Brain revised: new claim outweighs prior.'
      : action === 'split'
        ? 'Brain split: contradiction queued for review, prior confidence reduced.'
        : 'Brain stood firm: new claim did not meet revision threshold.';
  return `${head} Delta=${delta.toFixed(2)} from a ${args.claim.portal} (auth=${portalAuth.toFixed(2)}) claim against a prior belief ${ageDays}d old (conf=${args.priorBelief.confidence.toFixed(2)}). ${webAuth}.`;
}
