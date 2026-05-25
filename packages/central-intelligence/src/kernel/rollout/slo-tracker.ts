/**
 * SLO tracker — per-(capability, version) rolling-window metrics.
 *
 * Central Command Phase D (D5 — Rollout safety). Sierra Agent Studio
 * 2.0 calls this an "agent reliability score"; PlatformEngineering.org
 * lists the same four metrics as the floor every agent platform must
 * guarantee BEFORE letting an agent take real traffic. We track:
 *
 *   - completion_rate            — fraction of interactions that
 *                                  reached a normal stop (no error,
 *                                  no escalation)
 *   - escalation_rate            — fraction that triggered an inviolable
 *                                  / policy / uncertainty / refusal
 *                                  gate (or an explicit handoff)
 *   - judge_score_p50            — median self-review judge score
 *   - cost_per_interaction_usd   — provider USD spent per interaction
 *
 * Default thresholds (operator override via the registry row's
 * `metadata.sloOverrides.<capability>`):
 *
 *   completion_rate         >= 0.92
 *   escalation_rate         <= 0.10
 *   judge_score_p50         >= 0.75
 *   cost_per_interaction    <= active_cost * 1.20
 *
 * Auto-rollback condition: if a version breaches ANY threshold across
 * TWO CONSECUTIVE 5-minute windows, the tracker emits a `degraded`
 * decision. The rollout controller forwards that decision to the
 * registry service which moves the row to `degraded`; the next request
 * goes to the active fallback.
 *
 * The tracker is in-memory. Compositions that need durability persist
 * via the consolidation runner (D5 follow-up). Restart-resilience
 * lives in the registry table (status=`degraded` survives a reboot).
 */

export type SloThresholdKey =
  | 'completionRate'
  | 'escalationRate'
  | 'judgeScoreP50'
  | 'costPerInteractionUsd';

export interface SloThresholds {
  readonly completionRateMin: number;
  readonly escalationRateMax: number;
  readonly judgeScoreP50Min: number;
  /**
   * Multiplier over the active version's cost-per-interaction. A canary
   * variant whose cost exceeds `active_cost * costMultiplierMax`
   * breaches even if all other metrics are healthy — Klarna's runaway
   * cost was the canary in the coal mine, not the completion rate.
   */
  readonly costMultiplierMax: number;
}

export const DEFAULT_SLO_THRESHOLDS: SloThresholds = Object.freeze({
  completionRateMin: 0.92,
  escalationRateMax: 0.1,
  judgeScoreP50Min: 0.75,
  costMultiplierMax: 1.2,
});

export interface InteractionEvent {
  readonly capability: string;
  readonly version: string;
  readonly outcome: 'completed' | 'escalated' | 'refused';
  readonly judgeScore: number; // 0..1
  readonly costUsd: number;
  readonly timestampMs: number;
}

export interface WindowSnapshot {
  readonly capability: string;
  readonly version: string;
  readonly windowStartMs: number;
  readonly windowEndMs: number;
  readonly interactions: number;
  readonly completionRate: number;
  readonly escalationRate: number;
  readonly judgeScoreP50: number;
  readonly costPerInteractionUsd: number;
}

export type BreachReason =
  | 'completion-rate-below-threshold'
  | 'escalation-rate-above-threshold'
  | 'judge-score-p50-below-threshold'
  | 'cost-per-interaction-above-threshold';

export interface BreachDescriptor {
  readonly capability: string;
  readonly version: string;
  readonly reason: BreachReason;
  readonly observed: number;
  readonly threshold: number;
}

export interface SloEvaluation {
  readonly snapshot: WindowSnapshot;
  readonly breaches: ReadonlyArray<BreachDescriptor>;
  readonly consecutiveBreachWindows: number;
  readonly shouldRollback: boolean;
}

export interface SloTrackerDeps {
  readonly thresholds?: SloThresholds;
  readonly windowMs?: number;
  readonly consecutiveBreachWindowsRequired?: number;
  readonly now?: () => number;
  /**
   * Cost-per-interaction floor used for the active version. If null,
   * cost SLO is skipped (the active version has no peer to compare
   * against yet).
   */
  readonly activeCostResolver?: (capability: string) => number | null;
}

export interface SloTracker {
  /** Record one finished interaction against the (capability, version). */
  record(event: InteractionEvent): void;
  /** Read the live snapshot for the current rolling window. */
  snapshot(capability: string, version: string): WindowSnapshot | null;
  /**
   * Run threshold evaluation against the most recent COMPLETED window
   * for the given (capability, version) and return the decision —
   * `shouldRollback: true` exactly when N consecutive completed
   * windows have all breached at least one threshold.
   */
  evaluate(capability: string, version: string): SloEvaluation | null;
  /** Reset internal state for tests. */
  reset(capability?: string, version?: string): void;
}

// ─────────────────────────────────────────────────────────────────────
// Internal state shape — one rolling bucket per (capability, version).
// ─────────────────────────────────────────────────────────────────────

interface VersionState {
  readonly capability: string;
  readonly version: string;
  events: InteractionEvent[];
  consecutiveBreachWindows: number;
  lastEvaluatedWindowStartMs: number;
}

function key(capability: string, version: string): string {
  return `${capability}::${version}`;
}

function p50(values: ReadonlyArray<number>): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

function computeSnapshot(
  state: VersionState,
  windowStartMs: number,
  windowEndMs: number,
): WindowSnapshot {
  const inWindow = state.events.filter(
    (e) => e.timestampMs >= windowStartMs && e.timestampMs < windowEndMs,
  );
  const total = inWindow.length;
  const completed = inWindow.filter((e) => e.outcome === 'completed').length;
  const escalated = inWindow.filter(
    (e) => e.outcome === 'escalated' || e.outcome === 'refused',
  ).length;
  const judgeP50 = p50(inWindow.map((e) => e.judgeScore));
  const costAvg =
    total > 0 ? inWindow.reduce((s, e) => s + e.costUsd, 0) / total : 0;
  return {
    capability: state.capability,
    version: state.version,
    windowStartMs,
    windowEndMs,
    interactions: total,
    completionRate: total > 0 ? completed / total : 1,
    escalationRate: total > 0 ? escalated / total : 0,
    judgeScoreP50: judgeP50,
    costPerInteractionUsd: costAvg,
  };
}

function evaluateBreaches(
  snapshot: WindowSnapshot,
  thresholds: SloThresholds,
  activeCost: number | null,
): ReadonlyArray<BreachDescriptor> {
  const out: BreachDescriptor[] = [];
  if (snapshot.interactions === 0) return out;
  if (snapshot.completionRate < thresholds.completionRateMin) {
    out.push({
      capability: snapshot.capability,
      version: snapshot.version,
      reason: 'completion-rate-below-threshold',
      observed: snapshot.completionRate,
      threshold: thresholds.completionRateMin,
    });
  }
  if (snapshot.escalationRate > thresholds.escalationRateMax) {
    out.push({
      capability: snapshot.capability,
      version: snapshot.version,
      reason: 'escalation-rate-above-threshold',
      observed: snapshot.escalationRate,
      threshold: thresholds.escalationRateMax,
    });
  }
  if (snapshot.judgeScoreP50 < thresholds.judgeScoreP50Min) {
    out.push({
      capability: snapshot.capability,
      version: snapshot.version,
      reason: 'judge-score-p50-below-threshold',
      observed: snapshot.judgeScoreP50,
      threshold: thresholds.judgeScoreP50Min,
    });
  }
  if (activeCost != null && activeCost > 0) {
    const ceiling = activeCost * thresholds.costMultiplierMax;
    if (snapshot.costPerInteractionUsd > ceiling) {
      out.push({
        capability: snapshot.capability,
        version: snapshot.version,
        reason: 'cost-per-interaction-above-threshold',
        observed: snapshot.costPerInteractionUsd,
        threshold: ceiling,
      });
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────

const FIVE_MINUTES_MS = 5 * 60 * 1000;

export function createSloTracker(deps: SloTrackerDeps = {}): SloTracker {
  const thresholds = deps.thresholds ?? DEFAULT_SLO_THRESHOLDS;
  const windowMs = deps.windowMs ?? FIVE_MINUTES_MS;
  const requiredConsecutive = deps.consecutiveBreachWindowsRequired ?? 2;
  const now = deps.now ?? (() => Date.now());
  const states = new Map<string, VersionState>();

  function get(capability: string, version: string): VersionState {
    const k = key(capability, version);
    let s = states.get(k);
    if (!s) {
      s = {
        capability,
        version,
        events: [],
        consecutiveBreachWindows: 0,
        lastEvaluatedWindowStartMs: -1,
      };
      states.set(k, s);
    }
    return s;
  }

  function currentWindow(at: number): { start: number; end: number } {
    const start = Math.floor(at / windowMs) * windowMs;
    return { start, end: start + windowMs };
  }

  return {
    record(event) {
      if (!event.capability || !event.version) return;
      const s = get(event.capability, event.version);
      s.events.push(event);
      // Trim — keep a generous buffer (10 windows) so we can evaluate
      // a few completed windows back without unbounded growth.
      const cutoff = now() - windowMs * 10;
      while (s.events.length > 0 && s.events[0]!.timestampMs < cutoff) {
        s.events.shift();
      }
    },

    snapshot(capability, version) {
      const s = states.get(key(capability, version));
      if (!s) return null;
      const w = currentWindow(now());
      return computeSnapshot(s, w.start, w.end);
    },

    evaluate(capability, version) {
      const s = states.get(key(capability, version));
      if (!s) return null;

      // We evaluate the most recent COMPLETED window — the current
      // window is still accumulating so a mid-window blip would
      // produce a flapping decision.
      const at = now();
      const w = currentWindow(at);
      const completedWindowStart = w.start - windowMs;
      const completedWindowEnd = w.start;

      // Idempotent within a window — record consecutive count once.
      if (s.lastEvaluatedWindowStartMs === completedWindowStart) {
        const snapshot = computeSnapshot(
          s,
          completedWindowStart,
          completedWindowEnd,
        );
        const activeCost = deps.activeCostResolver
          ? deps.activeCostResolver(capability)
          : null;
        const breaches = evaluateBreaches(snapshot, thresholds, activeCost);
        return {
          snapshot,
          breaches,
          consecutiveBreachWindows: s.consecutiveBreachWindows,
          shouldRollback: s.consecutiveBreachWindows >= requiredConsecutive,
        };
      }

      const snapshot = computeSnapshot(
        s,
        completedWindowStart,
        completedWindowEnd,
      );
      const activeCost = deps.activeCostResolver
        ? deps.activeCostResolver(capability)
        : null;
      const breaches = evaluateBreaches(snapshot, thresholds, activeCost);

      // Only count windows with at least one observation — an idle
      // window must not accumulate breach credit.
      if (snapshot.interactions === 0) {
        s.lastEvaluatedWindowStartMs = completedWindowStart;
        return {
          snapshot,
          breaches,
          consecutiveBreachWindows: s.consecutiveBreachWindows,
          shouldRollback: s.consecutiveBreachWindows >= requiredConsecutive,
        };
      }

      if (breaches.length > 0) {
        s.consecutiveBreachWindows += 1;
      } else {
        s.consecutiveBreachWindows = 0;
      }
      s.lastEvaluatedWindowStartMs = completedWindowStart;

      return {
        snapshot,
        breaches,
        consecutiveBreachWindows: s.consecutiveBreachWindows,
        shouldRollback: s.consecutiveBreachWindows >= requiredConsecutive,
      };
    },

    reset(capability, version) {
      if (!capability) {
        states.clear();
        return;
      }
      if (!version) {
        for (const k of Array.from(states.keys())) {
          if (k.startsWith(`${capability}::`)) states.delete(k);
        }
        return;
      }
      states.delete(key(capability, version));
    },
  };
}
