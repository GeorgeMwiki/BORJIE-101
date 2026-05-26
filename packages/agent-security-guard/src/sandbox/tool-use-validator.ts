/**
 * Tool-use sandbox validator (LLM06).
 *
 * Per SEC-4 spec §8:
 *   1. Validate the tool name exists in `capability-catalogue` (port).
 *   2. Validate the caller's authority tier matches the tool's required tier.
 *   3. Validate arguments via the tool's zod schema (strict-mode for objects).
 *   4. T2 destructive defaults to `require-confirmation`; runtime must
 *      collect human acknowledgement before executing.
 *   5. Recursive tool calls bounded to depth=4, width=6.
 */
import { sanitizeToolArgs } from './argument-sanitizer.js';
import { rowHash } from '../audit/hash-chain.js';
import type { ToolRegistry } from './tool-registry.js';
import type {
  AuthorityTier,
  ToolDecisionResult,
  ToolUseViolation,
  ToolViolationKind,
} from '../types.js';

export interface ToolCallAttempt {
  readonly tenantId: string;
  readonly agentKind: string;
  readonly toolName: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly callerTier: AuthorityTier;
  /** Runtime asserts user explicitly confirmed for T2 / destructive tools. */
  readonly confirmed: boolean;
  readonly callDepth: number;
  readonly siblingsAtThisDepth: number;
}

export interface ToolUseValidatorDeps {
  readonly registry: ToolRegistry;
  readonly maxDepth?: number;
  readonly maxWidth?: number;
}

const DEFAULT_MAX_DEPTH = 4;
const DEFAULT_MAX_WIDTH = 6;

const TIER_RANK: Readonly<Record<AuthorityTier, number>> = Object.freeze({
  T0: 0,
  T1: 1,
  T2: 2,
});

function makeViolation(input: {
  readonly tenantId: string;
  readonly agentKind: string;
  readonly toolName: string;
  readonly args: Readonly<Record<string, unknown>>;
  readonly kind: ToolViolationKind;
  readonly nowIso: string;
}): ToolUseViolation {
  const auditHash = rowHash({
    tenantId: input.tenantId,
    agentKind: input.agentKind,
    toolName: input.toolName,
    kind: input.kind,
    occurredAt: input.nowIso,
  });
  return Object.freeze({
    id: `violation-${auditHash.slice(0, 16)}`,
    tenantId: input.tenantId,
    agentKind: input.agentKind,
    toolName: input.toolName,
    attemptedArgs: Object.freeze({ ...input.args }),
    violationKind: input.kind,
    blocked: true,
    occurredAt: input.nowIso,
    auditHash,
  });
}

export interface ToolUseValidator {
  readonly validate: (attempt: ToolCallAttempt) => ToolDecisionResult;
}

export function createToolUseValidator(
  deps: ToolUseValidatorDeps,
): ToolUseValidator {
  const maxDepth = deps.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxWidth = deps.maxWidth ?? DEFAULT_MAX_WIDTH;

  function validate(attempt: ToolCallAttempt): ToolDecisionResult {
    const nowIso = new Date().toISOString();

    // (5) Recursion / fan-out limits — checked first because they cap
    //     every branch even when the tool itself is well-defined.
    if (attempt.callDepth > maxDepth) {
      return Object.freeze({
        decision: 'reject',
        violation: makeViolation({
          tenantId: attempt.tenantId,
          agentKind: attempt.agentKind,
          toolName: attempt.toolName,
          args: attempt.args,
          kind: 'recursion_limit',
          nowIso,
        }),
        rationale: `Tool-call depth ${attempt.callDepth} exceeds max ${maxDepth}.`,
      });
    }
    if (attempt.siblingsAtThisDepth > maxWidth) {
      return Object.freeze({
        decision: 'reject',
        violation: makeViolation({
          tenantId: attempt.tenantId,
          agentKind: attempt.agentKind,
          toolName: attempt.toolName,
          args: attempt.args,
          kind: 'recursion_limit',
          nowIso,
        }),
        rationale: `Tool-call width ${attempt.siblingsAtThisDepth} exceeds max ${maxWidth}.`,
      });
    }

    // (1) Tool registered
    const def = deps.registry.get(attempt.toolName);
    if (def === undefined) {
      return Object.freeze({
        decision: 'reject',
        violation: makeViolation({
          tenantId: attempt.tenantId,
          agentKind: attempt.agentKind,
          toolName: attempt.toolName,
          args: attempt.args,
          kind: 'unknown_tool',
          nowIso,
        }),
        rationale: `Unknown tool '${attempt.toolName}' — not in capability-catalogue.`,
      });
    }

    // (2) Authority tier check — caller must be at-or-above required.
    if (TIER_RANK[attempt.callerTier] < TIER_RANK[def.requiredTier]) {
      return Object.freeze({
        decision: 'reject',
        violation: makeViolation({
          tenantId: attempt.tenantId,
          agentKind: attempt.agentKind,
          toolName: attempt.toolName,
          args: attempt.args,
          kind: 'authority_escalation',
          nowIso,
        }),
        rationale: `Authority tier ${attempt.callerTier} cannot invoke ${def.requiredTier} tool '${def.name}'.`,
      });
    }

    // (3) Zod schema check
    const sanitised = sanitizeToolArgs(def.argsSchema, attempt.args);
    if (!sanitised.ok) {
      return Object.freeze({
        decision: 'reject',
        violation: makeViolation({
          tenantId: attempt.tenantId,
          agentKind: attempt.agentKind,
          toolName: attempt.toolName,
          args: attempt.args,
          kind: 'schema_violation',
          nowIso,
        }),
        rationale: `Argument schema violation: ${sanitised.errors
          .slice(0, 3)
          .map((e) => `${e.path.join('.')}: ${e.message}`)
          .join('; ')}`,
      });
    }

    // (4) Confirmation gate for T2 / destructive
    if (def.requiresConfirmation && !attempt.confirmed) {
      return Object.freeze({
        decision: 'require-confirmation',
        violation: makeViolation({
          tenantId: attempt.tenantId,
          agentKind: attempt.agentKind,
          toolName: attempt.toolName,
          args: attempt.args,
          kind: 'missing_confirmation',
          nowIso,
        }),
        rationale: `Tool '${def.name}' requires explicit user confirmation.`,
      });
    }

    return Object.freeze({
      decision: 'allow',
      violation: null,
      rationale: `Tool '${def.name}' authorised for tier ${attempt.callerTier}.`,
    });
  }

  return Object.freeze({ validate });
}
