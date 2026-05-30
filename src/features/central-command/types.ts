/**
 * Central Command shared types.
 *
 * The central-command surface aggregates state from many subsystems
 * (LC, DA, BG, cerebellum, killswitch, outbox, skill proposals, drift
 * detectors). These shapes are the read-only views the dashboard panels
 * consume. They intentionally over-document fields with `readonly` so the
 * UI never accidentally mutates returned state.
 */

export type ArousalMode = "exploit" | "explore" | "hyperalert";

export type KillswitchLevel = "off" | "throttle" | "suspend" | "halt";

export interface BrainStateSnapshot {
  readonly lc: {
    readonly mode: ArousalMode;
    readonly arousalLevel: number;
    readonly lastTransitionAt: string;
  };
  readonly da: {
    readonly arousalLevel: number;
    readonly rpeMean: number;
    readonly rpeSkew: number;
  };
  readonly dualProcessGate: {
    readonly last24hCalls: number;
    readonly system1Pct: number;
    readonly system2Pct: number;
  };
  readonly basalGanglia: {
    readonly suppressionsLast24h: number;
    readonly approvalsLast24h: number;
  };
  readonly cerebellum: {
    readonly meanError: number;
    readonly weightUpdatesLast24h: number;
  };
  readonly killswitch: {
    readonly level: KillswitchLevel;
    readonly scope: string;
    readonly reason: string | null;
    readonly engagedAt: string | null;
  };
}

export interface OutcomeCounts {
  readonly approve: number;
  readonly reject: number;
  readonly cancel: number;
  readonly refund: number;
  readonly brainCalls: number;
  readonly operatorOverrides: number;
}

export interface PendingApproval {
  readonly id: string;
  readonly actionType: string;
  readonly initiatorId: string;
  readonly rationale: string;
  readonly createdAt: string;
  readonly ageMinutes: number;
}

export interface ActiveAutonomousAction {
  readonly id: string;
  readonly actionType: string;
  readonly tenantId: string | null;
  readonly startedAt: string;
  readonly autonomyLevel: "act-autonomous" | "propose-only" | "shadow";
  readonly status: "running" | "settling" | "rolling-back";
}

export interface SkillProposal {
  readonly id: string;
  readonly skillName: string;
  readonly authorId: string;
  readonly submittedAt: string;
  readonly status: "pending" | "approved" | "rejected";
  readonly summary: string;
}

export interface DriftSignal {
  readonly source: "drift-detector" | "persona-drift" | "alignment-faking";
  readonly severity: "low" | "medium" | "high" | "critical";
  readonly value: number;
  readonly threshold: number;
  readonly observedAt: string;
  readonly note: string;
}

export interface RecentThought {
  readonly id: string;
  readonly summary: string;
  readonly salience: number;
  readonly module: string;
  readonly emittedAt: string;
}
