/**
 * GapRegistryWatcher — the metacognitive self-model's blocker-clear probe
 * (Loop A, P0; `Docs/research/THE_METACOGNITIVE_SELF_MODEL.md` §3.4).
 *
 * PURE CORE. Given (a) the OPEN/BLOCKED capability-gap rows for a tenant and
 * (b) the CURRENT capability snapshot — which tools/organs are registered,
 * which flags are enabled, which approvals were granted, which evidence
 * resolves — it re-evaluates every gap's `unblock_trigger` predicate against
 * LIVE state (never trusting a `last_checked` stamp; the self-model-staleness
 * pitfall) and returns the set of newly-UNBLOCKED gap ids as `GapCleared`
 * signals.
 *
 * It has NO IO, NO clock, NO store handle — the EstateMind RECONCILE step (the
 * slow loop) reads the gaps + snapshot, calls `evaluateGapClears`, and the
 * composition root acts on each `GapCleared` (advance blocked→scheduled, run
 * the verifier-gated re-attempt). This decoupling is the design's whole point:
 * the watcher is a structural monitor, never the actor policing itself
 * (arXiv:2508.13465 — the acting loop rationalises past its own gaps).
 *
 * SOVEREIGN SAFETY: the watcher does NOT auto-actuate. It only reports that a
 * blocker cleared. A sovereign / needs_approval gap whose trigger clears is
 * still surfaced as `GapCleared`, but the resolver/completion path parks it on
 * a human signal (four-eye) — clearing the blocker NEVER releases a sovereign
 * action by itself.
 */

/** The typed gap kinds the register tracks (mirrors the md_commitments enum). */
export type GapKind =
  | 'missing_tool'
  | 'bug'
  | 'unwired_organ'
  | 'missing_evidence'
  | 'needs_approval'
  | 'understanding_gap'
  | 'structural';

/** The unblock-trigger predicate kinds (mirrors the md_commitments enum). */
export type UnblockTriggerKind =
  | 'tool_registered'
  | 'evidence_ingested'
  | 'approval_granted'
  | 'flag_enabled'
  | 'feature_shipped';

/** The unblock-trigger predicate carried on a gap row. */
export interface UnblockTrigger {
  readonly kind: UnblockTriggerKind;
  readonly target: string;
}

/**
 * The minimal projection of a capability-gap row the watcher needs. The
 * composition root maps `MdCommitment` (gap rows) onto this shape so the kernel
 * stays free of a `@borjie/database` dependency (pure core).
 */
export interface GapRow {
  readonly id: string;
  readonly gapKind: GapKind;
  readonly status: 'open' | 'scheduled' | 'overdue' | 'blocked' | 'reopened';
  readonly unblockTrigger: UnblockTrigger | null;
  /** True when this gap is sovereign (money / licence / deletion class). */
  readonly sovereign: boolean;
}

/**
 * The live capability snapshot — the "half-open circuit-breaker probe" inputs.
 * Every set is re-read fresh each tick from the authoritative source (the tool
 * registry, the flag store, the approval table, the corpus), never cached.
 */
export interface CapabilitySnapshot {
  /** Tool / dispatch names currently registered + resolvable. */
  readonly registeredTools: ReadonlySet<string>;
  /** Organ names that are WIRED (no longer NOT_YET_WIRED). */
  readonly wiredOrgans: ReadonlySet<string>;
  /** Feature-flag names currently enabled. */
  readonly enabledFlags: ReadonlySet<string>;
  /** Four-eye approval keys that have been granted. */
  readonly grantedApprovals: ReadonlySet<string>;
  /** Evidence ids that now resolve to a real corpus chunk. */
  readonly resolvableEvidence: ReadonlySet<string>;
  /** Feature keys whose ship cleared their gap. */
  readonly shippedFeatures: ReadonlySet<string>;
}

/** A blocker-cleared signal — one per newly-unblocked gap. Pure data. */
export interface GapCleared {
  readonly gapId: string;
  readonly gapKind: GapKind;
  readonly trigger: UnblockTrigger;
  /** Sovereign gaps never auto-actuate — the resolver parks them HITL. */
  readonly sovereign: boolean;
}

/** The result of one watcher pass over a tenant's open gaps. */
export interface GapWatchResult {
  /** Gaps whose unblock trigger is now satisfied this tick. */
  readonly cleared: ReadonlyArray<GapCleared>;
  /** Gaps re-probed this tick (observability). */
  readonly probed: number;
}

/**
 * Re-evaluate a single gap's unblock trigger against the live snapshot. Returns
 * `true` when the blocker is now cleared. A gap with no trigger never clears
 * (it can only be released by a human signal through another path).
 */
export function isTriggerSatisfied(
  trigger: UnblockTrigger | null,
  snapshot: CapabilitySnapshot,
): boolean {
  if (!trigger || !trigger.target) return false;
  switch (trigger.kind) {
    case 'tool_registered':
      // A tool is cleared whether it lands in the tool registry OR as a wired
      // organ (a dark organ becoming WIRED is the same blocker-clear).
      return (
        snapshot.registeredTools.has(trigger.target) ||
        snapshot.wiredOrgans.has(trigger.target)
      );
    case 'evidence_ingested':
      return snapshot.resolvableEvidence.has(trigger.target);
    case 'approval_granted':
      return snapshot.grantedApprovals.has(trigger.target);
    case 'flag_enabled':
      return snapshot.enabledFlags.has(trigger.target);
    case 'feature_shipped':
      return snapshot.shippedFeatures.has(trigger.target);
    default:
      return false;
  }
}

/**
 * The pure watcher pass: re-probe every open gap and collect the newly-cleared
 * ones.
 *
 * IDEMPOTENCY IS THE CALLER'S RESPONSIBILITY. This function is referentially
 * transparent — re-running with the SAME inputs yields the SAME `GapCleared`
 * set. But the inputs are NOT stable across ticks: while a cleared gap is still
 * in the live set (e.g. it was scheduled then `reopened` by a failed verify, or
 * is a sovereign gap awaiting a human park), the watcher will surface it AGAIN
 * every tick, and the resolver/completion path will re-fire. The downstream
 * sink MUST therefore be idempotent / terminal-aware: a parked sovereign gap
 * exits the live set via the `needs_approval` TERMINAL status, and an
 * attempt-capped gap exits via `dead_letter`, so neither re-clears + re-fires
 * forever. This function does NOT itself dedupe or remember prior ticks.
 */
export function evaluateGapClears(
  gaps: ReadonlyArray<GapRow>,
  snapshot: CapabilitySnapshot,
): GapWatchResult {
  const cleared: GapCleared[] = [];
  for (const gap of gaps) {
    if (!gap.unblockTrigger) continue;
    if (isTriggerSatisfied(gap.unblockTrigger, snapshot)) {
      cleared.push(
        Object.freeze({
          gapId: gap.id,
          gapKind: gap.gapKind,
          trigger: Object.freeze({ ...gap.unblockTrigger }),
          sovereign: gap.sovereign,
        }),
      );
    }
  }
  return Object.freeze({
    cleared: Object.freeze(cleared),
    probed: gaps.length,
  });
}
