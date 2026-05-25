/**
 * Power-Tools — barrel.
 *
 * The power-tools layer sits BETWEEN regular HQ tools (deterministic
 * domain actions) and sovereign-write actions (mutations behind the
 * four-eye gate). Power tools are agent meta-capabilities the kernel
 * uses to manage its OWN workflow: escalate to a higher tier, chain
 * sub-MD calls transactionally, schedule a deferred call, run a JS
 * snippet in a sandbox, ask for an anonymised cross-tenant aggregate,
 * rewrite the persona's own prompt (Reflexion), or stream a progress
 * event to a shared blackboard channel.
 *
 * Composition root (api-gateway) binds each tool's adapter and
 * registers them on a single `PowerToolRegistry`. The orchestrator
 * looks up `power_tool.<id>` calls against the registry the same way
 * it does for HQ-tier tools.
 *
 * @module kernel/power-tools
 */

export * from './types.js';
export {
  createPowerToolRegistry,
  createInMemoryPowerToolAuditSink,
  type InMemoryPowerToolAuditSink,
  type PowerToolRegistry,
} from './registry.js';

// Individual tools — each exports the spec / factory + Zod schema +
// args / output / adapter types.
export {
  handoffPowerTool,
  HandoffSchema,
  type HandoffArgs,
  type HandoffOutput,
} from './handoff.js';
export {
  createSandboxPowerTool,
  SandboxSchema,
  type JsSandboxAdapter,
  type JsSandboxRunOutcome,
  type SandboxArgs,
  type SandboxOutput,
  type SandboxPolicyRunner,
} from './sandbox.js';
export {
  createSchedulePowerTool,
  createInMemoryScheduleAdapter,
  ScheduleSchema,
  type ScheduleAdapter,
  type ScheduledCallRecord,
  type InMemoryScheduleAdapter,
  type ScheduleArgs,
  type ScheduleOutput,
} from './schedule.js';
export {
  createCrossTenantPowerTool,
  CrossTenantSchema,
  type CrossTenantAggregateAdapter,
  type CrossTenantAggregateOutcome,
  type CrossTenantArgs,
  type CrossTenantMetric,
  type CrossTenantOutput,
  type CrossTenantStats,
  type CrossTenantCohortInput,
} from './cross-tenant.js';
export {
  createComposePowerTool,
  ComposeSchema,
  type ComposeArgs,
  type ComposeOutput,
  type ComposeStep,
  type ComposeStepOutcome,
  type ComposeStepStatus,
} from './compose.js';
export {
  createSelfModificationPowerTool,
  createInMemoryAnchorSummaryAdapter,
  SelfModificationSchema,
  type AnchorSummaryAdapter,
  type AnchorSummaryRecord,
  type InMemoryAnchorSummaryAdapter,
  type SelfModificationArgs,
  type SelfModificationKind,
  type SelfModificationOutput,
} from './self-modification.js';
export {
  createBlackboardStreamPowerTool,
  createInMemoryBlackboardPublisher,
  __resetBlackboardSeqForTests,
  BlackboardStreamSchema,
  type BlackboardEvent,
  type BlackboardEventKind,
  type BlackboardPublisher,
  type BlackboardStreamArgs,
  type BlackboardStreamOutput,
  type InMemoryBlackboardPublisher,
} from './blackboard-stream.js';
