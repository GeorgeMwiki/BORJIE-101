/**
 * Escalations tab — public UI barrel.
 *
 * @module features/central-command/md/escalations/ui
 */

export { default as EscalationsTabContent } from "./EscalationsTabContent";
export type { EscalationsTabContentProps } from "./EscalationsTabContent";

export {
  acknowledgeEscalation,
  fetchOpenEscalations,
  resolveEscalation,
  EscalationsRequestError,
  miningEscalationRowSchema,
  ESCALATION_SEVERITIES,
  ESCALATION_STATUSES,
  type MiningEscalationRow,
  type EscalationSeverity,
  type EscalationStatus,
} from "./escalations-client";

export {
  escalationsCopy,
  type EscalationsLocale,
  type EscalationsCopy,
} from "./escalations-copy";
