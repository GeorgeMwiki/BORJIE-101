/**
 * `@borjie/agent-security-guard` — public type surface (SEC-4).
 *
 * Companion to Docs/SECURITY/AI_AGENT_SECURITY_SOTA_2026.md. Every type
 * is `readonly` end-to-end (immutability rule). Scores live in `[0, 1]`
 * unless otherwise documented.
 *
 * Covers OWASP LLM Top 10 (2025 revision), MITRE ATLAS techniques, and
 * the NIST AI RMF (1.0) Govern/Map/Measure/Manage functions.
 */

// ---------------------------------------------------------------------------
// Channels + authority tiers
// ---------------------------------------------------------------------------

/**
 * Inbound + outbound channels the agent guard observes.
 * `mcp-out` is the outbound MCP tool surface; treated as half-trusted.
 * `ambient` is the always-listening voice surface (Wave 19J).
 * `ephemeral-sw` is the ephemeral-software-generation surface.
 */
export type AgentChannel =
  | 'chat'
  | 'voice'
  | 'ambient'
  | 'mcp-out'
  | 'ephemeral-sw'
  | 'tool-use'
  | 'fine-tune-ingest'
  | 'graph-rag-retrieval'
  | 'file-ingest';

/**
 * Authority tiers — see §8 of the SOTA spec.
 *   T0 — read-only, in-tenant
 *   T1 — mutate within own tenant
 *   T2 — cross-tenant or money / external commit
 */
export type AuthorityTier = 'T0' | 'T1' | 'T2';

export type Severity = 'low' | 'medium' | 'high' | 'critical';

// ---------------------------------------------------------------------------
// Prompt-injection attempts
// ---------------------------------------------------------------------------

/**
 * Canonical injection kinds we recognise. Used for grouping in
 * `prompt_injection_attempts.attack_kind`.
 */
export type InjectionKind =
  | 'ignore-previous-instructions'
  | 'role-play-override'
  | 'system-prompt-extraction'
  | 'code-execution-request'
  | 'base64-injection'
  | 'language-switch-attack'
  | 'mid-token-split'
  | 'markdown-image-exfil-request'
  | 'indirect-html-comment'
  | 'indirect-hidden-css'
  | 'indirect-zero-width'
  | 'indirect-retrieved-doc'
  | 'jailbreak-many-shot'
  | 'jailbreak-dan'
  | 'jailbreak-gcg-suffix'
  | 'pii-fishing'
  | 'credential-extraction'
  | 'env-dump-request'
  | 'cross-tenant-fishing';

export interface PromptInjectionAttempt {
  readonly id: string;
  readonly tenantId: string;
  readonly userId: string | null;
  readonly channel: AgentChannel;
  readonly rawInput: string;
  readonly redactedInput: string;
  readonly attackKind: InjectionKind;
  readonly severity: Severity;
  readonly blocked: boolean;
  readonly detectedAt: string;
  readonly auditHash: string;
  readonly prevHash: string;
}

// ---------------------------------------------------------------------------
// Tool-use violations
// ---------------------------------------------------------------------------

export type ToolViolationKind =
  | 'authority_escalation'
  | 'unknown_tool'
  | 'schema_violation'
  | 'missing_confirmation'
  | 'recursion_limit'
  | 'cross_tenant'
  | 'rate_limit';

export interface ToolUseViolation {
  readonly id: string;
  readonly tenantId: string;
  readonly agentKind: string;
  readonly toolName: string;
  readonly attemptedArgs: Readonly<Record<string, unknown>>;
  readonly violationKind: ToolViolationKind;
  readonly blocked: boolean;
  readonly occurredAt: string;
  readonly auditHash: string;
}

// ---------------------------------------------------------------------------
// Tool-use decisions
// ---------------------------------------------------------------------------

/**
 * `require-confirmation` means: the runtime must collect explicit human
 * acknowledgment (T2 destructive default) before executing.
 */
export type ToolDecision = 'allow' | 'reject' | 'require-confirmation';

export interface ToolDecisionResult {
  readonly decision: ToolDecision;
  readonly violation: ToolUseViolation | null;
  readonly rationale: string;
}

// ---------------------------------------------------------------------------
// Output filter
// ---------------------------------------------------------------------------

/**
 * The rules the output filter can apply. Each rule has a canonical
 * remediation in the filter implementation.
 */
export type OutputFilterRule =
  | 'markdown-image-suspicious-domain'
  | 'pii-redact'
  | 'system-prompt-leak'
  | 'code-execution-attempt'
  | 'js-injection-tag'
  | 'cross-tenant-id-leak';

export interface OutputFilterBlock {
  readonly id: string;
  readonly tenantId: string;
  readonly channel: AgentChannel;
  readonly outputExcerpt: string;
  readonly filterRule: OutputFilterRule;
  readonly blockedAt: string;
  readonly auditHash: string;
}

export interface OutputFilterResult {
  readonly cleaned: string;
  readonly blocks: ReadonlyArray<OutputFilterBlock>;
}

// ---------------------------------------------------------------------------
// Generic security signals
// ---------------------------------------------------------------------------

export type SecuritySignalKind =
  | 'prompt_injection'
  | 'tool_use_violation'
  | 'output_filter_block'
  | 'jailbreak_detected'
  | 'data_poisoning_signal'
  | 'consumption_anomaly'
  | 'ephemeral_exec'
  | 'vector_chunk_blocked'
  | 'red_team_failure';

export interface AgentSecuritySignal {
  readonly id: string;
  readonly tenantId: string;
  readonly signalKind: SecuritySignalKind;
  readonly severity: Severity;
  readonly evidence: Readonly<Record<string, unknown>>;
  readonly recordedAt: string;
  readonly auditHash: string;
}

// ---------------------------------------------------------------------------
// Red-team scenarios
// ---------------------------------------------------------------------------

/**
 * OWASP LLM Top 10 (2025) category an individual scenario maps onto.
 */
export type OwaspLlmCategory =
  | 'LLM01'
  | 'LLM02'
  | 'LLM03'
  | 'LLM04'
  | 'LLM05'
  | 'LLM06'
  | 'LLM07'
  | 'LLM08'
  | 'LLM09'
  | 'LLM10';

export interface RedTeamScenario {
  readonly id: string;
  readonly title: string;
  readonly owaspCategory: OwaspLlmCategory;
  /** Free-form ATLAS technique identifier (e.g. `AML.T0051`). */
  readonly atlasTechnique: string;
  readonly expectedSeverity: Severity;
  /** The synthetic, clearly-labelled test fixture input. */
  readonly attackInput: string;
  /** Channel the scenario simulates. */
  readonly channel: AgentChannel;
  /** Whether the scenario expects a tool-call rejection. */
  readonly expectsBlock: boolean;
}

export interface RedTeamOutcome {
  readonly scenarioId: string;
  readonly attempted: boolean;
  readonly blocked: boolean;
  readonly succeeded: boolean;
  readonly notes: string;
}

export interface RedTeamRun {
  readonly id: string;
  readonly tenantId: string;
  readonly scenario: string;
  readonly startedAt: string;
  readonly endedAt: string | null;
  readonly attacksAttempted: number;
  readonly attacksBlocked: number;
  readonly attacksSucceeded: number;
  readonly status: 'running' | 'passed' | 'failed' | 'error' | 'cancelled';
  readonly auditHash: string;
  readonly prevHash: string;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class AgentSecurityGuardError extends Error {
  public readonly code:
    | 'INVALID_INPUT'
    | 'AUTHORITY_DENIED'
    | 'SCHEMA_VIOLATION'
    | 'INTERNAL';

  constructor(
    message: string,
    code:
      | 'INVALID_INPUT'
      | 'AUTHORITY_DENIED'
      | 'SCHEMA_VIOLATION'
      | 'INTERNAL',
  ) {
    super(message);
    this.name = 'AgentSecurityGuardError';
    this.code = code;
  }
}
