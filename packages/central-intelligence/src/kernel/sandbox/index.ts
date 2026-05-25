/**
 * Sandbox barrel — public surface for the V8-isolate JS sandbox.
 *
 * Two entry points:
 *
 *   - `runInSandbox(code, context, options)`  — raw primitive. Use
 *     when the caller has already enforced its own policy.
 *   - `runInSandboxWithPolicy({ tier, code, ... })`  — tier-aware
 *     wrapper. Preferred for all kernel-internal callers.
 */

export { runInSandbox } from './js-sandbox.js';
export {
  runInSandboxWithPolicy,
  makeConsoleAuditAdapter,
  DEFAULT_TIER_CAPS,
  type SandboxTier,
  type TierCaps,
  type SandboxPolicyInput,
  type SandboxPolicyResult,
} from './sandbox-policy.js';
export {
  DEFAULT_MEMORY_MB,
  DEFAULT_TIMEOUT_MS,
  MAX_CODE_BYTES,
  MAX_MEMORY_MB,
  MAX_RESULT_ARRAY_LEN,
  MAX_RESULT_DEPTH,
  MAX_RESULT_KEYS_PER_OBJECT,
  MAX_TIMEOUT_MS,
  type SandboxAuditEvent,
  type SandboxAuditor,
  type SandboxBackend,
  type SandboxError,
  type SandboxErrorCode,
  type SandboxOptions,
  type SandboxResult,
} from './types.js';
