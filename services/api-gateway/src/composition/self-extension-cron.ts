/**
 * self-extension-cron.ts — the GOVERNED, PROPOSE-ONLY driver that lights the
 * dark self-extension keystone (`@borjie/central-intelligence`
 * `orchestrator.detectRecurringGap` / `orchestrator.proposeNewSubMd`).
 *
 * THE GAP THIS CLOSES
 * -------------------
 * The self-extension organ (packages/central-intelligence/src/kernel/
 * orchestrator/self-extension.ts) lets the MD DETECT a recurring problem that
 * NO existing sub-MD handles and PROPOSE a new sub-MD specification — but it
 * had ZERO autonomous callers. The detect→build edge (the self-build
 * orchestrator's `driveGapToProposal`) was admin-HTTP-only. This cron wires a
 * leader-gated periodic driver that:
 *
 *   1. Builds a Drizzle `ActivityLogPort` reading recurring-gap signals from
 *      `decision_traces` (failed / abstained turns), `audit_events` (FAILURE
 *      outcomes) and `md_commitments` capability-gap rows (gap_kind non-null).
 *   2. Calls `detectRecurringGap` per active tenant.
 *   3. On a diagnosis, calls `proposeNewSubMd` to draft a `SubMdProposal`.
 *   4. Routes that proposal to the OWNER FOUR-EYE INBOX (the injected
 *      `enqueueFourEye` port → `enqueueFourEyeRequest`) as a PROPOSE-ONLY
 *      pending approval. It ALSO feeds the detected gap into the existing
 *      propose-only `driveGapToProposal` (the detect→build edge) so the
 *      operator's self-build surface gains a dry-run module proposal too.
 *
 * ABSOLUTE GOVERNANCE CONSTRAINT (what stays UNMOUNTED)
 * ----------------------------------------------------
 * This NEVER autonomously deploys. It MUST NOT — and DOES NOT — call
 * `compileAndDeploySubMd`'s runtime-apply. The cron's terminal action is a
 * FOUR-EYE PENDING PROPOSAL a human approves. `compileAndDeploySubMd` is NOT
 * imported or referenced here at all; the real code-deploy / runtime-apply path
 * stays a separate, maximally-governed wave. No DDL, no registry mutation, no
 * sub-MD activation happens on this path.
 *
 * CI-INERT + HONEST-DEGRADE
 * -------------------------
 * The cron is constructed/started ONLY inside the same leader-gated, db-present
 * block the other workers use; with no db/leader it never starts (the composition
 * root builds the no-op when `serviceRegistry.db` is absent, mirroring
 * proactiveIntelWorker / outcomeReconciliationWorker). Every step is try/caught,
 * logs via the Pino-shape logger, and skips the tick — a fault never crashes the
 * worker or boot. The interval is `unref()`-ed so it never holds the process
 * open, and `enabled` defaults off under `NODE_ENV==='test'`.
 *
 * Immutable inputs; Pino-shape logger only (no console).
 */

import { sql } from 'drizzle-orm';
import { orchestrator } from '@borjie/central-intelligence';
import type { PinoLikeLogger } from '../utils/pino-shim.js';
import { createPinoLikeLogger } from '../utils/pino-shim.js';
import type {
  SelfBuildOrchestrator,
  RecordedGap,
} from './self-build/index.js';

// Re-typed locally from the central-intelligence orchestrator namespace so the
// cron never deep-imports the kernel file.
type ActivityLogPort = orchestrator.ActivityLogPort;
type ActivityLogEntry = orchestrator.ActivityLogEntry;
type SubMdRegistryPort = orchestrator.SubMdRegistryPort;
type SelfExtensionLLMRouterPort = orchestrator.SelfExtensionLLMRouterPort;
type OwnerApprovalPort = orchestrator.OwnerApprovalPort;
type SelfExtensionDeps = orchestrator.SelfExtensionDeps;
type SubMdProposal = orchestrator.SubMdProposal;
type RecurringGapDiagnosis = orchestrator.RecurringGapDiagnosis;

// ─────────────────────────────────────────────────────────────────────
// Tunables — clamped so a bad env can never push the cadence out of band.
// ─────────────────────────────────────────────────────────────────────

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000; // daily
const MIN_INTERVAL_MS = 5 * 60 * 1000; // 5-minute floor
const MAX_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 7-day ceiling

/** Look-back window the activity-log reads. */
const DEFAULT_WINDOW_DAYS = 30;
/** Minimum cluster size that constitutes a recurring gap. */
const DEFAULT_THRESHOLD = 10;
/** Hard cap on rows pulled per tenant per signal table. */
const PER_TABLE_ROW_CAP = 2000;
/** Hard cap on active tenants scanned per tick. */
const TENANT_SCAN_CAP = 500;

function clampInterval(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return DEFAULT_INTERVAL_MS;
  return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, ms));
}

// ─────────────────────────────────────────────────────────────────────
// Ports
// ─────────────────────────────────────────────────────────────────────

interface DbLike {
  execute(query: unknown): Promise<unknown>;
}

/**
 * Routes a drafted sub-MD proposal to the owner FOUR-EYE inbox as a PROPOSE-
 * ONLY pending approval. The composition root binds
 * `enqueueFourEyeRequest(db, …)`; tests inject a recording fake. Returns the
 * created request id (or null on degrade — honest-degrade, never throws).
 */
export interface FourEyeEnqueuePort {
  enqueue(args: {
    readonly tenantId: string;
    readonly requesterId: string;
    readonly actionType: string;
    readonly payload: Record<string, unknown>;
  }): Promise<{ readonly requestId: string } | null>;
}

export interface SelfExtensionCronDeps {
  /**
   * Binds the service-role GUC around EVERY read so RLS FORCE holds for this
   * out-of-band worker — it has no request middleware to bind
   * `app.current_tenant_id`, so without this RLS returns ZERO rows and the
   * keystone is inert. The composition root injects
   * `(fn) => withServiceRoleContext(serviceRegistry.db, fn)` (the SAME audited
   * platform-scope read path the resident estate-mind workers use); tests inject
   * an identity wrapper over a fake db. Reads are per-tenant, proposals are
   * per-tenant — no tenant's data ever crosses into another tenant's output.
   */
  readonly withServiceRole: <T>(fn: (tx: DbLike) => Promise<T>) => Promise<T>;
  readonly logger?: PinoLikeLogger;
  /** The four-eye inbox the proposal routes to (propose-only terminal). */
  readonly fourEye: FourEyeEnqueuePort;
  /**
   * The propose-only self-build orchestrator — the detect→build edge. The cron
   * ALSO feeds each detected gap here so the operator surface gains a dry-run
   * module proposal. Optional: when omitted, only the four-eye route fires.
   */
  readonly selfBuild?: SelfBuildOrchestrator;
  /** Lists known sub-MDs so the keystone avoids duplicate proposals. */
  readonly subMdRegistry: SubMdRegistryPort;
  /** LLM router that drafts the sub-MD spec from a diagnosis. */
  readonly llmRouter: SelfExtensionLLMRouterPort;
  /** The requester id stamped on the four-eye request (the MD actor). */
  readonly proposerActor?: string;
  readonly intervalMs?: number;
  readonly windowDays?: number;
  readonly thresholdEventCount?: number;
  readonly enabled?: boolean;
  readonly clock?: () => number;
}

export interface SelfExtensionTickResult {
  readonly tenantsScanned: number;
  readonly diagnosed: number;
  readonly proposalsEnqueued: number;
  readonly buildProposalsDriven: number;
  readonly errored: number;
}

export interface SelfExtensionCronHandle {
  start(): void;
  stop(): void;
  tickOnce(): Promise<SelfExtensionTickResult>;
}

// ─────────────────────────────────────────────────────────────────────
// Row helpers
// ─────────────────────────────────────────────────────────────────────

function asRows(res: unknown): readonly Record<string, unknown>[] {
  if (Array.isArray(res)) return res as Record<string, unknown>[];
  const r = (res as { rows?: unknown }).rows;
  return Array.isArray(r) ? (r as Record<string, unknown>[]) : [];
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function toMs(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const ms = new Date(value).getTime();
    return Number.isFinite(ms) ? ms : 0;
  }
  return 0;
}

// ─────────────────────────────────────────────────────────────────────
// Drizzle ActivityLogPort — reads recurring-gap signals.
//
// Three signal sources, all read READ-ONLY:
//   1. decision_traces  — turns whose `outcome` was a failure / abstention.
//      A `chosen_branch_id IS NULL` or a non-success outcome marks a turn the
//      MD could not confidently resolve (the dominant gap signal).
//   2. audit_events     — FAILURE-outcome rows (category-agnostic): a recurring
//      action that keeps failing is a capability gap.
//   3. md_commitments   — explicit capability-gap rows (gap_kind non-null) the
//      gap register already recorded. These carry `competence_domain` which the
//      detector clusters on directly.
//
// Each row is projected onto the kernel `ActivityLogEntry` shape. The
// `missingLineWorker` marker (the STRONGEST detector signal) is set from the
// md_commitments `competence_domain` so an explicit gap dominates clustering.
// ─────────────────────────────────────────────────────────────────────

/**
 * Build a tenant-scoped, read-only `ActivityLogPort` over Drizzle for ONE
 * tenant. The detector reads `recent({ windowDays, nowMs })`; we ignore nowMs
 * for the cutoff (the SQL uses `now() - interval`) but honor windowDays.
 */
export function createDrizzleActivityLogPort(args: {
  readonly withServiceRole: <T>(fn: (tx: DbLike) => Promise<T>) => Promise<T>;
  readonly tenantId: string;
  readonly logger: PinoLikeLogger;
}): ActivityLogPort {
  const { withServiceRole, tenantId, logger } = args;
  return {
    async recent(input): Promise<ReadonlyArray<ActivityLogEntry>> {
      const windowDays = Math.max(1, Math.min(365, Math.floor(input.windowDays)));
      // RLS-safe: bind the service-role GUC for the whole read batch (this
      // worker has no request-bound tenant GUC). Outer guard → [] on any
      // scope/connection fault so a tick never throws.
      try {
        return await withServiceRole(async (db) => {
      const entries: ActivityLogEntry[] = [];

      // 1. decision_traces — non-success / abstained turns.
      try {
        const res = await db.execute(sql`
          SELECT id, name, outcome, started_at
            FROM decision_traces
           WHERE tenant_id = ${tenantId}
             AND started_at >= now() - make_interval(days => ${windowDays})
             AND outcome <> 'success'
           ORDER BY started_at DESC
           LIMIT ${PER_TABLE_ROW_CAP}
        `);
        for (const r of asRows(res)) {
          const id = asString(r.id);
          if (!id) continue;
          entries.push(
            Object.freeze({
              id: `trace:${id}`,
              occurredAtMs: toMs(r.started_at),
              topic: `decision.${asString(r.name) ?? 'turn'}.${asString(r.outcome) ?? 'failed'}`,
              payload: Object.freeze({ outcome: asString(r.outcome) }),
              tenantId,
            }),
          );
        }
      } catch (e) {
        logger.warn(
          { tenantId, err: e instanceof Error ? e.message : String(e) },
          'self-extension-cron: decision_traces read skipped',
        );
      }

      // 2. audit_events — FAILURE-outcome rows.
      try {
        const res = await db.execute(sql`
          SELECT id, action, outcome, timestamp
            FROM audit_events
           WHERE tenant_id = ${tenantId}
             AND timestamp >= now() - make_interval(days => ${windowDays})
             AND outcome = 'FAILURE'
           ORDER BY timestamp DESC
           LIMIT ${PER_TABLE_ROW_CAP}
        `);
        for (const r of asRows(res)) {
          const id = asString(r.id);
          if (!id) continue;
          entries.push(
            Object.freeze({
              id: `audit:${id}`,
              occurredAtMs: toMs(r.timestamp),
              topic: `audit.${asString(r.action) ?? 'action'}.failure`,
              payload: Object.freeze({ action: asString(r.action) }),
              tenantId,
            }),
          );
        }
      } catch (e) {
        logger.warn(
          { tenantId, err: e instanceof Error ? e.message : String(e) },
          'self-extension-cron: audit_events read skipped',
        );
      }

      // 3. md_commitments — explicit capability-gap rows (gap_kind non-null).
      try {
        const res = await db.execute(sql`
          SELECT id, kind, gap_kind, competence_domain, created_at
            FROM md_commitments
           WHERE tenant_id = ${tenantId}
             AND gap_kind IS NOT NULL
             AND status IN ('open', 'blocked', 'reopened', 'overdue')
             AND created_at >= now() - make_interval(days => ${windowDays})
           ORDER BY created_at DESC
           LIMIT ${PER_TABLE_ROW_CAP}
        `);
        for (const r of asRows(res)) {
          const id = asString(r.id);
          if (!id) continue;
          const domain = asString(r.competence_domain);
          entries.push(
            Object.freeze({
              id: `gap:${id}`,
              occurredAtMs: toMs(r.created_at),
              topic: `gap.${asString(r.gap_kind) ?? 'unknown'}.${asString(r.kind) ?? 'general'}`,
              payload: Object.freeze({
                gapKind: asString(r.gap_kind),
                competenceDomain: domain,
              }),
              tenantId,
              // The competence-domain marker is the STRONGEST clustering signal —
              // an explicit gap dominates the detector's winner selection.
              ...(domain ? { missingLineWorker: domain } : {}),
            }),
          );
        }
      } catch (e) {
        logger.warn(
          { tenantId, err: e instanceof Error ? e.message : String(e) },
          'self-extension-cron: md_commitments read skipped',
        );
      }

          return Object.freeze(entries);
        });
      } catch (e) {
        logger.warn(
          { tenantId, err: e instanceof Error ? e.message : String(e) },
          'self-extension-cron: activity-log service-role read failed — empty',
        );
        return Object.freeze([]);
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// The cron
// ─────────────────────────────────────────────────────────────────────

const ZERO_RESULT: SelfExtensionTickResult = Object.freeze({
  tenantsScanned: 0,
  diagnosed: 0,
  proposalsEnqueued: 0,
  buildProposalsDriven: 0,
  errored: 0,
});

/**
 * Build the governed, propose-only self-extension cron. Exposes
 * `ClusterCronSupervisor`-compatible `start()` / `stop()` (so the composition
 * root wraps it in `withClusterLeader`) plus `tickOnce()` for tests.
 *
 * NEVER deploys. The terminal action is a four-eye pending proposal +
 * (optionally) a propose-only self-build dry-run. `compileAndDeploySubMd` is
 * not referenced — runtime-apply stays UNMOUNTED.
 */
export function createSelfExtensionCron(
  deps: SelfExtensionCronDeps,
): SelfExtensionCronHandle {
  const logger = deps.logger ?? createPinoLikeLogger('self-extension-cron');
  const clock = deps.clock ?? Date.now;
  const intervalMs = clampInterval(deps.intervalMs ?? DEFAULT_INTERVAL_MS);
  const windowDays = deps.windowDays ?? DEFAULT_WINDOW_DAYS;
  const threshold = deps.thresholdEventCount ?? DEFAULT_THRESHOLD;
  const proposerActor = deps.proposerActor ?? 'self-extension-keystone';
  const enabled = deps.enabled ?? process.env.NODE_ENV !== 'test';

  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;

  async function listActiveTenants(): Promise<readonly string[]> {
    try {
      // Cross-tenant platform-scope read — must run under the service-role GUC
      // (RLS FORCE on `tenants` would otherwise return only the bound tenant).
      const res = await deps.withServiceRole((db) =>
        db.execute(
          sql`SELECT id FROM tenants WHERE status = 'active' LIMIT ${TENANT_SCAN_CAP}`,
        ),
      );
      return asRows(res)
        .map((r) => asString(r.id))
        .filter((id): id is string => id !== null);
    } catch (e) {
      logger.warn(
        { err: e instanceof Error ? e.message : String(e) },
        'self-extension-cron: list active tenants failed',
      );
      return [];
    }
  }

  /**
   * Build the per-tenant `SelfExtensionDeps`. The `ownerApproval` port is a
   * NO-OP defer: the cron routes proposals to four-eye itself (below), so the
   * keystone's own ask() never auto-resolves a decision. `ledger` is omitted —
   * nothing is deployed, so there is no deploy to audit on this path.
   */
  function buildKeystoneDeps(tenantId: string): SelfExtensionDeps {
    const activityLog = createDrizzleActivityLogPort({
      withServiceRole: deps.withServiceRole,
      tenantId,
      logger,
    });
    const ownerApproval: OwnerApprovalPort = {
      // Defer ALWAYS — the cron is propose-only; a real owner decides via the
      // four-eye inbox. We never return 'approved' here (that would be the
      // auto-deploy path this cron is forbidden from taking).
      async ask() {
        return Object.freeze({
          kind: 'deferred' as const,
          resumeAfterMs: intervalMs,
        });
      },
    };
    return {
      activityLog,
      subMdRegistry: deps.subMdRegistry,
      llmRouter: deps.llmRouter,
      ownerApproval,
      clock,
    };
  }

  /** Route ONE drafted proposal to the four-eye inbox (propose-only). */
  async function routeToFourEye(
    tenantId: string,
    proposal: SubMdProposal,
  ): Promise<boolean> {
    try {
      const enqueued = await deps.fourEye.enqueue({
        tenantId,
        requesterId: proposerActor,
        // Free-form action verb (the column is unconstrained text). The brain
        // verb + the full proposal live inside the payload for the reviewer.
        actionType: 'self_extension.sub_md.propose',
        payload: {
          proposalId: proposal.proposalId,
          subMdName: proposal.spec.name,
          riskTier: proposal.spec.riskTier,
          purpose: proposal.spec.purpose,
          successCriterion: proposal.spec.successCriterion,
          dailyCostCeilingUsdCents: proposal.dailyCostCeilingUsdCents,
          diagnosis: {
            pattern: proposal.diagnosis.pattern,
            observedCount: proposal.diagnosis.observedCount,
            observedWindowDays: proposal.diagnosis.observedWindowDays,
          },
          // The reviewer sees this is PROPOSE-ONLY: no deploy happened.
          applied: false,
          note: 'Self-extension proposal — runtime-apply is UNMOUNTED; approval records intent only.',
        },
      });
      return enqueued !== null;
    } catch (e) {
      logger.error(
        { tenantId, err: e instanceof Error ? e.message : String(e) },
        'self-extension-cron: four-eye enqueue failed',
      );
      return false;
    }
  }

  /**
   * Close the detect→build edge: feed the diagnosis into the propose-only
   * self-build orchestrator as a RecordedGap so the operator surface gains a
   * dry-run module proposal. NEVER applies — driveGapToProposal stores a
   * 'proposed' module only. Returns true when a proposal was driven.
   */
  async function driveBuildEdge(
    tenantId: string,
    diagnosis: RecurringGapDiagnosis,
  ): Promise<boolean> {
    if (!deps.selfBuild) return false;
    const gap = diagnosisToRecordedGap(tenantId, diagnosis, clock);
    try {
      const result = await deps.selfBuild.driveGapToProposal({
        gap,
        driverUserId: proposerActor,
      });
      if (!result.ok) {
        logger.warn(
          { tenantId, gapId: gap.id, reason: result.reason },
          'self-extension-cron: self-build dry-run degraded (no apply)',
        );
        return false;
      }
      return true;
    } catch (e) {
      logger.error(
        { tenantId, gapId: gap.id, err: e instanceof Error ? e.message : String(e) },
        'self-extension-cron: self-build drive failed',
      );
      return false;
    }
  }

  async function tickTenant(
    tenantId: string,
  ): Promise<{ diagnosed: boolean; enqueued: boolean; driven: boolean }> {
    const keystoneDeps = buildKeystoneDeps(tenantId);
    const diagnosis = await orchestrator.detectRecurringGap(keystoneDeps, {
      thresholdEventCount: threshold,
      windowDays,
      tenantId,
    });
    if (!diagnosis) {
      return { diagnosed: false, enqueued: false, driven: false };
    }
    // Draft the sub-MD proposal (LLM-router-backed). NEVER deploys.
    const proposal = await orchestrator.proposeNewSubMd(diagnosis, keystoneDeps);
    const enqueued = await routeToFourEye(tenantId, proposal);
    const driven = await driveBuildEdge(tenantId, diagnosis);
    logger.info(
      {
        tenantId,
        observedCount: diagnosis.observedCount,
        proposalId: proposal.proposalId,
        subMdName: proposal.spec.name,
        enqueued,
        driven,
      },
      'self-extension-cron: recurring gap diagnosed → PROPOSED (four-eye, propose-only)',
    );
    return { diagnosed: true, enqueued, driven };
  }

  async function tickOnce(): Promise<SelfExtensionTickResult> {
    if (running) return ZERO_RESULT;
    running = true;
    let tenantsScanned = 0;
    let diagnosed = 0;
    let proposalsEnqueued = 0;
    let buildProposalsDriven = 0;
    let errored = 0;
    try {
      const tenants = await listActiveTenants();
      for (const tenantId of tenants) {
        try {
          const outcome = await tickTenant(tenantId);
          tenantsScanned += 1;
          if (outcome.diagnosed) diagnosed += 1;
          if (outcome.enqueued) proposalsEnqueued += 1;
          if (outcome.driven) buildProposalsDriven += 1;
        } catch (e) {
          errored += 1;
          logger.error(
            { tenantId, err: e instanceof Error ? e.message : String(e) },
            'self-extension-cron: tenant tick failed',
          );
        }
      }
    } catch (e) {
      // The outermost guard — a fault here NEVER escapes the tick.
      logger.error(
        { err: e instanceof Error ? e.message : String(e) },
        'self-extension-cron: tick failed',
      );
    } finally {
      running = false;
    }
    return Object.freeze({
      tenantsScanned,
      diagnosed,
      proposalsEnqueued,
      buildProposalsDriven,
      errored,
    });
  }

  return {
    start(): void {
      if (!enabled) {
        logger.info({ intervalMs }, 'self-extension-cron: disabled (no start)');
        return;
      }
      if (timer) {
        logger.warn({}, 'self-extension-cron: already running, ignoring duplicate start');
        return;
      }
      logger.info({ intervalMs, windowDays, threshold }, 'self-extension-cron started');
      timer = setInterval(() => {
        void tickOnce();
      }, intervalMs);
      if (typeof timer.unref === 'function') timer.unref();
    },
    stop(): void {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    tickOnce,
  };
}

/**
 * Project a `RecurringGapDiagnosis` onto the self-build deriver's `RecordedGap`
 * view. Pure. The derived gap is a SAFE, minimal skeleton — the self-build
 * orchestrator stores it as a 'proposed' module (never applied).
 */
function diagnosisToRecordedGap(
  tenantId: string,
  diagnosis: RecurringGapDiagnosis,
  clock: () => number,
): RecordedGap {
  const domain = diagnosis.suggestedScope.tenantId === tenantId
    ? (diagnosis.suggestedPersona.id || 'capability')
    : 'capability';
  const title = `Recurring gap: ${diagnosis.suggestedPersona.id}`;
  return Object.freeze({
    id: `selfext-${tenantId}-${clock()}`,
    tenantId,
    gapKind: 'unwired_organ',
    kind: domain,
    title,
    titleSw: title,
    rationale: diagnosis.pattern,
    competenceDomain: domain,
    unblockTrigger: null,
  });
}
