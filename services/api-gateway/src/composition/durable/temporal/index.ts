/**
 * temporal/index — barrel for Temporal workflow scaffolds.
 *
 * Phase B ships definitions only. Composition root imports the
 * `start*` dispatchers and binds them to HQ tools (`licence.suspend`,
 * `owner.payout`, `kra.mri.file`). Until Phase C boots a real
 * Temporal server, all dispatchers receive the `MockTemporalClient`.
 */

export {
  type TemporalClientLike,
  type TemporalRunHandle,
  type MockTemporalClient,
  type MockTemporalState,
  createMockTemporalClient,
  TEMPORAL_TASK_QUEUES,
  TEMPORAL_WORKFLOW_TYPES,
} from './temporal-client.js';

export {
  type LicenceSuspensionBreachKind,
  type LicenceSuspensionWorkflowInput,
  type LicenceSuspensionWorkflowResult,
  type LicenceSuspensionActivities,
  type LicenceSuspensionWorkflowDeps,
  type StartLicenceSuspensionWorkflowArgs,
  LICENCE_SUSPENSION_STATUTORY_DAYS,
  licenceSuspensionWorkflowBody,
  startLicenceSuspensionWorkflow,
  licenceSuspensionWorkflowId,
} from './licence-suspension-workflow.js';

export {
  type OwnerPayoutWorkflowInput,
  type OwnerPayoutWorkflowResult,
  type OwnerPayoutActivities,
  type OwnerPayoutWorkflowDeps,
  type StartOwnerPayoutWorkflowArgs,
  ownerPayoutWorkflowBody,
  startOwnerPayoutWorkflow,
  ownerPayoutWorkflowId,
} from './owner-payout-workflow.js';

export {
  type KraMriFilingWorkflowInput,
  type KraMriFilingWorkflowResult,
  type KraMriFilingActivities,
  type KraMriFilingWorkflowDeps,
  type StartKraMriFilingWorkflowArgs,
  kraMriFilingWorkflowBody,
  startKraMriFilingWorkflow,
  kraMriFilingWorkflowId,
} from './kra-mri-filing-workflow.js';
