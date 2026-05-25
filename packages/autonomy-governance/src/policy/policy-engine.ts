/**
 * Policy Engine — pure-function YAML-driven tool/network/DB allowlist
 * evaluator. The YAML ruleset is the single source of truth for what an
 * AI agent acting under a given role is permitted to do.
 *
 * Ported (and tightened) from LITFIN
 * `src/core/security/policy-engine.ts` + `policy-worker.ts`. Worker-thread
 * isolation is intentionally deferred to a follow-up wave — this round
 * ships only the pure `evaluate(action, context, ruleset) → Decision`
 * surface so the kernel can wire policy checks before any tool dispatch.
 *
 * Architecture:
 *   - Deny-by-default. Anything not on the allowlist is denied.
 *   - Explicit deny patterns take precedence over allow patterns.
 *   - Trailing-wildcard match: `"admin-*"` matches `"admin-delete"`.
 *   - Human-approval list returns an `escalate` decision (gate to 4-eye
 *     or destructive-action engine; this module emits, does not handle).
 *   - DB table + network-egress allowlists apply when the action carries
 *     a `targetTable` or `targetHost` field respectively.
 *   - Frozen parsed rulesets via `Object.freeze` deep so callers cannot
 *     mutate policy in flight.
 *
 * Wire-agnostic: this module reads YAML text + the action/context shape
 * and returns a decision. Loading YAML from disk is the caller's
 * concern. A convenience `loadPolicyFromFile(path)` is offered for tests
 * and Node-side callers.
 *
 * Research: `.audit/litfin-sota-2026-05-23/03-security-governance.md`
 * (SC-08 Tool Sandbox + Agent Sandbox + Policy Engine).
 */

import { readFileSync } from 'fs';
import { load as yamlLoad } from 'js-yaml';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Policy decision verdict. */
export type PolicyDecision = 'allow' | 'deny' | 'escalate';

/** Action sensitivity tier. */
export type SensitivityLevel = 'low' | 'medium' | 'high';

/** Action reversibility tier. */
export type ReversibilityLevel = 'reversible' | 'irreversible';

/** Action scope tier. */
export type ScopeLevel = 'individual' | 'organization' | 'system';

/** Compliance tag a tool may carry. */
export type ComplianceTag = 'pii' | 'financial' | 'regulated';

/** Resolved classification for an action after policy match. */
export interface ActionClassification {
  readonly sensitivity: SensitivityLevel;
  readonly reversibility: ReversibilityLevel;
  readonly scope: ScopeLevel;
  readonly complianceTags: ReadonlyArray<ComplianceTag>;
}

/** Per-policy audit configuration. */
export interface AuditConfig {
  readonly enabled: boolean;
  readonly hashChain: boolean;
  readonly retentionYears: number;
}

/**
 * Proposed action the agent wants to take. The kernel-side adapter
 * fills this from the in-flight tool call.
 *
 *   - `toolName` — required, the canonical tool identifier
 *   - `targetTable` — optional, when the tool reads/writes a DB row
 *   - `targetHost` — optional, when the tool performs an outbound HTTP call
 *   - `agentRole` — optional, free-text role of the agent (audit hint)
 *   - `requestId` — optional, correlation id propagated into the decision
 */
export interface ProposedAction {
  readonly toolName: string;
  readonly targetTable?: string;
  readonly targetHost?: string;
  readonly agentRole?: string;
  readonly requestId?: string;
}

/**
 * Optional evaluation context. The pure evaluator currently uses only
 * `requestId` (for correlation), but the shape is reserved for future
 * context-aware checks (e.g. time-of-day, autonomy stage, killswitch).
 */
export interface EvaluationContext {
  readonly requestId?: string;
}

/** Decision returned by the engine. Frozen. */
export interface PolicyDecisionResponse {
  readonly requestId: string;
  readonly decision: PolicyDecision;
  readonly reason: string;
  readonly classification: ActionClassification;
  readonly requiresHumanApproval: boolean;
  readonly matchedRule: string;
}

/**
 * Parsed + frozen YAML ruleset. The discriminated readonly shape exists
 * so callers can pass a single ruleset across many evaluations without
 * re-parsing.
 */
export interface PolicyRuleset {
  readonly version: string;
  readonly description: string;
  readonly allowedTools: ReadonlyArray<string>;
  readonly deniedTools: ReadonlyArray<string>;
  readonly allowedDbTables: ReadonlyArray<string>;
  readonly deniedDbTables: ReadonlyArray<string>;
  readonly networkEgress: ReadonlyArray<string>;
  readonly humanApproval: ReadonlyArray<string>;
  readonly audit: AuditConfig;
  readonly actionClassification: Readonly<{
    readonly sensitivity: Readonly<Record<string, ReadonlyArray<string>>>;
    readonly reversibility: Readonly<Record<string, ReadonlyArray<string>>>;
    readonly scope: Readonly<Record<string, ReadonlyArray<string>>>;
    readonly compliance: Readonly<Record<string, ReadonlyArray<string>>>;
  }>;
}

// ---------------------------------------------------------------------------
// Pattern matching (supports trailing wildcard: "admin-*", "delete-*")
// ---------------------------------------------------------------------------

/**
 * Trailing-wildcard pattern match.
 *
 *   matchesPattern("admin-*", "admin-delete") === true
 *   matchesPattern("admin-*", "user-delete")  === false
 *   matchesPattern("foo", "foo")              === true
 */
export function matchesPattern(pattern: string, value: string): boolean {
  if (pattern === value) return true;
  if (pattern.endsWith('*')) {
    const prefix = pattern.slice(0, -1);
    return value.startsWith(prefix);
  }
  return false;
}

function anyPatternMatches(
  patterns: ReadonlyArray<string>,
  value: string,
): boolean {
  return patterns.some((p) => matchesPattern(p, value));
}

// ---------------------------------------------------------------------------
// Classification helpers
// ---------------------------------------------------------------------------

function classifySensitivity(
  toolName: string,
  classification: PolicyRuleset['actionClassification'],
): SensitivityLevel {
  const sens = classification.sensitivity;
  if (sens.high && anyPatternMatches(sens.high, toolName)) return 'high';
  if (sens.medium && anyPatternMatches(sens.medium, toolName)) return 'medium';
  return 'low';
}

function classifyReversibility(
  toolName: string,
  classification: PolicyRuleset['actionClassification'],
): ReversibilityLevel {
  const rev = classification.reversibility;
  if (rev.irreversible && anyPatternMatches(rev.irreversible, toolName)) {
    return 'irreversible';
  }
  return 'reversible';
}

function classifyScope(
  toolName: string,
  classification: PolicyRuleset['actionClassification'],
): ScopeLevel {
  const sc = classification.scope;
  if (sc.system && anyPatternMatches(sc.system, toolName)) return 'system';
  if (sc.organization && anyPatternMatches(sc.organization, toolName)) {
    return 'organization';
  }
  return 'individual';
}

function classifyCompliance(
  toolName: string,
  classification: PolicyRuleset['actionClassification'],
): ReadonlyArray<ComplianceTag> {
  const tags: ComplianceTag[] = [];
  const comp = classification.compliance;
  if (comp.pii && anyPatternMatches(comp.pii, toolName)) tags.push('pii');
  if (comp.financial && anyPatternMatches(comp.financial, toolName)) {
    tags.push('financial');
  }
  if (comp.regulated && anyPatternMatches(comp.regulated, toolName)) {
    tags.push('regulated');
  }
  return tags;
}

// ---------------------------------------------------------------------------
// Core evaluation function — pure, no I/O
// ---------------------------------------------------------------------------

/**
 * Evaluate a proposed action against a ruleset. Pure function.
 *
 * Decision order (deny-by-default):
 *   1. Explicit deny pattern → `deny`.
 *   2. Not on allow list     → `deny`.
 *   3. DB table denied       → `deny`.
 *   4. DB table not allowed  → `deny`.
 *   5. Network host blocked  → `deny`.
 *   6. Human approval needed → `escalate`.
 *   7. Otherwise             → `allow`.
 *
 * The returned response is frozen.
 */
export function evaluate(
  action: ProposedAction,
  context: EvaluationContext,
  ruleset: PolicyRuleset,
): PolicyDecisionResponse {
  const { toolName, targetTable, targetHost } = action;
  const requestId =
    action.requestId ?? context.requestId ?? generateRequestId();

  const classification: ActionClassification = Object.freeze({
    sensitivity: classifySensitivity(toolName, ruleset.actionClassification),
    reversibility: classifyReversibility(
      toolName,
      ruleset.actionClassification,
    ),
    scope: classifyScope(toolName, ruleset.actionClassification),
    complianceTags: Object.freeze(
      classifyCompliance(toolName, ruleset.actionClassification),
    ),
  });

  const requiresHumanApproval = anyPatternMatches(
    ruleset.humanApproval,
    toolName,
  );

  // 1. Explicit deny check (deny list wins)
  if (anyPatternMatches(ruleset.deniedTools, toolName)) {
    return freezeResponse({
      requestId,
      decision: 'deny',
      reason: `Tool "${toolName}" matches denied pattern`,
      classification,
      requiresHumanApproval,
      matchedRule: 'deniedTools',
    });
  }

  // 2. Allow list check (deny-by-default)
  if (!anyPatternMatches(ruleset.allowedTools, toolName)) {
    return freezeResponse({
      requestId,
      decision: 'deny',
      reason: `Tool "${toolName}" is not in the allowed list (deny-by-default)`,
      classification,
      requiresHumanApproval,
      matchedRule: 'allowedTools:missing',
    });
  }

  // 3. DB table check (if a target table is specified)
  if (targetTable !== undefined) {
    if (anyPatternMatches(ruleset.deniedDbTables, targetTable)) {
      return freezeResponse({
        requestId,
        decision: 'deny',
        reason: `Table "${targetTable}" matches denied DB table pattern`,
        classification,
        requiresHumanApproval,
        matchedRule: 'deniedDbTables',
      });
    }
    if (!anyPatternMatches(ruleset.allowedDbTables, targetTable)) {
      return freezeResponse({
        requestId,
        decision: 'deny',
        reason: `Table "${targetTable}" is not in the allowed DB tables list`,
        classification,
        requiresHumanApproval,
        matchedRule: 'allowedDbTables:missing',
      });
    }
  }

  // 4. Network egress check (if a target host is specified)
  if (targetHost !== undefined) {
    if (!ruleset.networkEgress.includes(targetHost)) {
      return freezeResponse({
        requestId,
        decision: 'deny',
        reason: `Network egress to "${targetHost}" is not permitted`,
        classification,
        requiresHumanApproval,
        matchedRule: 'networkEgress:blocked',
      });
    }
  }

  // 5. Human approval escalation
  if (requiresHumanApproval) {
    return freezeResponse({
      requestId,
      decision: 'escalate',
      reason: `Tool "${toolName}" requires human approval before execution`,
      classification,
      requiresHumanApproval: true,
      matchedRule: 'humanApproval',
    });
  }

  // 6. Allowed
  return freezeResponse({
    requestId,
    decision: 'allow',
    reason: `Tool "${toolName}" is permitted by policy`,
    classification,
    requiresHumanApproval: false,
    matchedRule: 'allowedTools',
  });
}

function freezeResponse(
  resp: PolicyDecisionResponse,
): PolicyDecisionResponse {
  return Object.freeze(resp);
}

function generateRequestId(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  const ts = Date.now().toString(36);
  return `policy-${ts}-${rand}`;
}

// ---------------------------------------------------------------------------
// YAML parsing → frozen ruleset
// ---------------------------------------------------------------------------

function toStringArray(val: unknown): ReadonlyArray<string> {
  if (Array.isArray(val)) return Object.freeze(val.map(String));
  return Object.freeze([]);
}

function toAuditConfig(val: unknown): AuditConfig {
  if (val !== null && typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    return Object.freeze({
      enabled: obj.enabled === true,
      hashChain: obj.hashChain === true,
      retentionYears:
        typeof obj.retentionYears === 'number' ? obj.retentionYears : 7,
    });
  }
  return Object.freeze({ enabled: true, hashChain: true, retentionYears: 7 });
}

function toClassificationMap(
  val: unknown,
): Readonly<Record<string, ReadonlyArray<string>>> {
  if (val !== null && typeof val === 'object') {
    const result: Record<string, ReadonlyArray<string>> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      result[k] = toStringArray(v);
    }
    return Object.freeze(result);
  }
  return Object.freeze({});
}

function toActionClassification(
  val: unknown,
): PolicyRuleset['actionClassification'] {
  if (val !== null && typeof val === 'object') {
    const obj = val as Record<string, unknown>;
    return Object.freeze({
      sensitivity: toClassificationMap(obj.sensitivity),
      reversibility: toClassificationMap(obj.reversibility),
      scope: toClassificationMap(obj.scope),
      compliance: toClassificationMap(obj.compliance),
    });
  }
  return Object.freeze({
    sensitivity: Object.freeze({}),
    reversibility: Object.freeze({}),
    scope: Object.freeze({}),
    compliance: Object.freeze({}),
  });
}

/**
 * Parse YAML text into a deep-frozen `PolicyRuleset`. Uses `js-yaml`
 * `safeLoad` semantics (no code execution) under the hood.
 *
 * Throws if the YAML cannot be parsed at all. Missing top-level fields
 * default to empty arrays / sensible defaults — a malformed-but-parseable
 * policy collapses to deny-everything, which is the safe default.
 */
export function parsePolicyYaml(yamlText: string): PolicyRuleset {
  const raw = (yamlLoad(yamlText) ?? {}) as Record<string, unknown>;
  const doc: PolicyRuleset = {
    version: String(raw.version ?? '1.0'),
    description: String(raw.description ?? ''),
    allowedTools: toStringArray(raw.allowedTools),
    deniedTools: toStringArray(raw.deniedTools),
    allowedDbTables: toStringArray(raw.allowedDbTables),
    deniedDbTables: toStringArray(raw.deniedDbTables),
    networkEgress: toStringArray(raw.networkEgress),
    humanApproval: toStringArray(raw.humanApproval),
    audit: toAuditConfig(raw.audit),
    actionClassification: toActionClassification(raw.actionClassification),
  };
  return Object.freeze(doc);
}

/**
 * Convenience helper: read a YAML file from disk and return a frozen
 * ruleset. Node-side only (uses `fs`). Browser/edge callers should
 * bundle the YAML at build time and pass the string to `parsePolicyYaml`.
 */
export function loadPolicyFromFile(filePath: string): PolicyRuleset {
  // Caller-supplied filePath is intentional — this helper is Node-only
  // and exists precisely to read policy YAML from disk. Browser/edge
  // callers must bundle the YAML and call parsePolicyYaml directly.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const text = readFileSync(filePath, 'utf-8');
  return parsePolicyYaml(text);
}
