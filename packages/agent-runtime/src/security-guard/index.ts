/**
 * Agent-security-guard activation (SEC-G1).
 *
 * The `PermissionEngine` gates tool calls on allow/deny RULE LISTS only. It
 * does NOT enforce the runtime control-plane the OWASP "Top 10 for Agentic
 * Applications 2026" (ASI02 Tool Misuse / least-agency) demands:
 *
 *   - authority-tier ranking (a T1 agent may not invoke a T2 tool),
 *   - cross-tool composition bounds (recursion depth / sibling fan-out),
 *   - a confirmation gate for destructive / irreversible tools,
 *   - scanning tool RESULTS for indirect prompt-injection before the model
 *     re-ingests retrieved content (LLM01 / ASI).
 *
 * `@borjie/agent-security-guard` already implements exactly that matrix
 * (`createToolUseValidator`, `createIndirectInjectionDetector`). This module
 * ACTIVATES it: it is the thin adapter that turns the guard's
 * `ToolDecisionResult` into the runtime's `allow | deny | ask` decision and
 * the indirect detector into a result-redaction pass.
 *
 * Composition discipline:
 *   - The guard runs AFTER the permission rules and can only NARROW (deny /
 *     ask), never widen — so it composes safely with whatever the rule list
 *     already decided.
 *   - It is duck-typed behind `AgentSecurityGuard` so `agent-runtime` does
 *     NOT take a hard dependency on the guard package's concrete classes;
 *     `createAgentSecurityGuard(...)` builds the default wiring, but callers
 *     may inject any conforming object (test doubles, alt detectors).
 *   - Fail-closed: any error inside the guard yields a `deny`, never a
 *     silent allow. A null guard (the default) preserves today's behaviour.
 *
 * No `process.env` reads here (leaf package) — the ON/OFF flag + the
 * destructive-tool set are passed in at composition.
 */

import {
  createToolUseValidator,
  createIndirectInjectionDetector,
  createInMemoryToolRegistry,
  z,
  type AuthorityTier,
  type ToolDefinition,
  type ToolRegistry,
  type ToolUseViolation,
} from '@borjie/agent-security-guard';
import type { PermissionDecision, RuntimeLogger } from '../types.js';
import { noopLogger } from '../types.js';

/** Per-call attempt the guard evaluates, beyond the bare tool name + args. */
export interface GuardToolCall {
  readonly toolName: string;
  readonly args: Readonly<Record<string, unknown>>;
  /** Authority tier of the calling agent. Defaults to T0 (read-only). */
  readonly callerTier?: AuthorityTier;
  /** Whether the runtime already collected explicit human confirmation. */
  readonly confirmed?: boolean;
  /** Depth of this call in the tool-call tree (root = 0). */
  readonly callDepth?: number;
  /** Number of sibling calls already issued at this depth. */
  readonly siblingsAtThisDepth?: number;
  readonly tenantId: string;
  /** Agent identity for the violation record (e.g. sub-agent name). */
  readonly agentKind: string;
}

/** Result of a guard tool-call check. */
export interface GuardDecision {
  readonly decision: PermissionDecision;
  readonly rationale: string;
  /** Present when the guard recorded a violation (deny / ask). */
  readonly violation: ToolUseViolation | null;
}

/** Result of scanning a content-returning tool's output. */
export interface GuardScanResult {
  readonly detected: boolean;
  readonly redacted: string;
  readonly highestSeverity: string | null;
}

/** The port the runtime consumes. Duck-typed; inject any conforming object. */
export interface AgentSecurityGuard {
  /** Evaluate a tool call against the authority / recursion / confirmation matrix. */
  readonly checkToolCall: (call: GuardToolCall) => GuardDecision;
  /** Scan a content-returning tool result for indirect prompt-injection. */
  readonly scanToolResult: (input: { source: string; text: string }) => GuardScanResult;
  /** True iff `toolName` is one whose free-text output should be scanned. */
  readonly shouldScanResult: (toolName: string) => boolean;
}

/** Spec of a tool the guard knows about, for the authority/confirmation matrix. */
export interface GuardToolSpec {
  readonly name: string;
  readonly requiredTier: AuthorityTier;
  readonly requiresConfirmation: boolean;
}

export interface CreateAgentSecurityGuardOptions {
  /**
   * Known tools + their required tier / confirmation flag. Tools NOT in this
   * list are treated as `unknown_tool` by the validator → denied (fail-closed
   * least-agency). Pass every tool the agent may call.
   */
  readonly tools: ReadonlyArray<GuardToolSpec>;
  /** Max tool-call recursion depth (default 4 per the guard). */
  readonly maxDepth?: number;
  /** Max sibling fan-out at a depth (default 6 per the guard). */
  readonly maxWidth?: number;
  /**
   * Tool names whose free-text output should be scanned for indirect
   * injection (retrieval / corpus / browser / file-ingest tools). Structured
   * tools are excluded to avoid corrupting JSON payloads. Default: empty.
   */
  readonly contentReturningTools?: ReadonlyArray<string>;
  /**
   * Sink for recorded violations — wire a Drizzle repo in composition to
   * persist the hash-chained `ToolUseViolation`. Fire-and-forget; a sink
   * failure NEVER blocks the gate (logged as a warn). Default: no-op.
   */
  readonly onViolation?: (v: ToolUseViolation) => void;
  readonly logger?: RuntimeLogger;
}

/**
 * Build the default agent-security-guard wiring. The argument schema is
 * permissive (`z.record(z.unknown())`) because the runtime validates concrete
 * tool args elsewhere — here we only need the authority / recursion /
 * confirmation matrix, not a re-validation of every field.
 */
export function createAgentSecurityGuard(
  opts: CreateAgentSecurityGuardOptions,
): AgentSecurityGuard {
  const logger = opts.logger ?? noopLogger;
  const permissiveArgs = z.record(z.unknown());

  const toolDefs: ToolDefinition[] = opts.tools.map((t) => ({
    name: t.name,
    description: t.name,
    requiredTier: t.requiredTier,
    argsSchema: permissiveArgs,
    requiresConfirmation: t.requiresConfirmation,
  }));
  const registry: ToolRegistry = createInMemoryToolRegistry(toolDefs);

  const validator = createToolUseValidator({
    registry,
    ...(opts.maxDepth !== undefined ? { maxDepth: opts.maxDepth } : {}),
    ...(opts.maxWidth !== undefined ? { maxWidth: opts.maxWidth } : {}),
  });
  const injectionDetector = createIndirectInjectionDetector();

  const contentTools = new Set(opts.contentReturningTools ?? []);

  function recordViolation(v: ToolUseViolation): void {
    if (!opts.onViolation) return;
    try {
      opts.onViolation(v);
    } catch (err) {
      logger.log('warn', 'agent-security-guard: violation sink failed', {
        error: err instanceof Error ? err.message : String(err),
        toolName: v.toolName,
      });
    }
  }

  function checkToolCall(call: GuardToolCall): GuardDecision {
    try {
      const result = validator.validate({
        tenantId: call.tenantId,
        agentKind: call.agentKind,
        toolName: call.toolName,
        args: call.args,
        callerTier: call.callerTier ?? 'T0',
        confirmed: call.confirmed ?? false,
        callDepth: call.callDepth ?? 0,
        siblingsAtThisDepth: call.siblingsAtThisDepth ?? 0,
      });
      if (result.violation) recordViolation(result.violation);
      // Map the guard's decision onto the runtime's. `reject` → deny;
      // `require-confirmation` → ask; `allow` → allow.
      const decision: PermissionDecision =
        result.decision === 'reject'
          ? 'deny'
          : result.decision === 'require-confirmation'
            ? 'ask'
            : 'allow';
      return Object.freeze({
        decision,
        rationale: result.rationale,
        violation: result.violation,
      });
    } catch (err) {
      // Fail-closed: a guard error is a deny, never a silent allow.
      logger.log('error', 'agent-security-guard: validate threw — failing closed', {
        error: err instanceof Error ? err.message : String(err),
        toolName: call.toolName,
      });
      return Object.freeze({
        decision: 'deny' as const,
        rationale: 'security-guard error (fail-closed)',
        violation: null,
      });
    }
  }

  function scanToolResult(input: { source: string; text: string }): GuardScanResult {
    try {
      const r = injectionDetector.scan({ source: input.source, text: input.text });
      return Object.freeze({
        detected: r.detected,
        redacted: r.redactedInput,
        highestSeverity: r.highestSeverity,
      });
    } catch (err) {
      logger.log('warn', 'agent-security-guard: scan threw — passing text through', {
        error: err instanceof Error ? err.message : String(err),
        source: input.source,
      });
      // A scanner failure must not corrupt the result — pass it through.
      return Object.freeze({
        detected: false,
        redacted: input.text,
        highestSeverity: null,
      });
    }
  }

  function shouldScanResult(toolName: string): boolean {
    return contentTools.has(toolName);
  }

  return Object.freeze({ checkToolCall, scanToolResult, shouldScanResult });
}
