/**
 * Narrative-arc builder — connects related episodes into stories.
 *
 * Strategy: cluster episodes by (subject, tag-overlap, temporal-window).
 * Then summarise each cluster into a NarrativeArc.
 *
 * Pure builder — caller supplies a fetched list of episodes; this module
 * does not query stores (keeps it deterministic for tests).
 */

import type { Episode, NarrativeArc } from '../types.js';

const DEFAULT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;
const MIN_TAG_OVERLAP = 1;

interface BuildArcsOptions {
  readonly tenantId: string;
  readonly windowMs?: number;
  readonly minOverlap?: number;
  readonly idFactory: () => string;
  readonly now: () => string;
}

export function buildNarrativeArcs(
  episodes: ReadonlyArray<Episode>,
  options: BuildArcsOptions,
): ReadonlyArray<NarrativeArc> {
  if (episodes.length === 0) return [];
  const windowMs = options.windowMs ?? DEFAULT_WINDOW_MS;
  const minOverlap = options.minOverlap ?? MIN_TAG_OVERLAP;

  const sorted = [...episodes]
    .filter((ep) => ep.tenantId === options.tenantId)
    .sort(
      (a, b) =>
        Date.parse(a.validFrom) - Date.parse(b.validFrom),
    );

  const clusters: Episode[][] = [];
  for (const ep of sorted) {
    const placed = clusters.some((cluster) => {
      const seed = cluster[cluster.length - 1];
      if (!seed) return false;
      const sameSubject =
        ep.subject !== null && ep.subject === seed.subject;
      const overlap = countTagOverlap(ep.tags, seed.tags);
      const within =
        Date.parse(ep.validFrom) - Date.parse(seed.validFrom) <= windowMs;
      if (within && (sameSubject || overlap >= minOverlap)) {
        cluster.push(ep);
        return true;
      }
      return false;
    });
    if (!placed) clusters.push([ep]);
  }

  return clusters
    .filter((cluster) => cluster.length >= 2)
    .map((cluster) => clusterToArc(cluster, options));
}

function countTagOverlap(
  a: ReadonlyArray<string>,
  b: ReadonlyArray<string>,
): number {
  const set = new Set(a);
  let count = 0;
  for (const tag of b) if (set.has(tag)) count++;
  return count;
}

function clusterToArc(
  cluster: ReadonlyArray<Episode>,
  options: BuildArcsOptions,
): NarrativeArc {
  const first = cluster[0];
  const last = cluster[cluster.length - 1];
  if (!first || !last) {
    // Defensive — the caller filters length >= 2 so this never fires.
    throw new Error('[narrative] empty cluster');
  }

  const tagFreq = new Map<string, number>();
  for (const ep of cluster) {
    for (const tag of ep.tags) {
      tagFreq.set(tag, (tagFreq.get(tag) ?? 0) + 1);
    }
  }
  const tags = [...tagFreq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([t]) => t);

  const subject = first.subject ?? 'multi-subject';
  const title = `${subject} arc (${cluster.length} episodes)`;
  const summary = cluster
    .map((ep) => ep.summary ?? ep.title ?? '(no summary)')
    .filter(Boolean)
    .slice(0, 5)
    .join(' → ');

  return {
    id: options.idFactory(),
    tenantId: options.tenantId,
    title,
    summary,
    episodeIds: cluster.map((ep) => ep.id),
    startedAt: first.validFrom,
    endedAt: last.validTo,
    tags,
    recordedAt: options.now(),
  };
}
