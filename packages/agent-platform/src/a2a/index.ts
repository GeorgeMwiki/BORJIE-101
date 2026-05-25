/**
 * A2A (Agent-to-Agent) v1.0 — public barrel.
 *
 * Implementation of the Google / Linux Foundation A2A protocol v1.0.
 * Spec: https://google-a2a.github.io/A2A/
 */

export {
  buildAgentCard,
  serializeAgentCard,
  serializeAgentCardForSigning,
  deserializeAgentCard,
  type A2AAgentCard,
  type A2AAgentCardInput,
  type A2AAgentCapability,
  type A2AAgentSkill,
  type A2AAgentAuthentication,
  type A2AAgentEndpoints,
  type A2AAgentSignature,
} from './agent-card.js';

export {
  signAgentCard,
  verifyAgentCard,
  loadSigningKeyFromEnv,
  generateStubKey,
  type A2ASigningKey,
  type SignAgentCardDeps,
} from './agent-card-signer.js';

export {
  submitTask,
  getTask,
  cancelTask,
  markTaskWorking,
  completeTask,
  failTask,
  createInMemoryTaskStore,
  type A2ATask,
  type A2ATaskStatus,
  type A2ATaskMessage,
  type A2ATaskPart,
  type TaskStore,
  type LifecycleDeps,
  type SubmitTaskRequest,
} from './task-lifecycle.js';

export {
  serveAgentCard,
  serveAgentCardStatic,
  type WellKnownResponse,
  type WellKnownServerDeps,
} from './well-known-server.js';
