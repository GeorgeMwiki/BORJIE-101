/**
 * Server-side aggregator for central-command panels.
 *
 * Until each subsystem exposes a stable read API, this module returns
 * a calibrated empty/placeholder snapshot. Replace each helper as the
 * corresponding subsystem (drift-detector, outbox, skill-proposals,
 * autonomy registry) ships its query layer.
 *
 * The helpers are deliberately I/O-free so they can be called from a
 * Server Component during SSR without setting up DB clients first.
 */

import type {
  ActiveAutonomousAction,
  BrainStateSnapshot,
  DriftSignal,
  OutcomeCounts,
  PendingApproval,
  RecentThought,
  SkillProposal,
} from "./types";

export interface CentralCommandSnapshot {
  readonly brainState: BrainStateSnapshot;
  readonly outcomes: OutcomeCounts;
  readonly approvals: ReadonlyArray<PendingApproval>;
  readonly activeActions: ReadonlyArray<ActiveAutonomousAction>;
  readonly skillProposals: ReadonlyArray<SkillProposal>;
  readonly driftSignals: ReadonlyArray<DriftSignal>;
  readonly recentThoughts: ReadonlyArray<RecentThought>;
  readonly generatedAt: string;
}

export function buildPlaceholderSnapshot(now: Date): CentralCommandSnapshot {
  const iso = now.toISOString();
  return {
    brainState: {
      lc: {
        mode: "exploit",
        arousalLevel: 0.42,
        lastTransitionAt: iso,
      },
      da: {
        arousalLevel: 0.51,
        rpeMean: 0.018,
        rpeSkew: -0.04,
      },
      dualProcessGate: {
        last24hCalls: 0,
        system1Pct: 0,
        system2Pct: 0,
      },
      basalGanglia: {
        suppressionsLast24h: 0,
        approvalsLast24h: 0,
      },
      cerebellum: {
        meanError: 0,
        weightUpdatesLast24h: 0,
      },
      killswitch: {
        level: "off",
        scope: "platform",
        reason: null,
        engagedAt: null,
      },
    },
    outcomes: {
      approve: 0,
      reject: 0,
      cancel: 0,
      refund: 0,
      brainCalls: 0,
      operatorOverrides: 0,
    },
    approvals: [],
    activeActions: [],
    skillProposals: [],
    driftSignals: [],
    recentThoughts: [],
    generatedAt: iso,
  };
}
