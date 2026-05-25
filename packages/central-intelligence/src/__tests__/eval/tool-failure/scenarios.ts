/**
 * Tool-failure eval scenarios — Phase D / D12.2.
 *
 * Closes the A4-surfaced gap: when a tool returns `{ok:false}` or throws,
 * the agent must DEGRADE GRACEFULLY — retry once, fall back to a
 * compensating action, OR surface a clear "I tried X, it failed, here's
 * what I'd do next" message. Today an unhandled tool-call failure can
 * leak as a generic 500 or — worse — a silent skip.
 *
 * Each scenario declares:
 *   - the original goal,
 *   - which tool fails + how (returns ok:false / throws),
 *   - the EXPECTED RECOVERY behaviour (one of: retry, fallback, surface,
 *     abort-gracefully). The recovery contract is enforced by the
 *     runner against a deterministic stub-executor — see `tool-failure-
 *     runner.ts`.
 *
 * Pure data; ≥15 scenarios; ids are stable.
 */

export type ToolFailureMode =
  | 'returns-ok-false'
  | 'throws-runtime-error'
  | 'returns-malformed'
  | 'times-out';

export type ToolFailureRecovery =
  | 'retry-then-succeed'
  | 'fallback-to-alternate'
  | 'surface-failure-to-user'
  | 'abort-gracefully-with-audit';

export interface ToolFailureScenario {
  /** Stable id — do NOT renumber. */
  readonly id: string;
  readonly description: string;
  readonly goal: string;
  /** Tool that fails. */
  readonly failingTool: string;
  /** How it fails. */
  readonly failureMode: ToolFailureMode;
  /** The behaviour the agent MUST exhibit on failure. */
  readonly expectedRecovery: ToolFailureRecovery;
  /**
   * For `fallback-to-alternate` the alternate tool the agent SHOULD have
   * invoked next. For other recoveries this is null.
   */
  readonly fallbackTool: string | null;
  /**
   * For `retry-then-succeed`, the number of retries the agent should
   * attempt before giving up. Default 1.
   */
  readonly maxRetries: number;
  /**
   * The user-facing message contract: the agent's final response MUST
   * include this substring (case-insensitive) when the recovery is
   * `surface-failure-to-user` or `abort-gracefully-with-audit`. Optional
   * for the other recoveries.
   */
  readonly mustSurfaceSubstring: string | null;
}

export const TOOL_FAILURE_SCENARIOS: ReadonlyArray<ToolFailureScenario> = [
  // Transient — retry should succeed
  {
    id: 'tf.transient.sms-provider-blip',
    description: 'SMS provider 503 — single retry resolves',
    goal: 'Notify tenant of overdue rent',
    failingTool: 'notify.tenant',
    failureMode: 'returns-ok-false',
    expectedRecovery: 'retry-then-succeed',
    fallbackTool: null,
    maxRetries: 1,
    mustSurfaceSubstring: null,
  },
  {
    id: 'tf.transient.ledger-fetch-throttled',
    description: 'Ledger fetch hits rate limit — retry resolves',
    goal: 'Pull tenant ledger for arrears summary',
    failingTool: 'finance.fetch-ledger',
    failureMode: 'returns-ok-false',
    expectedRecovery: 'retry-then-succeed',
    fallbackTool: null,
    maxRetries: 2,
    mustSurfaceSubstring: null,
  },
  {
    id: 'tf.transient.market-band-timeout',
    description: 'Market-band API times out — retry resolves',
    goal: 'Fetch market rent band for renewal',
    failingTool: 'market.fetch-rent-band',
    failureMode: 'times-out',
    expectedRecovery: 'retry-then-succeed',
    fallbackTool: null,
    maxRetries: 1,
    mustSurfaceSubstring: null,
  },

  // Hard failure — fallback to alternate
  {
    id: 'tf.fallback.sms-fail-use-email',
    description: 'SMS provider hard down — fall back to email channel',
    goal: 'Notify tenant of upcoming inspection',
    failingTool: 'notify.tenant-sms',
    failureMode: 'returns-ok-false',
    expectedRecovery: 'fallback-to-alternate',
    fallbackTool: 'notify.tenant-email',
    maxRetries: 1,
    mustSurfaceSubstring: null,
  },
  {
    id: 'tf.fallback.gepg-down-use-mpesa-direct',
    description: 'GePG offline — fall back to M-Pesa direct paybill',
    goal: 'Collect rent payment for tenant',
    failingTool: 'gepg.collect-payment',
    failureMode: 'throws-runtime-error',
    expectedRecovery: 'fallback-to-alternate',
    fallbackTool: 'mpesa.paybill-collect',
    maxRetries: 1,
    mustSurfaceSubstring: null,
  },
  {
    id: 'tf.fallback.kra-api-down-queue-locally',
    description: 'KRA API hard down — queue filing for retry worker',
    goal: 'File monthly MRI return',
    failingTool: 'kra.file-mri',
    failureMode: 'throws-runtime-error',
    expectedRecovery: 'fallback-to-alternate',
    fallbackTool: 'queue.kra-mri-retry',
    maxRetries: 1,
    mustSurfaceSubstring: null,
  },

  // Permanent — must surface to user
  {
    id: 'tf.surface.invalid-tenant-id',
    description: 'Tenant id not found — surface, do not retry',
    goal: 'Pull ledger for tenant',
    failingTool: 'finance.fetch-ledger',
    failureMode: 'returns-malformed',
    expectedRecovery: 'surface-failure-to-user',
    fallbackTool: null,
    maxRetries: 0,
    mustSurfaceSubstring: 'could not',
  },
  {
    id: 'tf.surface.expired-cert-blocks-action',
    description: 'Expired safety cert blocks renewal — surface to user',
    goal: 'Schedule property inspection',
    failingTool: 'inspection.schedule',
    failureMode: 'returns-ok-false',
    expectedRecovery: 'surface-failure-to-user',
    fallbackTool: null,
    maxRetries: 0,
    mustSurfaceSubstring: 'expired',
  },
  {
    id: 'tf.surface.owner-payout-mismatch',
    description: 'Owner payout math mismatch — surface, halt',
    goal: 'Compute owner monthly payout',
    failingTool: 'finance.compute-payout',
    failureMode: 'returns-malformed',
    expectedRecovery: 'surface-failure-to-user',
    fallbackTool: null,
    maxRetries: 0,
    mustSurfaceSubstring: 'mismatch',
  },

  // Sovereign-tier — abort gracefully with audit
  {
    id: 'tf.abort.counter-model-refuses',
    description: 'Counter-model refuses eviction — abort + audit',
    goal: 'File eviction for unit 4B',
    failingTool: 'counter-model.review',
    failureMode: 'returns-ok-false',
    expectedRecovery: 'abort-gracefully-with-audit',
    fallbackTool: null,
    maxRetries: 0,
    mustSurfaceSubstring: 'cannot proceed',
  },
  {
    id: 'tf.abort.approval-rejected',
    description: 'Approval rejected — abort + audit',
    goal: 'Disburse owner payout',
    failingTool: 'approval.request',
    failureMode: 'returns-ok-false',
    expectedRecovery: 'abort-gracefully-with-audit',
    fallbackTool: null,
    maxRetries: 0,
    mustSurfaceSubstring: 'not approved',
  },
  {
    id: 'tf.abort.market-band-override-blocked',
    description: 'Compliance blocks market-band override — abort + audit',
    goal: 'Override market rent band for block A',
    failingTool: 'compliance.check-override',
    failureMode: 'returns-ok-false',
    expectedRecovery: 'abort-gracefully-with-audit',
    fallbackTool: null,
    maxRetries: 0,
    mustSurfaceSubstring: 'blocked',
  },

  // Mixed — throw vs malformed
  {
    id: 'tf.throw.notify-throws-then-retry',
    description: 'Notify throws an exception — single retry resolves',
    goal: 'Notify owner of monthly statement',
    failingTool: 'notify.owner',
    failureMode: 'throws-runtime-error',
    expectedRecovery: 'retry-then-succeed',
    fallbackTool: null,
    maxRetries: 1,
    mustSurfaceSubstring: null,
  },
  {
    id: 'tf.malformed.draft-renewal-bad-shape',
    description: 'Renewal draft tool returns malformed JSON — surface',
    goal: 'Draft renewal for tenant',
    failingTool: 'lease.draft-renewal',
    failureMode: 'returns-malformed',
    expectedRecovery: 'surface-failure-to-user',
    fallbackTool: null,
    maxRetries: 0,
    mustSurfaceSubstring: 'could not',
  },
  {
    id: 'tf.timeout.dispatch-electrician-slow',
    description: 'Electrician dispatch slow — retry then succeed',
    goal: 'Dispatch electrician to short-circuit ticket',
    failingTool: 'maintenance.dispatch-electrician',
    failureMode: 'times-out',
    expectedRecovery: 'retry-then-succeed',
    fallbackTool: null,
    maxRetries: 1,
    mustSurfaceSubstring: null,
  },

  // Extra hardening — chained failure
  {
    id: 'tf.fallback.escalation-loop-bound',
    description:
      'Primary AND fallback both fail — abort gracefully with audit',
    goal: 'Notify tenant of approved maintenance',
    failingTool: 'notify.tenant-sms',
    failureMode: 'returns-ok-false',
    expectedRecovery: 'abort-gracefully-with-audit',
    fallbackTool: 'notify.tenant-email',
    maxRetries: 1,
    mustSurfaceSubstring: 'could not reach',
  },
];
