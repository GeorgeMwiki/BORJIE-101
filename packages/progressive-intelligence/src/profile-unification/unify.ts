/**
 * Profile unification — fold a set of fragments into one canonical
 * `UnifiedProfile`. The fragments must already belong to the same
 * subject (caller does the clustering with `linkFragments`). This
 * function does NOT re-cluster; it merges attributes per the
 * configured rules.
 *
 * Append-only fragments: nothing is dropped. When a new fragment
 * arrives, callers pass the existing UnifiedProfile.fragments plus the
 * new one and `unifyProfile` re-resolves. This guarantees the unify
 * output is purely a function of the fragment set + rules — no hidden
 * state.
 */
import { createHash } from 'crypto';
import type {
  ProfileFragment,
  ProfileFragmentSource,
  UnifiedProfile,
  UnifyRules,
} from '../types.js';

export interface UnifyProfileArgs {
  readonly subjectId?: string;
  readonly fragments: ReadonlyArray<ProfileFragment>;
  readonly rules: UnifyRules;
}

function subjectIdFromFragments(fragments: ReadonlyArray<ProfileFragment>): string {
  // Deterministic — derived from sorted fragment ids. Lets clients
  // refer to a subject before a server-side id has been minted.
  const ids = fragments.map((f) => f.id).sort();
  return createHash('sha1').update(ids.join('|')).digest('hex').slice(0, 20);
}

function pickByMostRecent(
  fragments: ReadonlyArray<ProfileFragment>,
): { attrs: Record<string, unknown>; origins: Record<string, ProfileFragmentSource> } {
  const attrs: Record<string, unknown> = {};
  const origins: Record<string, ProfileFragmentSource> = {};
  const tracker = new Map<
    string,
    { value: unknown; ts: string; source: ProfileFragmentSource }
  >();
  for (const f of fragments) {
    for (const [k, v] of Object.entries(f.attributes)) {
      if (v == null) continue;
      const prior = tracker.get(k);
      if (!prior || f.capturedAt > prior.ts) {
        tracker.set(k, { value: v, ts: f.capturedAt, source: f.source });
      }
    }
  }
  for (const [k, { value, source }] of tracker) {
    attrs[k] = value;
    origins[k] = source;
  }
  return { attrs, origins };
}

function pickByAuthoritative(
  fragments: ReadonlyArray<ProfileFragment>,
  order: ReadonlyArray<ProfileFragmentSource>,
): { attrs: Record<string, unknown>; origins: Record<string, ProfileFragmentSource> } {
  const attrs: Record<string, unknown> = {};
  const origins: Record<string, ProfileFragmentSource> = {};
  const sourceRank = new Map<ProfileFragmentSource, number>();
  order.forEach((s, i) => sourceRank.set(s, i));
  const rankOf = (s: ProfileFragmentSource) =>
    sourceRank.has(s) ? (sourceRank.get(s) as number) : order.length;
  const tracker = new Map<
    string,
    { value: unknown; rank: number; ts: string; source: ProfileFragmentSource }
  >();
  for (const f of fragments) {
    for (const [k, v] of Object.entries(f.attributes)) {
      if (v == null) continue;
      const r = rankOf(f.source);
      const prior = tracker.get(k);
      if (!prior || r < prior.rank || (r === prior.rank && f.capturedAt > prior.ts)) {
        tracker.set(k, { value: v, rank: r, ts: f.capturedAt, source: f.source });
      }
    }
  }
  for (const [k, { value, source }] of tracker) {
    attrs[k] = value;
    origins[k] = source;
  }
  return { attrs, origins };
}

export function unifyProfile(args: UnifyProfileArgs): UnifiedProfile {
  const { fragments, rules } = args;
  if (fragments.length === 0) {
    throw new Error('unifyProfile: fragments must not be empty');
  }
  // Multi-tenant guard.
  const tenantId = fragments[0]?.tenantId as string;
  for (const f of fragments) {
    if (f.tenantId !== tenantId) {
      throw new Error('unifyProfile: fragments span multiple tenants');
    }
  }

  // Stable ordering — by capturedAt then id — so output is deterministic.
  const sorted = [...fragments].sort((a, b) => {
    if (a.capturedAt !== b.capturedAt) return a.capturedAt.localeCompare(b.capturedAt);
    return a.id.localeCompare(b.id);
  });

  const merged =
    rules.resolveScalarsBy === 'authoritative'
      ? pickByAuthoritative(sorted, rules.authoritativeOrder ?? [])
      : pickByMostRecent(sorted);

  const lastFragmentAt = sorted.reduce(
    (acc, f) => (f.capturedAt > acc ? f.capturedAt : acc),
    sorted[0]?.capturedAt ?? '',
  );

  const subjectId = args.subjectId ?? subjectIdFromFragments(sorted);

  return {
    subjectId,
    tenantId,
    attributes: merged.attrs,
    attributeOrigins: merged.origins,
    fragments: sorted,
    lastFragmentAt,
    schemaVersion: 1,
  };
}

/**
 * Re-unify with a new fragment. Equivalent to
 * `unifyProfile({ ..., fragments: [...existing.fragments, newFragment] })`.
 */
export function incorporateFragment(args: {
  readonly existing: UnifiedProfile;
  readonly fragment: ProfileFragment;
  readonly rules: UnifyRules;
}): UnifiedProfile {
  if (args.fragment.tenantId !== args.existing.tenantId) {
    throw new Error('incorporateFragment: tenant mismatch');
  }
  return unifyProfile({
    subjectId: args.existing.subjectId,
    fragments: [...args.existing.fragments, args.fragment],
    rules: args.rules,
  });
}
