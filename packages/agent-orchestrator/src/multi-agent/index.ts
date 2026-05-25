/**
 * Multi-agent patterns barrel.
 */

export {
  createSwarm,
  DEFAULT_SWARM_MAX_TURNS,
  type CreateSwarmInput,
  type HandoffPredicate,
  type HandoffRule,
  type SwarmRuntime,
} from './swarm.js';

export {
  createGroupChat,
  DEFAULT_TERMINATOR,
  type CreateGroupChatInput,
  type GroupChatMode,
  type GroupChatRuntime,
} from './group-chat.js';

export {
  createCrewWorkflow,
  type CreateCrewInput,
  type CrewProcess,
  type CrewRuntime,
  type CrewTask,
  type CrewTaskResult,
} from './crew.js';

export {
  createSupervisorTeam,
  DEFAULT_SUPERVISOR_MAX_SUBTASKS,
  type CreateSupervisorTeamInput,
  type HandoffPolicy,
  type SupervisorPlan,
  type TeamRuntime,
} from './supervisor.js';
