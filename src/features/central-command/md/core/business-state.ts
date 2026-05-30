/**
 * MD Core - Business State Snapshot
 *
 * Canonical snapshot the MD reasons over. Backed by Supabase tables in
 * production; tests inject a typed in-memory port.
 *
 * Cache policy: 30 second TTL per `orgId`. Tier-scoped at fetch time so that
 * sovereign / borjie-admin callers receive the aggregated, PII-stripped
 * branch (per CLAUDE.md hard rules).
 *
 * Reads are immutable: snapshots are deep-frozen before they leave this
 * module.
 *
 * @module features/central-command/md/core/business-state
 */

import { createLogger } from "@/lib/logger";
import {
  assertTierPolicy,
  type BorjieAITier,
} from "@/core/governance/tier-policy";
import type { BusinessSnapshot } from "@/features/central-command/md/nba/types";

const log = createLogger("md.core.business-state");

export const BUSINESS_STATE_TTL_MS = 30_000;

// ---------------------------------------------------------------------------
// Port (so we don't import Supabase inside the MD core; the route handler
// composes the real fetcher)
// ---------------------------------------------------------------------------

export interface BusinessStateFetcher {
  /** Fetch the snapshot for `orgId` from the underlying store. */
  fetch(orgId: string): Promise<BusinessSnapshot>;
  /**
   * Optional aggregated branch: PII-stripped + cross-org for the sovereign /
   * borjie-admin tiers. When omitted the fetcher returns the same shape as
   * `fetch` but stripped before returning.
   */
  fetchAggregated?(orgId: string): Promise<BusinessSnapshot>;
}

// ---------------------------------------------------------------------------
// Cache (immutable map swap; never mutate entries)
// ---------------------------------------------------------------------------

interface CacheEntry {
  readonly fetchedAtMs: number;
  readonly snapshot: BusinessSnapshot;
  readonly tierBranch: TierBranch;
}

type TierBranch = "full" | "aggregated";

/**
 * H-1 fix: the previous implementation hard-coded
 * `borjie-admin → aggregated`, which zeroed out every customer /
 * employee / pipeline / supplier when an internal admin opened
 * `/borjie-admin/md`. The MD chat then surfaced "0 customers, 0
 * agenda items" forever and the morning-brief sleep pass emitted a
 * useless brief per org.
 *
 * The aggregated branch is meant for cross-org analytics (the
 * sovereign tier). Internal admins acting on a SPECIFIC org should
 * see that org's data (RLS still enforces what they can read at the
 * DB layer). Only the sovereign tier — which by design must NEVER
 * see PII — gets the aggregated branch.
 */
function branchForTier(tier: BorjieAITier): TierBranch {
  if (tier === "sovereign") {
    return "aggregated";
  }
  return "full";
}

function deepFreezeSnapshot(s: BusinessSnapshot): BusinessSnapshot {
  // Top-level + arrays. Children of arrays are typed `readonly` already.
  return Object.freeze({
    ...s,
    customers: Object.freeze(s.customers.map((c) => Object.freeze({ ...c }))),
    employees: Object.freeze(s.employees.map((e) => Object.freeze({ ...e }))),
    pipeline: Object.freeze(s.pipeline.map((p) => Object.freeze({ ...p }))),
    suppliers: Object.freeze(s.suppliers.map((p) => Object.freeze({ ...p }))),
    finance: Object.freeze({ ...s.finance }),
    compliance: Object.freeze(s.compliance.map((c) => Object.freeze({ ...c }))),
    learning: Object.freeze(s.learning.map((l) => Object.freeze({ ...l }))),
    ownerSentiment: s.ownerSentiment
      ? Object.freeze({
          ...s.ownerSentiment,
          recentTopics: Object.freeze([...s.ownerSentiment.recentTopics]),
        })
      : undefined,
    ownerStyle: s.ownerStyle ? Object.freeze({ ...s.ownerStyle }) : undefined,
  });
}

/**
 * Strip PII from a snapshot so the sovereign branch never leaks tenant
 * identifiers. Customers / employees are kept as opaque rollup counts.
 */
function aggregatePiiStripped(s: BusinessSnapshot): BusinessSnapshot {
  return deepFreezeSnapshot({
    orgId: "<aggregated>",
    generatedAt: s.generatedAt,
    customers: [],
    employees: [],
    pipeline: [],
    suppliers: [],
    finance: { ...s.finance },
    compliance: [],
    learning: [],
    ownerSentiment: undefined,
    ownerStyle: undefined,
  });
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface BusinessStateServiceOptions {
  readonly ttlMs?: number;
  /** Inject a clock for tests; defaults to Date.now. */
  readonly clock?: () => number;
}

export class BusinessStateService {
  private cache: ReadonlyMap<string, CacheEntry> = new Map();
  private readonly ttlMs: number;
  private readonly clock: () => number;

  constructor(
    private readonly fetcher: BusinessStateFetcher,
    options: BusinessStateServiceOptions = {},
  ) {
    this.ttlMs = options.ttlMs ?? BUSINESS_STATE_TTL_MS;
    this.clock = options.clock ?? Date.now;
  }

  /**
   * Read a tier-scoped snapshot. Reads from cache when fresh, otherwise
   * delegates to the fetcher. Never mutates state.
   */
  async getSnapshot(
    orgId: string,
    tier: BorjieAITier,
  ): Promise<BusinessSnapshot> {
    const branch = branchForTier(tier);
    const tierAction =
      branch === "aggregated" ? "read:cross_org_aggregated" : "read:org_data";
    const tierCheck = assertTierPolicy(tier, tierAction);
    if (!tierCheck.ok) {
      log.warn("snapshot.fetch.tier-denied", { orgId, tier, tierAction });
      throw new Error(
        `business-state: tier '${tier}' may not '${tierAction}' (${tierCheck.reason})`,
      );
    }

    const key = `${orgId}::${branch}`;
    const now = this.clock();
    const hit = this.cache.get(key);
    if (
      hit &&
      now - hit.fetchedAtMs <= this.ttlMs &&
      hit.tierBranch === branch
    ) {
      log.debug("snapshot.cache.hit", { orgId, tier, branch });
      return hit.snapshot;
    }

    log.debug("snapshot.cache.miss", { orgId, tier, branch });
    const raw =
      branch === "aggregated" && this.fetcher.fetchAggregated
        ? await this.fetcher.fetchAggregated(orgId)
        : await this.fetcher.fetch(orgId);

    const snapshot =
      branch === "aggregated"
        ? aggregatePiiStripped(raw)
        : deepFreezeSnapshot(raw);

    // Immutable cache swap (never mutate the existing map).
    const next = new Map(this.cache);
    next.set(
      key,
      Object.freeze({ fetchedAtMs: now, snapshot, tierBranch: branch }),
    );
    this.cache = next;
    return snapshot;
  }

  /** Invalidate the cache for one org (e.g. after an MD action lands). */
  invalidate(orgId: string): void {
    const next = new Map(this.cache);
    for (const branch of ["full", "aggregated"] as const) {
      next.delete(`${orgId}::${branch}`);
    }
    this.cache = next;
  }
}

// ---------------------------------------------------------------------------
// Helper: build an empty snapshot for tests / smoke routes
// ---------------------------------------------------------------------------

export function emptySnapshot(orgId: string): BusinessSnapshot {
  return deepFreezeSnapshot({
    orgId,
    generatedAt: new Date(0).toISOString(),
    customers: [],
    employees: [],
    pipeline: [],
    suppliers: [],
    finance: {
      cashUsd: 0,
      monthlyBurnUsd: 0,
      overdueInvoicesCount: 0,
      overdueAmountUsd: 0,
    },
    compliance: [],
    learning: [],
  });
}
