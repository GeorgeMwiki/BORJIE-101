/**
 * Module 2 — worktree-sandbox
 * git worktree (file isolation) + optional Daytona (process isolation).
 */

export * from './types.js';
export {
  createSandbox,
  AggregateCleanupError,
  defaultGitAdapter,
  type CreateSandboxDeps,
} from './create-sandbox.js';
export { withSandbox } from './with-sandbox.js';
