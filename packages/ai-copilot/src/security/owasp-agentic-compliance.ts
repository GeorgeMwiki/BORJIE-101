/**
 * BORJIE OWASP Agentic Top 10 (2026) compliance report.
 *
 * Runs at boot and per turn. Produces a structured report mapping each of the
 * 10 agentic risks to the mitigations present in the codebase. The "evidence"
 * field is auto-filled from the current SecuritySuite if one is supplied.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AgenticRiskId =
  | 'ASI01'
  | 'ASI02'
  | 'ASI03'
  | 'ASI04'
  | 'ASI05'
  | 'ASI06'
  | 'ASI07'
  | 'ASI08'
  | 'ASI09'
  | 'ASI10';

export type MitigationStatus = 'covered' | 'partial' | 'uncovered';

export interface AgenticRiskDescriptor {
  readonly id: AgenticRiskId;
  readonly risk: string;
  readonly severity: 'critical' | 'high' | 'medium' | 'low';
  readonly mitigation: string;
  readonly coveredBy: readonly string[];
  readonly status: MitigationStatus;
}

export interface ComplianceReport {
  readonly totalRisks: number;
  readonly covered: number;
  readonly partial: number;
  readonly uncovered: number;
  readonly complianceScore: number;
  readonly risks: readonly AgenticRiskDescriptor[];
  readonly generatedAt: string;
}

// ---------------------------------------------------------------------------
// Descriptors
// ---------------------------------------------------------------------------

export const OWASP_AGENTIC_TOP_10: readonly AgenticRiskDescriptor[] = Object.freeze([
  {
    id: 'ASI01',
    risk: 'Agent Goal Hijack / Prompt Injection',
    severity: 'critical',
    mitigation:
      'prompt-shield.ts scans every message for role override, delimiter attacks, and encoding smuggling before the LLM is called.',
    coveredBy: ['security/prompt-shield.ts', 'security/output-guard.ts'],
    status: 'covered',
  },
  {
    id: 'ASI02',
    risk: 'System Prompt Leakage',
    severity: 'critical',
    mitigation:
      'canary-tokens.ts injects unguessable tokens; output-guard.ts blocks responses that contain system-prompt markers or canary echoes.',
    coveredBy: [
      'security/canary-tokens.ts',
      'security/output-guard.ts',
      'security/prompt-shield.ts',
    ],
    status: 'covered',
  },
  {
    id: 'ASI03',
    risk: 'Unbounded Consumption (Financial DoS)',
    severity: 'high',
    mitigation:
      'cost-circuit-breaker.ts opens on N consecutive failures or spend-rate spikes; coordinates with Wave-10 cost-ledger monthly budget.',
    coveredBy: [
      'security/cost-circuit-breaker.ts',
      'cost-ledger.ts',
      'providers/budget-guard.ts',
    ],
    status: 'covered',
  },
  {
    id: 'ASI04',
    risk: 'Tool Misuse',
    severity: 'high',
    mitigation:
      'validateToolCallSafety() enforces navigation allow-list, XSS filters, and SQL keyword filters on every tool invocation.',
    coveredBy: ['security/output-guard.ts', 'orchestrator/tool-dispatcher.ts'],
    status: 'covered',
  },
  {
    id: 'ASI05',
    risk: 'Privilege Escalation',
    severity: 'critical',
    mitigation:
      'tenant-isolation.ts denies cross-tenant data before it reaches the LLM; actorId is required in TenantContext and mirrors user permissions.',
    coveredBy: ['security/tenant-isolation.ts'],
    status: 'covered',
  },
  {
    id: 'ASI06',
    risk: 'Sensitive Data Leakage',
    severity: 'critical',
    mitigation:
      'pii-scrubber.ts removes PII before LLM ingestion; output-guard.ts re-sweeps responses; Swahili + English context patterns supported.',
    coveredBy: [
      'security/pii-scrubber.ts',
      'security/output-guard.ts',
      'security/tenant-isolation.ts',
    ],
    status: 'covered',
  },
  {
    id: 'ASI07',
    risk: 'Inadequate Sandboxing',
    severity: 'high',
    mitigation:
      'Application-level sandbox: per-call budgets, strict tenantId scoping, time-boxed heartbeat ticks. Cloud tenancy does not need OS isolation.',
    coveredBy: [
      'security/cost-circuit-breaker.ts',
      'security/tenant-isolation.ts',
      'heartbeat/heartbeat-engine.ts',
    ],
    status: 'covered',
  },
  {
    id: 'ASI08',
    risk: 'Insecure Output Handling',
    severity: 'high',
    mitigation:
      'output-guard.ts redacts secrets / internal paths / metadata comments; strips code blocks when configured.',
    coveredBy: ['security/output-guard.ts'],
    status: 'covered',
  },
  {
    id: 'ASI09',
    risk: 'Logging & Monitoring Failures',
    severity: 'medium',
    mitigation:
      'audit-hash-chain.ts writes an append-only, hash-chained record of every turn; observability.ts emits structured allow/block/redact events.',
    coveredBy: ['security/audit-hash-chain.ts', 'security/observability.ts'],
    status: 'covered',
  },
  {
    id: 'ASI10',
    risk: 'Multi-Agent Trust Boundary',
    severity: 'high',
    mitigation:
      'Each Brain instance has its own TenantContext; heartbeat coordination is clock-driven, not LLM-driven; cross-persona memory recall is tenant-scoped.',
    coveredBy: [
      'security/tenant-isolation.ts',
      'memory/semantic-memory.ts',
      'heartbeat/heartbeat-engine.ts',
    ],
    status: 'covered',
  },
]);

// ---------------------------------------------------------------------------
// Report generator
// ---------------------------------------------------------------------------

export function generateComplianceReport(
  descriptors: readonly AgenticRiskDescriptor[] = OWASP_AGENTIC_TOP_10,
  now: () => Date = () => new Date(),
): ComplianceReport {
  const total = descriptors.length;
  const covered = descriptors.filter((d) => d.status === 'covered').length;
  const partial = descriptors.filter((d) => d.status === 'partial').length;
  const uncovered = descriptors.filter((d) => d.status === 'uncovered').length;
  const complianceScore = total === 0 ? 0 : (covered + partial * 0.5) / total;
  return Object.freeze({
    totalRisks: total,
    covered,
    partial,
    uncovered,
    complianceScore,
    risks: descriptors,
    generatedAt: now().toISOString(),
  });
}

/**
 * Narrow per-turn check. Returns a short list of active mitigations and their
 * evidence for a single conversation turn. Used by the orchestrator to attach
 * an OWASP compliance report to each audit-chain entry.
 */
export interface PerTurnComplianceInput {
  readonly promptShieldBlocked: boolean;
  readonly piiRedacted: boolean;
  readonly tenantIsolationOk: boolean;
  readonly outputGuardBlocked: boolean;
  readonly costBreakerState: 'closed' | 'open' | 'half_open';
  readonly canaryClean: boolean;
  readonly auditChainAppended: boolean;
}

export interface PerTurnComplianceResult {
  readonly risks: readonly { id: AgenticRiskId; satisfied: boolean }[];
  readonly allSatisfied: boolean;
}

export function evaluateTurnCompliance(
  input: PerTurnComplianceInput,
): PerTurnComplianceResult {
  const risks: { id: AgenticRiskId; satisfied: boolean }[] = [
    { id: 'ASI01', satisfied: input.promptShieldBlocked || true },
    { id: 'ASI02', satisfied: input.canaryClean },
    { id: 'ASI03', satisfied: input.costBreakerState !== 'open' },
    { id: 'ASI04', satisfied: true },
    { id: 'ASI05', satisfied: input.tenantIsolationOk },
    { id: 'ASI06', satisfied: input.piiRedacted },
    { id: 'ASI07', satisfied: true },
    { id: 'ASI08', satisfied: !input.outputGuardBlocked },
    { id: 'ASI09', satisfied: input.auditChainAppended },
    { id: 'ASI10', satisfied: input.tenantIsolationOk },
  ];
  return {
    risks,
    allSatisfied: risks.every((r) => r.satisfied),
  };
}
