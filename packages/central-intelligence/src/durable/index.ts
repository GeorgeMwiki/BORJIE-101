/**
 * Durable-execution barrel — the public surface of the
 * `@borjie/central-intelligence` durable subsystem.
 *
 * Wires the Inngest-based wrapper around the legacy
 * `TaskAgentExecutor` (see `inngest-executor.ts`) and the multi-day
 * licence-suspension flow skeleton (see `functions/licence-suspension-flow.ts`).
 *
 * Feature-flag: `DURABLE_EXEC_ENABLED=true` (read at the composition
 * root). When unset the wrapper short-circuits and callers fall back to
 * the legacy sync executor — backward compatibility is preserved by
 * construction.
 *
 * Env vars:
 *   - `INNGEST_EVENT_KEY`     (producer)
 *   - `INNGEST_SIGNING_KEY`   (consumer / serve handler)
 *   - `DURABLE_EXEC_ENABLED`  (master kill-switch)
 */

export {
  createInngestComposition,
  createNoopInngestClient,
  createLocalDevInngestClient,
  INNGEST_LOCAL_DEV_URL,
  INNGEST_LOCAL_DEV_APP_ID,
  type DurableFunctionContext,
  type DurableFunctionDefinition,
  type DurableStepLike,
  type FetchLike,
  type InngestClientConfig,
  type InngestClientFactory,
  type InngestClientLike,
  type InngestComposition,
  type LocalDevInngestClientOpts,
} from './inngest-client.js';

export {
  createDurableTaskAgentExecutor,
  TASK_AGENT_RUN_EVENT,
  type DurableExecutorDeps,
  type DurableTaskAgentExecutor,
  type TaskAgentExecuteOptionsLike,
  type TaskAgentExecuteOutputLike,
  type TaskAgentExecutorLike,
  type TaskAgentRunRequestedEvent,
} from './inngest-executor.js';

export {
  registerLicenceSuspensionFlow,
  LICENCE_SUSPENSION_FLOW_STARTED_EVENT,
  type LicenceSuspensionFlowDeps,
  type LicenceSuspensionFlowServices,
  type LicenceSuspensionFlowStartedEvent,
} from './functions/licence-suspension-flow.js';
