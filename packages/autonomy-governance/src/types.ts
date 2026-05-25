/**
 * @borjie/autonomy-governance — public types
 *
 * Substrate types for per-tenant autonomy-caps + per-sub-MD quality SLOs +
 * auto-rollback canary control. The Klarna defense: optimize for quality
 * drift, not deflection rate; scale carefully, rollback automatically.
 *
 * Sub-MDs are framed (per R3 research) as scoped, reversible
 * task-contracts — not autonomous juniors. Every contract carries a cap +
 * SLO + canary stage + breach action.
 */

/**
 * Risk tier of a tool action — matches the kernel's existing tool-spec
 * RiskTier ladder. Repeated here as a string-literal union so this package
 * has no direct dependency on @borjie/central-intelligence (substrate
 * boundary — wiring is downstream).
 */
export type RiskTier =
  | 'read'
  | 'mutate'
  | 'communicate'
  | 'billing'
  | 'destroy'
  | 'sovereign';

/**
 * SLO metric family.
 *   - `resolution-quality`     0..1, LLM-judged or rubric-scored
 *   - `task-completion-rate`   0..1, sub-MD reached terminal state w/o handoff
 *   - `owner-cs-score`         0..1, normalised owner CSAT
 *   - `cost-per-resolution`    USD cents per resolved task (LOWER = better)
 */
export type SloMetric =
  | 'resolution-quality'
  | 'task-completion-rate'
  | 'owner-cs-score'
  | 'cost-per-resolution';

/**
 * Rolling window over which the SLO metric is evaluated.
 */
export type SloWindow = 'rolling-24h' | 'rolling-7d' | 'rolling-30d';

/**
 * Breach actions, ordered by severity. The auto-rollback engine maps each
 * SLO breach onto one of these.
 *   - `warn`               log + notify HQ admin; no behavioural change
 *   - `reduce-traffic`     drop canary stage one level
 *   - `handoff`            quarantine sub-MD; route incoming work to humans
 *   - `kill-and-rollback`  disable sub-MD entirely; restore prior version
 */
export type BreachAction =
  | 'warn'
  | 'reduce-traffic'
  | 'handoff'
  | 'kill-and-rollback';

/**
 * Canary stage ladder. New sub-MD versions begin at `shadow` (run, but
 * never used) and climb in fixed steps. SLO breaches at any rung demote
 * down by one.
 */
export type CanaryStage =
  | 'shadow'
  | 'canary-1pct'
  | 'canary-5pct'
  | 'canary-25pct'
  | 'live';

/**
 * The four cap-evaluator verdicts.
 *   - `allow`              within all caps; proceed
 *   - `slowdown-ask-owner` between slowdownAt and hardStopAt — ask the
 *                          tenant's HQ owner before exceeding
 *   - `deny-cap-exceeded`  would push past hardStopAt — refuse
 *   - `deny-tier-blocked`  per-tool-tier cap is 0 for this risk tier
 */
export type CapVerdictKind =
  | 'allow'
  | 'slowdown-ask-owner'
  | 'deny-cap-exceeded'
  | 'deny-tier-blocked';

/**
 * Detailed cap verdict. Reason is for audit trails — never exposed to
 * the sub-MD itself (it would optimise around it).
 */
export interface CapVerdict {
  readonly kind: CapVerdictKind;
  readonly reason: string;
  /** Which envelope tripped — for telemetry. */
  readonly trippedEnvelope:
    | 'tenant-mutations'
    | 'tenant-cost'
    | 'sub-md-mutations'
    | 'sub-md-cost'
    | 'tool-tier'
    | null;
  /** Telemetry hint — how close we are to hardStopAt (0..1). */
  readonly headroomPct: number;
}

/**
 * Per-tenant autonomy cap. The outer envelope on every autonomous mutation.
 *
 * Defaults are intentionally conservative (50 mutations/day, $50/day). Caps
 * may only be raised by HQ-admins via the cap-policy DSL — the kernel must
 * never raise its own ceiling.
 */
export interface TenantAutonomyCap {
  readonly tenantId: string;
  readonly maxAutonomousMutationsPerDay: number;
  readonly maxAutonomousCostUsdCentsPerDay: number;
  /** `null` = unlimited for this tier; e.g. `{ destroy: 0, billing: 5 }`. */
  readonly perToolTierCaps: Readonly<Partial<Record<RiskTier, number | null>>>;
  readonly perSubMdCaps: Readonly<
    Record<
      string,
      {
        readonly maxMutationsPerDay: number;
        readonly maxCostUsdCentsPerDay: number;
      }
    >
  >;
  /**
   * Fraction of cap at which `slowdown-ask-owner` engages (e.g. 0.80).
   * Bounded 0 < slowdownAt <= hardStopAt <= 1.
   */
  readonly slowdownAt: number;
  readonly hardStopAt: number;
  /**
   * H8 — IANA timezone name (e.g. `Africa/Nairobi`, `Africa/Dar_es_Salaam`,
   * `Africa/Lagos`) used by the rolling-state adapter to compute the
   * "today" boundary. Optional only for backwards compatibility; new
   * tenants SHOULD specify it. UTC-naïve adapters reset counters at 3 AM
   * local for UTC+3 tenants which breaks the documented cap contract.
   * See JSDoc on cap-evaluator.ts for the full timezone contract.
   */
  readonly timezone?: string | undefined;
  readonly updatedAt: string;
  readonly updatedBy: string;
}

/**
 * Snapshot of today-so-far counters for a tenant. The cap evaluator
 * consults this against the cap to render its verdict. Sourced from the
 * sovereign-action-ledger by the wire-side adapter (out of scope here).
 */
export interface AutonomyRollingState {
  readonly tenantId: string;
  readonly mutationsToday: number;
  readonly costUsdCentsToday: number;
  readonly perSubMd: Readonly<
    Record<
      string,
      {
        readonly mutationsToday: number;
        readonly costUsdCentsToday: number;
      }
    >
  >;
  readonly perToolTier: Readonly<Partial<Record<RiskTier, number>>>;
  readonly asOf: string;
}

/**
 * Action the cap evaluator is asked about.
 */
export interface ProposedAutonomousAction {
  readonly subMd: string;
  readonly tier: RiskTier;
  readonly estimatedCostUsdCents: number;
}

/**
 * Per-sub-MD SLO. One row per (subMd, metric) pair. Tenant-scoped SLOs may
 * coexist with platform-default SLOs (tenantId === null on the DB row;
 * resolution is "tenant overrides platform").
 */
export interface SubMdSlo {
  readonly subMd: string;
  readonly tenantId: string | null;
  readonly metric: SloMetric;
  readonly target: number;
  readonly window: SloWindow;
  readonly breachAction: BreachAction;
  readonly canaryStage: CanaryStage;
}

/**
 * Single SLO observation. Streamed in from the outcome collectors after
 * each sub-MD run terminates.
 */
export interface SloEvent {
  readonly subMd: string;
  readonly tenantId: string | null;
  readonly timestamp: string;
  readonly metric: SloMetric;
  readonly actualValue: number;
  /** Optional forecast (for nowcasts / counter-models). */
  readonly predictedValue?: number;
  /** Signed delta: actual - target. Negative = breach for "higher is better". */
  readonly delta: number;
}

/**
 * The state machine result of streaming an SloEvent through a monitor.
 */
export interface SloMonitorVerdict {
  readonly subMd: string;
  readonly metric: SloMetric;
  readonly breached: boolean;
  readonly nextStage: CanaryStage | null;
  readonly action: BreachAction | 'no-op';
  readonly reason: string;
}

/**
 * Auto-rollback execution receipt — what the rollback engine did.
 */
export interface AutoRollbackReceipt {
  readonly subMd: string;
  readonly tenantId: string | null;
  readonly fromStage: CanaryStage;
  readonly toStage: CanaryStage | 'disabled';
  readonly action: BreachAction;
  readonly reason: string;
  readonly handoffQueued: boolean;
  readonly timestamp: string;
}

/**
 * Handoff queue entry — work the sub-MD was midway through when it got
 * quarantined.
 */
export interface HandoffQueueEntry {
  readonly id: string;
  readonly subMd: string;
  readonly tenantId: string;
  readonly originalRequest: Readonly<Record<string, unknown>>;
  readonly reason: string;
  readonly queuedAt: string;
  readonly priority: 'P0' | 'P1' | 'P2' | 'P3';
  readonly status: 'queued' | 'in-progress' | 'resolved' | 'abandoned';
}
