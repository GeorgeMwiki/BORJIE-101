/**
 * Central Command panel barrel.
 *
 * Re-exports the shared dashboard components so pages and tests have a
 * single import surface.
 */

export { BrainStateCard } from "./BrainStateCard";
export { OutcomesPanel } from "./OutcomesPanel";
export { PendingApprovalsTable } from "./PendingApprovalsTable";
export { ActiveActionsTable } from "./ActiveActionsTable";
export { SkillProposalsTable } from "./SkillProposalsTable";
export { DriftSignalsCard } from "./DriftSignalsCard";
export { RecentThoughtsList } from "./RecentThoughtsList";
export type {
  ArousalMode,
  BrainStateSnapshot,
  KillswitchLevel,
  OutcomeCounts,
  PendingApproval,
  ActiveAutonomousAction,
  SkillProposal,
  DriftSignal,
  RecentThought,
} from "./types";
