/**
 * Cross-reference — agreement / disagreement detection between sources.
 *
 * Per DEEP_RESEARCH_SPEC §4.4 (Synthesizer) + §7 (corroboration boost):
 *
 *   - If ≥2 independent high-quality sources concur, the synthesizer
 *     may claim `confidence='high'`.
 *   - If sources disagree on a claim, the disagreement is surfaced as
 *     a separate `disagreements[]` array — never silently averaged
 *     (§4.4 anti-pattern).
 *
 * This module is the pure "do these N artifacts agree?" function. It
 * keys agreement on a topic bucket (currently title-derived) and
 * returns three buckets: agree, disagree, neutral. The synthesizer
 * uses this to drive both the corroboration boost and the
 * disagreement section in the rendered markdown.
 *
 * No I/O. Deterministic.
 *
 * @module research-orchestrator/scorer/cross-reference
 */

import type { ResearchArtifact } from '../types.js';

export interface CrossReferenceResult {
  /** Bucket name → list of artifact ids that support the claim. */
  readonly agree: ReadonlyMap<string, ReadonlyArray<string>>;
  /** Bucket name → list of artifact ids that contradict. */
  readonly disagree: ReadonlyMap<string, ReadonlyArray<string>>;
  /** Topic buckets with only one corroborator (high-quality or not). */
  readonly singletons: ReadonlyArray<string>;
}

export interface DisagreementEntry {
  readonly topic: string;
  readonly sources: ReadonlyArray<string>;
}

/**
 * Compare every artifact's "claim" (the title) against every other
 * artifact's content. Returns a structured agreement / disagreement
 * map.
 */
export function crossReference(
  artifacts: ReadonlyArray<ResearchArtifact>,
): CrossReferenceResult {
  const agree = new Map<string, Array<string>>();
  const disagree = new Map<string, Array<string>>();
  const seenBuckets = new Set<string>();

  for (const a of artifacts) {
    const bucket = topicBucket(a.title);
    seenBuckets.add(bucket);
    push(agree, bucket, a.id);
    for (const b of artifacts) {
      if (b.id === a.id) continue;
      if (contradicts(b.content, a.title)) {
        push(disagree, bucket, b.id);
      }
    }
  }

  const singletons: Array<string> = [];
  for (const bucket of seenBuckets) {
    if ((agree.get(bucket)?.length ?? 0) === 1) {
      singletons.push(bucket);
    }
  }

  return {
    agree,
    disagree,
    singletons: Object.freeze(singletons),
  };
}

/**
 * Build the disagreements[] array the ResearchResult exposes. Only
 * topics with at least one contradicting source make it in.
 */
export function buildDisagreements(
  artifacts: ReadonlyArray<ResearchArtifact>,
  xref: CrossReferenceResult,
): ReadonlyArray<DisagreementEntry> {
  const out: Array<DisagreementEntry> = [];
  for (const [bucket, ids] of xref.disagree.entries()) {
    if (ids.length === 0) continue;
    const sources = ids
      .map((id) => artifacts.find((a) => a.id === id)?.source_uri)
      .filter((u): u is string => typeof u === 'string');
    out.push({
      topic: bucketLabel(bucket),
      sources: Object.freeze(sources),
    });
  }
  return Object.freeze(out);
}

function topicBucket(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 4)
    .join('-');
}

function bucketLabel(bucket: string): string {
  return bucket.replace(/-/g, ' ');
}

function contradicts(content: string, title: string): boolean {
  const lc = content.toLowerCase();
  const lcTitle = title.toLowerCase();
  const idx = lc.indexOf(lcTitle);
  if (idx === -1) return false;
  const prefix = lc.slice(Math.max(0, idx - 50), idx);
  return /(\bnot\b|\bno\b|\bnever\b|\bfalse\b)/.test(prefix);
}

function push(map: Map<string, Array<string>>, key: string, value: string): void {
  const existing = map.get(key);
  if (existing) {
    existing.push(value);
  } else {
    map.set(key, [value]);
  }
}
