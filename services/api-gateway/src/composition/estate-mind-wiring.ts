/**
 * EstateMind resident-loop wiring — composition root (Wave 1, keystone wire).
 *
 * Promotes the kernel's resident `EstateMind` Slow Loop
 * (`@borjie/central-intelligence` kernel/estate-mind) into a LIVE, leader-
 * elected, per-tenant heartbeat. The loop PERCEIVES + ORIENTS + evaluates the
 * standing drives + emits self-formulated goals as PROPOSALS through the
 * EXISTING gated proactive sink — it NEVER executes a sovereign/money/licence
 * action (those stay HITL forever).
 *
 * THREE SEAMS THIS MODULE BINDS
 * ─────────────────────────────
 *   1. `createDrizzleSituationalModelStore(db)` — the DURABLE adapter for the
 *      kernel's `SituationalModelStore` port over the `situational_model_entities`
 *      table (migration 0317). Because the heartbeat runs OUT OF BAND (no
 *      request middleware binds the RLS GUC), every read/write is wrapped in
 *      `withServiceRoleContext` so RLS FORCE holds for the worker path.
 *   2. `createTabEventLogProposalSink(db, logger)` — the gated proposal sink.
 *      It writes a `tab_event_log` row with `event_kind='proactive_nudge'`
 *      (the EXACT contract `drainProactiveNudges` already surfaces to the
 *      owner cockpit inbox), idempotently keyed by `(tenant, proposalId)` so a
 *      re-tick coalesces rather than spamming.
 *   3. `createEstateMindSupervisor(deps)` — the interval supervisor. It does
 *      NOTHING unless the flag is ON; `withClusterLeader` (caller-applied)
 *      ensures only the elected leader ticks. The interval is env-tunable and
 *      CLAMPED as a SAFETY bound on tick frequency, not a capability cap.
 *
 * REVERSIBILITY (hard requirement): behaviour is a default-ON KILL-SWITCH on env
 * `BORJIE_ESTATE_MIND` (FULL-POWERS). Default (unset / any value except an
 * explicit off/0/false/no) → the leader-gated heartbeat is ARMED; the resident
 * Slow Loop is propose-only (gated proactive sink, never a sovereign action) and
 * HITL-forever, so flipping it on adds no sovereign-action risk. Set
 * `BORJIE_ESTATE_MIND=off` to disable. The flag is read ONCE inside
 * `initEstateMind` at bootstrap (never per-tick), mirroring `initClusterLock`.
 *
 * No `console.*` (Pino shim only). No `process.env` read outside `initEstateMind`.
 */

import { sql } from 'drizzle-orm';
import {
  situationalModel as situationalModelKernel,
  motivation as motivationKernel,
  estateMind as estateMindKernel,
  orchestrator,
} from '@borjie/central-intelligence';
import {
  withServiceRoleContext,
  situationalModelEntities,
  createDatabaseClient,
} from '@borjie/database';
import {
  createDrizzleMdCommitmentRepository,
  type MdCommitment,
  type MdCommitmentRepository,
} from '@borjie/database/repositories';
import { eq, and } from 'drizzle-orm';
import type { PinoLikeLogger } from '../utils/pino-shim.js';
import { createPinoLikeLogger } from '../utils/pino-shim.js';
import { publishCockpitEvent } from '../services/cockpit-events/index.js';
import {
  createReconcileEngine,
  type ConfirmationProbe,
  type CommitmentAuditSink,
} from './md-commitments/reconcile-engine.js';
import { createDurableConfirmationProbe } from './md-commitments/confirmation-probe.js';
import {
  createWaitForEventSubscriber,
  type ConditionEvaluator,
  type WaitForEventSubscriber,
} from './md-commitments/wait-for.js';
import type { LadderDispatchers } from './md-commitments/ladder-engine.js';

// `DatabaseClient` collides with a drizzle-orm/postgres-js namespace
// declaration when imported by name (TS2709). Derive the type locally from the
// factory return — the same pattern agency-port-bindings.ts uses.
type DatabaseClient = ReturnType<typeof createDatabaseClient>;

/**
 * Kernel organs take a narrow msg-first logger (`warn(msg, meta?)`), but the
 * gateway uses a pino-style meta-first `PinoLikeLogger` (`warn(meta, msg?)`).
 * Adapt one to the other so a single gateway logger drives the kernel without
 * leaking the shape mismatch (and without any `console.*`).
 */
function kernelLoggerOf(p: PinoLikeLogger): {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
} {
  return {
    info: (msg, meta) => p.info(meta ?? {}, msg),
    warn: (msg, meta) => p.warn(meta ?? {}, msg),
  };
}

type SituationalModelStore = situationalModelKernel.SituationalModelStore;
type SituationEntity = situationalModelKernel.SituationEntity;
type RecordEntityInput = situationalModelKernel.RecordEntityInput;
type SituationEntityKey = situationalModelKernel.SituationEntityKey;
type ProposalSink = estateMindKernel.ProposalSink;
type EstateProposal = estateMindKernel.EstateProposal;
type PerceptionSource = estateMindKernel.PerceptionSource;
type ReconciliationPort = estateMindKernel.ReconciliationPort;
type OrchestratorRequest = orchestrator.OrchestratorRequest;

const DEFAULT_INTERVAL_MS = 15 * 60 * 1000; // 15 min — estate horizons
const MIN_INTERVAL_MS = 60 * 1000; // 1 min floor (SAFETY bound)
const MAX_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h ceiling

// ---------------------------------------------------------------------------
// 1. Durable situational-model store (Drizzle, service-role per call)
// ---------------------------------------------------------------------------

/** Parse `${kind}:${entityId}` back into its parts for a keyed read/delete. */
function splitKey(key: SituationEntityKey): { kind: string; entityId: string } {
  const idx = key.indexOf(':');
  if (idx < 0) return { kind: key, entityId: '' };
  return { kind: key.slice(0, idx), entityId: key.slice(idx + 1) };
}

function rowToEntity(row: typeof situationalModelEntities.$inferSelect): SituationEntity {
  return Object.freeze({
    tenantId: row.tenantId,
    entityId: row.entityId,
    kind: row.kind as SituationEntity['kind'],
    label: row.label,
    attributes: Object.freeze({ ...(row.attributes ?? {}) }),
    referenceCount: row.referenceCount,
    firstReferencedAtMs: row.firstReferencedAt.getTime(),
    lastReferencedAtMs: row.lastReferencedAt.getTime(),
    associations: Object.freeze({ ...(row.associations ?? {}) }),
    updatedAtMs: row.updatedAt.getTime(),
  });
}

/**
 * Drizzle adapter for the kernel's `SituationalModelStore`. Every method runs
 * inside `withServiceRoleContext` because the resident heartbeat has no request
 * middleware to bind the tenant GUC — the service-role bypass policy on
 * `situational_model_entities` (migration 0317) permits the system path while
 * RLS FORCE still isolates every other caller. Writes route through the kernel's
 * pure `mergeObservation` fold (read-merge-write) so the ACT-R series survives.
 */
export function createDrizzleSituationalModelStore(
  db: DatabaseClient,
  logger: PinoLikeLogger = createPinoLikeLogger('estate-mind-store'),
): SituationalModelStore {
  return {
    async get(
      tenantId: string,
      key: SituationEntityKey,
    ): Promise<SituationEntity | null> {
      const { kind, entityId } = splitKey(key);
      try {
        return await withServiceRoleContext(db, async (tx) => {
          const rows = await tx
            .select()
            .from(situationalModelEntities)
            .where(
              and(
                eq(situationalModelEntities.tenantId, tenantId),
                eq(situationalModelEntities.kind, kind),
                eq(situationalModelEntities.entityId, entityId),
              ),
            )
            .limit(1);
          const row = rows[0];
          return row ? rowToEntity(row) : null;
        });
      } catch (err) {
        logger.warn(
          { tenantId, key, err: errMsg(err) },
          'estate-mind-store: get failed — returning null',
        );
        return null;
      }
    },

    async record(input: RecordEntityInput): Promise<SituationEntity> {
      situationalModelKernel.parseRecordInput(input);
      const nowMs = Date.now();
      return withServiceRoleContext(db, async (tx) => {
        const existing = await tx
          .select()
          .from(situationalModelEntities)
          .where(
            and(
              eq(situationalModelEntities.tenantId, input.tenantId),
              eq(situationalModelEntities.kind, input.kind),
              eq(situationalModelEntities.entityId, input.entityId),
            ),
          )
          .limit(1);
        const prev = existing[0] ? rowToEntity(existing[0]) : null;
        const merged = situationalModelKernel.mergeObservation(prev, input, nowMs);
        const values = {
          tenantId: merged.tenantId,
          kind: merged.kind,
          entityId: merged.entityId,
          label: merged.label,
          attributes: merged.attributes as Record<string, unknown>,
          associations: merged.associations as Record<string, number>,
          referenceCount: merged.referenceCount,
          firstReferencedAt: new Date(merged.firstReferencedAtMs),
          lastReferencedAt: new Date(merged.lastReferencedAtMs),
          updatedAt: new Date(merged.updatedAtMs),
        };
        await tx
          .insert(situationalModelEntities)
          .values(values)
          .onConflictDoUpdate({
            target: [
              situationalModelEntities.tenantId,
              situationalModelEntities.kind,
              situationalModelEntities.entityId,
            ],
            set: {
              label: values.label,
              attributes: values.attributes,
              associations: values.associations,
              referenceCount: values.referenceCount,
              firstReferencedAt: values.firstReferencedAt,
              lastReferencedAt: values.lastReferencedAt,
              updatedAt: values.updatedAt,
            },
          });
        return merged;
      });
    },

    async list(tenantId: string): Promise<ReadonlyArray<SituationEntity>> {
      try {
        return await withServiceRoleContext(db, async (tx) => {
          const rows = await tx
            .select()
            .from(situationalModelEntities)
            .where(eq(situationalModelEntities.tenantId, tenantId));
          return rows.map(rowToEntity);
        });
      } catch (err) {
        logger.warn(
          { tenantId, err: errMsg(err) },
          'estate-mind-store: list failed — degrading to empty',
        );
        return [];
      }
    },

    async remove(tenantId: string, key: SituationEntityKey): Promise<void> {
      const { kind, entityId } = splitKey(key);
      try {
        await withServiceRoleContext(db, async (tx) => {
          await tx
            .delete(situationalModelEntities)
            .where(
              and(
                eq(situationalModelEntities.tenantId, tenantId),
                eq(situationalModelEntities.kind, kind),
                eq(situationalModelEntities.entityId, entityId),
              ),
            );
        });
      } catch (err) {
        logger.warn(
          { tenantId, key, err: errMsg(err) },
          'estate-mind-store: remove failed',
        );
      }
    },
  };
}

// ---------------------------------------------------------------------------
// 2. Gated proposal sink (writes the EXISTING proactive_nudge contract)
// ---------------------------------------------------------------------------

interface DbExecLike {
  execute(query: unknown): Promise<unknown>;
}

function rowsOf(result: unknown): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(result)) return result as ReadonlyArray<Record<string, unknown>>;
  const rows = (result as { rows?: ReadonlyArray<Record<string, unknown>> })?.rows;
  return Array.isArray(rows) ? rows : [];
}

/**
 * Proposal sink over the EXISTING gated proactive path: it writes a
 * `tab_event_log` row with `event_kind='proactive_nudge'` — the same contract
 * `drainProactiveNudges` (proactive-delivery.ts) already surfaces to the owner
 * cockpit inbox. The loop therefore reuses the one already-gated delivery seam;
 * it never invents a new surface and never bypasses the gate.
 *
 * IDEMPOTENT: a proposal is keyed by `proposal_id = '${tenantId}:${proposal.id}'`
 * (drive-keyed, so the same concern coalesces). If an UNDELIVERED row with that
 * proposal_id already exists we refresh its snapshot instead of inserting a
 * duplicate — so a re-tick of an open concern never spams the inbox. Returns
 * `true` when a NEW proposal row was inserted (i.e. surfaced), `false` when the
 * concern was already pending delivery.
 */
export function createTabEventLogProposalSink(
  db: DbExecLike,
  logger: PinoLikeLogger = createPinoLikeLogger('estate-mind-sink'),
): ProposalSink {
  return {
    async propose(proposal: EstateProposal): Promise<boolean> {
      const proposalId = `${proposal.tenantId}:${proposal.id}`;
      const headline = `${proposal.title}: ${proposal.rationale}`.slice(0, 500);
      const snapshot = {
        delivered: false,
        source: 'estate-mind',
        driveId: proposal.driveId,
        urgency: proposal.urgency,
        breachSeverity: proposal.breachSeverity,
        evidenceEntityIds: proposal.evidenceEntityIds,
        proposedAtMs: proposal.proposedAtMs,
      };
      try {
        // Is an undelivered row for this concern already pending?
        const existing = rowsOf(
          await db.execute(sql`
            SELECT id FROM tab_event_log
             WHERE tenant_id  = ${proposal.tenantId}
               AND proposal_id = ${proposalId}
               AND event_kind = 'proactive_nudge'
               AND COALESCE((snapshot ->> 'delivered')::boolean, false) = false
             LIMIT 1
          `),
        );
        if (existing.length > 0) {
          // Refresh the latest measurement onto the pending row; no new nudge.
          const id = String(existing[0]?.id ?? '');
          if (id) {
            await db.execute(sql`
              UPDATE tab_event_log
                 SET snapshot = ${JSON.stringify(snapshot)}::jsonb,
                     notes    = ${headline}
               WHERE tenant_id = ${proposal.tenantId} AND id = ${id}
            `);
          }
          return false;
        }
        // Surface a new proactive nudge through the gated drain.
        const rowId = `em_${proposal.tenantId}_${proposal.id}_${proposal.proposedAtMs}`;
        await db.execute(sql`
          INSERT INTO tab_event_log
            (id, tenant_id, proposal_id, persona_id, event_kind, actor,
             transport, snapshot, notes, sequence, created_at)
          VALUES
            (${rowId}, ${proposal.tenantId}, ${proposalId}, ${'mwikila'},
             ${'proactive_nudge'}, ${'cron'}, ${'cron'},
             ${JSON.stringify(snapshot)}::jsonb, ${headline}, ${0}, now())
          ON CONFLICT (id) DO NOTHING
        `);
        return true;
      } catch (err) {
        logger.warn(
          { tenantId: proposal.tenantId, proposalId, err: errMsg(err) },
          'estate-mind-sink: propose failed',
        );
        return false;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// 2b. OrchestratorRequest bridge — the dual sink (Wave 1 conductor, OK-4)
// ---------------------------------------------------------------------------

/**
 * The arbiter-fronted spine entry the EstateMind bridge emits a PROPOSAL
 * into. It is PROPOSAL-NOT-ACTUATION: the implementation records the mapped
 * `OrchestratorRequest` to the audit plane (or a gated proactive sink); it
 * MUST NOT call `orchestrator.think()` or execute any tool. The EstateMind
 * has NO executor handle, so money / licence / deletion stay HITL forever.
 */
export interface OrchestratorProposalSink {
  /** Record a proposal request. Returns true when accepted. Never actuates. */
  proposeRequest(request: OrchestratorRequest): Promise<boolean>;
}

/**
 * Map an `EstateProposal` → an `OrchestratorRequest` (main-loop shape). The
 * request is a PROPOSAL — `userMessage` carries the title + rationale, and
 * `groundingCitationIds` carry the evidence entity ids so the Auditor
 * evidence rail is satisfied. The persona/tier are the resident-MD defaults;
 * the scope is the tenant scope (no actor user — this is a system-initiated
 * note, not a user turn). Pure function.
 */
export function estateProposalToOrchestratorRequest(
  proposal: EstateProposal,
): OrchestratorRequest {
  return {
    threadId: `estate-mind:${proposal.tenantId}:${proposal.id}`,
    userMessage: `${proposal.title}\n\n${proposal.rationale}`,
    scope: {
      kind: 'tenant',
      tenantId: proposal.tenantId,
      actorUserId: 'mwikila',
      roles: ['owner'],
      personaId: 'mr-mwikila-head',
    },
    tier: 'tenant',
    persona: 'mr-mwikila-head',
    groundingCitationIds: proposal.evidenceEntityIds,
    // Evidence-required hard rule — a proposal cites ≥1 evidence id.
    evidenceRequired: true,
  };
}

/**
 * Audit-plane-only default `OrchestratorProposalSink`. It writes the mapped
 * request to the Pino audit log as a PROPOSAL marker and returns true. It
 * NEVER calls `think()` and NEVER executes a tool — the EstateMind stays
 * proposal-only / HITL. The composition root may inject a richer sink (e.g.
 * the gated proactive `ingestSignal` entry) that ALSO does not actuate.
 */
export function createAuditOrchestratorProposalSink(
  logger: PinoLikeLogger = createPinoLikeLogger('estate-mind-spine'),
): OrchestratorProposalSink {
  return {
    async proposeRequest(request: OrchestratorRequest): Promise<boolean> {
      logger.info(
        {
          threadId: request.threadId,
          tier: request.tier,
          persona: request.persona,
          citationCount: request.groundingCitationIds?.length ?? 0,
          actuation: 'none',
        },
        'estate-mind: OrchestratorRequest proposed to spine (proposal-not-actuation, HITL)',
      );
      return true;
    },
  };
}

/**
 * Compose a DUAL `ProposalSink` (OK-4). On `propose(proposal)` it:
 *   (1) keeps the EXISTING proactive_nudge write (rails intact); AND
 *   (2) ADDITIONALLY emits a mapped `OrchestratorRequest` into the
 *       arbiter-fronted spine as a PROPOSAL-not-actuation.
 *
 * HARD RULES:
 *   - The spine emission is wrapped in try/catch so a spine fault still
 *     lets the proactive_nudge succeed (never break the tick).
 *   - The bridge is PROPOSAL-only/HITL — the spine sink must not actuate.
 *   - The proactive_nudge result is the authoritative return (the nudge is
 *     the user-visible surface; the spine emission is additive telemetry).
 */
export function composeDualSink(
  base: ProposalSink,
  spine: OrchestratorProposalSink,
  logger: PinoLikeLogger = createPinoLikeLogger('estate-mind-dual-sink'),
): ProposalSink {
  return {
    async propose(proposal: EstateProposal): Promise<boolean> {
      // (1) The existing gated proactive_nudge write (rails intact). Its
      // result is authoritative for surfacing.
      const surfaced = await base.propose(proposal);

      // (2) ADDITIVE — emit the OrchestratorRequest proposal into the spine.
      // A spine fault is swallowed so it can never break the tick.
      try {
        const request = estateProposalToOrchestratorRequest(proposal);
        await spine.proposeRequest(request);
      } catch (err) {
        logger.warn(
          { tenantId: proposal.tenantId, proposalId: proposal.id, err: errMsg(err) },
          'estate-mind-dual-sink: spine emission failed — nudge unaffected',
        );
      }

      return surfaced;
    },
  };
}

// ---------------------------------------------------------------------------
// 2c. The RECONCILE engine — the DEFERRAL / FOLLOW-THROUGH sweep (never-drop-
//     a-thread). Composes the durable md_commitments store + the EXISTING gated
//     proposal sink + the LIVE reminder ladder (cockpit / reminders SMS+email /
//     mwikila_actions_inbox safe-halt / mining_escalations) — no new channel.
// ---------------------------------------------------------------------------

const RUNG_TTL_MS = 24 * 60 * 60 * 1000; // safe-halt proposal_ttl horizon (24h)

/**
 * Build the LIVE ladder dispatchers. Each rung composes an EXISTING channel
 * via a best-effort SQL write (every dispatcher is wrapped — a channel outage
 * or a constraint mismatch degrades, it never breaks the sweep). The
 * dispatchers run OUT OF BAND, so each write is service-role-scoped.
 *
 *   rung 0  in-app   → publishCockpitEvent('mwikila.proposes')
 *   rung 1  email    → a `reminders` row (channel='email'); the existing
 *                      reminders-dispatch worker delivers it (quiet-hours aware)
 *   rung 2  SMS      → a `reminders` row (channel='sms'); same worker, SMS path
 *   rung 3  owner-   → a `mwikila_actions_inbox` SAFE-HALT row (status='proposed'
 *           direct     + proposal_ttl_at). For a sovereign commitment this is
 *                      surface-and-wait — NEVER auto-executed.
 *   rung 4  escalate → a `mining_escalations` row (owner severity).
 */
function createLiveLadderDispatchers(
  db: DbExecLike,
  logger: PinoLikeLogger,
): LadderDispatchers {
  async function exec(query: unknown, label: string, c: MdCommitment): Promise<void> {
    try {
      await db.execute(query);
    } catch (err) {
      logger.warn(
        { commitmentId: c.id, rung: label, err: errMsg(err) },
        'estate-mind-ladder: dispatch write failed (swallowed)',
      );
    }
  }

  function reminderRow(c: MdCommitment, channel: 'email' | 'sms'): unknown {
    const idem = `mdc:${c.id}:rung:${channel}:${c.attemptCount}`;
    const rowId = `mdc_${c.id}_${channel}_${c.attemptCount}`;
    return sql`
      INSERT INTO reminders
        (id, tenant_id, owner_id, title, body, trigger_at, channel, status,
         payload, idempotency_key)
      VALUES
        (${rowId}, ${c.tenantId}, ${c.ownerId}, ${c.title}, ${c.rationale},
         now(), ${channel}, 'scheduled',
         ${JSON.stringify({ source: 'md-commitment', commitmentId: c.id })}::jsonb,
         ${idem})
      ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
    `;
  }

  return {
    async inApp(c) {
      // The proactive tray. Publish through the in-process cockpit bus; a
      // listener-less emit is a harmless no-op.
      try {
        publishCockpitEvent({
          kind: 'mwikila.proposes',
          tenantId: c.tenantId,
          emittedAt: new Date().toISOString(),
          actionId: c.id,
          actionKind: c.kind,
          category: 'contract-followups',
          delegationTier: 'T0',
          summary: c.title,
        });
      } catch (err) {
        logger.warn(
          { commitmentId: c.id, err: errMsg(err) },
          'estate-mind-ladder: in-app publish failed (swallowed)',
        );
      }
    },
    async email(c) {
      await exec(reminderRow(c, 'email'), 'email', c);
    },
    async sms(c) {
      await exec(reminderRow(c, 'sms'), 'sms', c);
    },
    async ownerDirectSafeHalt(c) {
      // SAFE-HALT — surface to the mwikila_actions_inbox and WAIT. The row is
      // `proposed` with a proposal_ttl; it is NEVER auto-executed. TTL expiry
      // parks it (expired) and re-surfaces — it does not auto-file (0129 model).
      const ttl = new Date(Date.now() + RUNG_TTL_MS).toISOString();
      const category = c.sovereign
        ? 'compliance-filings'
        : 'contract-followups';
      await exec(
        sql`
          INSERT INTO mwikila_actions_inbox
            (tenant_id, acting_on_user_id, action_kind, category,
             delegation_tier, status, summary, summary_sw, rationale,
             payload, proposal_ttl_at, provenance)
          SELECT ${c.tenantId}, ${c.ownerId}, ${`commitment.${c.kind}`},
                 ${category}, 'T1', 'proposed', ${c.title}, ${c.titleSw},
                 ${c.rationale},
                 ${JSON.stringify({ commitmentId: c.id, sovereign: c.sovereign })}::jsonb,
                 ${ttl}::timestamptz,
                 ${JSON.stringify({ via: 'md-commitment-safe-halt' })}::jsonb
           WHERE EXISTS (SELECT 1 FROM users WHERE id = ${c.ownerId})
             AND NOT EXISTS (
               SELECT 1 FROM mwikila_actions_inbox
                WHERE tenant_id = ${c.tenantId}
                  AND status = 'proposed'
                  AND payload ->> 'commitmentId' = ${c.id}
             )
        `,
        'owner-direct-safe-halt',
        c,
      );
    },
    async escalate(c) {
      // Top rung — raise the alarm louder via a mining_escalations row
      // broadcast to the owner role. Still never auto-actuates: an overdue
      // sovereign obligation escalates to HITL, it does not auto-file. The
      // table is uuid-typed (tenant_id / raised_by_user_id) and constrains
      // source_kind ∈ {incident,task,crew,production,safety}; we raise it as a
      // 'task' escalation under the tenant owner. The SELECT resolves a real
      // owner uuid so the NOT NULL FK holds; if none resolves the write is a
      // no-op (swallowed) rather than a constraint error.
      const summary = `${c.title} — ${c.rationale}`.slice(0, 1000);
      await exec(
        sql`
          INSERT INTO mining_escalations
            (tenant_id, raised_by_user_id, to_role, source_kind, context_sw,
             severity, status)
          SELECT ${c.tenantId}::uuid, u.id, 'owner', 'task', ${summary},
                 'critical', 'open'
            FROM users u
           WHERE u.tenant_id = ${c.tenantId}
             AND u.id ~ '^[0-9a-fA-F-]{36}$'
             AND NOT EXISTS (
               SELECT 1 FROM mining_escalations e
                WHERE e.tenant_id = ${c.tenantId}::uuid
                  AND e.status = 'open'
                  AND e.context_sw = ${summary}
             )
           LIMIT 1
        `,
        'escalate',
        c,
      );
    },
  };
}

export interface MdCommitmentReconciliationDeps {
  readonly db: (DatabaseClient & DbExecLike) | null;
  readonly logger: PinoLikeLogger;
  /** Evaluates `condition` trigger predicates against estate state. Optional. */
  readonly conditionEvaluator?: ConditionEvaluator | null;
  /** Positive-proof probe for close-the-loop. Optional (nothing auto-closes when absent). */
  readonly confirmationProbe?: ConfirmationProbe | null;
  /** Hash-chained closure/transition audit sink. Optional. */
  readonly auditSink?: CommitmentAuditSink | null;
}

/**
 * Build the durable md_commitments reconcile engine the composition root injects
 * into the EstateMind supervisor. Also returns the repository + the WaitFor
 * event subscriber so the composition root can wire the LedgerService.post
 * credit hook + the blackboard SLOT_DELTA stale-decay seam to flip
 * waiting_for → due. Returns `null` when no db is present (the loop is inert).
 */
export function createMdCommitmentReconciliation(
  deps: MdCommitmentReconciliationDeps,
): {
  readonly reconciliation: ReconciliationPort;
  readonly repository: MdCommitmentRepository;
  readonly eventSubscriber: WaitForEventSubscriber;
} | null {
  if (!deps.db) return null;
  const repository = createDrizzleMdCommitmentRepository(deps.db);
  const ladderDispatchers = createLiveLadderDispatchers(deps.db, deps.logger);
  // The gated proposal sink the reconcile sweep resurfaces through — the EXACT
  // proactive_nudge contract drainProactiveNudges already surfaces.
  const proposalSink = createTabEventLogProposalSink(deps.db, deps.logger);
  // K3 CLOSE-THE-LOOP — the durable positive-proof probe. When the caller does
  // not inject one (the index.ts construction site passes only { db, logger }),
  // build the real durable-evidence probe from the same db so commitments
  // AUTO-CLOSE on proof (a completed mining_tasks row / an executed
  // mwikila_actions_inbox action / a SUCCESS audit_event) — driven by the
  // commitment's kind, never a per-commitment hardcode. Without it the loop
  // re-opens acked-but-unconfirmed items forever (nothing ever closes).
  const confirmationProbe =
    deps.confirmationProbe ??
    createDurableConfirmationProbe({ db: deps.db, logger: deps.logger });
  const reconciliation = createReconcileEngine({
    repo: repository,
    proposalSink,
    ladderDispatchers,
    conditionEvaluator: deps.conditionEvaluator ?? null,
    confirmationProbe,
    auditSink: deps.auditSink ?? null,
    logger: deps.logger,
  });
  const eventSubscriber = createWaitForEventSubscriber({
    repo: repository,
    logger: deps.logger,
  });
  return { reconciliation, repository, eventSubscriber };
}

// ---------------------------------------------------------------------------
// 3. The leader-elected heartbeat supervisor
// ---------------------------------------------------------------------------

export interface EstateMindConfig {
  /** Resolved from BORJIE_ESTATE_MIND once at bootstrap. Default TRUE
   * (FULL-POWERS kill-switch); only an explicit off/0/false/no disables. */
  readonly enabled: boolean;
  /** Tick cadence (ms), clamped to [1m, 6h]. SAFETY bound, not a cap. */
  readonly intervalMs: number;
}

/**
 * Read the EstateMind config from the environment ONCE at bootstrap. Mirrors
 * `initClusterLock`: the flag + interval are resolved here, never per-tick.
 */
export function initEstateMind(
  overrides?: Partial<EstateMindConfig>,
): EstateMindConfig {
  const enabled =
    overrides?.enabled ??
    !['off', '0', 'false', 'no'].includes(
      (process.env.BORJIE_ESTATE_MIND ?? 'on').trim().toLowerCase(),
    );
  const intervalMs = clampInterval(
    overrides?.intervalMs ??
      parsePositiveIntOr(process.env.BORJIE_ESTATE_MIND_INTERVAL_MS, DEFAULT_INTERVAL_MS),
  );
  return { enabled, intervalMs };
}

export interface EstateMindSupervisor {
  start(): void;
  stop(): void;
  /** Run one heartbeat across all active tenants immediately. Never throws. */
  tick(): Promise<number>;
  readonly intervalMs: number;
  readonly enabled: boolean;
}

export interface EstateMindSupervisorDeps {
  /** Drizzle client. Null → inert (start/stop/tick are safe no-ops). */
  readonly db: (DatabaseClient & DbExecLike) | null;
  readonly logger: PinoLikeLogger;
  readonly config: EstateMindConfig;
  /**
   * PERCEIVE source. When omitted the loop only re-evaluates the EXISTING
   * situational state each tick (still surfaces standing-concern breaches),
   * so the heartbeat is useful even before sensors are wired here.
   */
  readonly perception?: PerceptionSource | null;
  /** Override active-tenant discovery (tests). */
  readonly listActiveTenantIds?: () => Promise<ReadonlyArray<string>>;
  /** Override the proposal sink (tests). When set, the dual sink is bypassed. */
  readonly proposalSink?: ProposalSink | null;
  /**
   * OK-4 — the arbiter-fronted spine sink the DUAL sink ALSO emits a mapped
   * `OrchestratorRequest` proposal into (proposal-not-actuation, HITL). When
   * omitted, defaults to the audit-plane recorder. Ignored if `proposalSink`
   * is supplied directly.
   */
  readonly spineSink?: OrchestratorProposalSink | null;
  /** Per-tenant drive thresholds (tenant-tunable risk appetite). */
  readonly thresholds?: motivationKernel.DriveThresholds;
  /**
   * RECONCILE port — the DEFERRAL / FOLLOW-THROUGH sweep over the durable
   * md_commitments backlog. When omitted the EstateMind tick runs exactly as
   * before (the deferral organ is purely additive). The composition root
   * injects the real engine via `createMdCommitmentReconciliation`.
   */
  readonly reconciliation?: ReconciliationPort | null;
}

async function defaultListActiveTenantIds(
  db: DbExecLike,
): Promise<ReadonlyArray<string>> {
  try {
    const result = await db.execute(
      sql`SELECT id FROM tenants WHERE status = 'active'`,
    );
    return rowsOf(result)
      .map((r) => (typeof r.id === 'string' ? r.id : String(r.id ?? '')))
      .filter((s) => s.length > 0);
  } catch {
    return [];
  }
}

/**
 * Build the EstateMind heartbeat supervisor. The returned object has the same
 * `start`/`stop` surface every other gateway supervisor exposes, so the caller
 * wraps it with `withClusterLeader(...)` (only the elected leader ticks) at its
 * `.start()` site — NO index.ts edit beyond that one wrapped call.
 *
 * `start()` is a NO-OP when the flag is explicitly off or the db is null. Under
 * FULL-POWERS the flag defaults ON, so the resident loop is armed by default
 * (leader-gated, propose-only, HITL); set `BORJIE_ESTATE_MIND=off` to disable.
 */
export function createEstateMindSupervisor(
  deps: EstateMindSupervisorDeps,
): EstateMindSupervisor {
  const { config, logger } = deps;
  const intervalMs = config.intervalMs;
  let handle: ReturnType<typeof setInterval> | null = null;
  let inflight = false;

  // Build the kernel organs once (cheap; the situational model is stateless
  // glue over the durable store, so per-tick freshness comes from the DB).
  const kernelLogger = kernelLoggerOf(logger);
  const store: SituationalModelStore | null = deps.db
    ? createDrizzleSituationalModelStore(deps.db, logger)
    : null;
  const situationalModel = store
    ? situationalModelKernel.createSituationalModel({
        store,
        logger: kernelLogger,
      })
    : null;
  const motivation = motivationKernel.createMotivationEngine(
    deps.thresholds ? { thresholds: deps.thresholds } : {},
  );
  // The proposal sink is the DUAL sink (OK-4): the existing gated
  // proactive_nudge write AND an ADDITIVE OrchestratorRequest proposal into
  // the arbiter-fronted spine (proposal-not-actuation, HITL). The spine sink
  // defaults to the audit-plane recorder; the composition root may override
  // `deps.proposalSink` (or `deps.spineSink`) with a richer gated entry.
  const proposalSink =
    deps.proposalSink ??
    (deps.db
      ? composeDualSink(
          createTabEventLogProposalSink(deps.db, logger),
          deps.spineSink ?? createAuditOrchestratorProposalSink(logger),
          logger,
        )
      : null);
  const mind =
    situationalModel &&
    estateMindKernel.createEstateMind({
      situationalModel,
      motivation,
      perception: deps.perception ?? null,
      proposalSink,
      // RECONCILE — the DEFERRAL / FOLLOW-THROUGH sweep (never-drop-a-thread).
      // When omitted the tick runs exactly as before (purely additive); the
      // composition root injects the durable md_commitments reconcile engine.
      reconciliation: deps.reconciliation ?? null,
      logger: kernelLogger,
    });

  async function tick(): Promise<number> {
    if (!config.enabled || !deps.db || !mind) return 0;
    if (inflight) return 0;
    inflight = true;
    try {
      const listActive =
        deps.listActiveTenantIds ?? (() => defaultListActiveTenantIds(deps.db!));
      const tenantIds = await listActive();
      if (tenantIds.length === 0) return 0;
      const outcome = await mind.cycle(tenantIds);
      if (outcome.proposalsEmitted > 0) {
        logger.info(
          { tenants: outcome.tenants, proposals: outcome.proposalsEmitted },
          'estate-mind: heartbeat surfaced proposals',
        );
      }
      return outcome.proposalsEmitted;
    } catch (err) {
      logger.error({ err: errMsg(err) }, 'estate-mind: heartbeat tick failed');
      return 0;
    } finally {
      inflight = false;
    }
  }

  return {
    intervalMs,
    enabled: config.enabled,
    start(): void {
      if (handle) return;
      if (!config.enabled) {
        logger.info({}, 'estate-mind: disabled (BORJIE_ESTATE_MIND off) — no-op');
        return;
      }
      if (!deps.db) {
        logger.warn({}, 'estate-mind: no db — supervisor is a no-op');
        return;
      }
      // First tick immediately so a leader sees the loop is alive in the log.
      void tick();
      handle = setInterval(() => void tick(), intervalMs);
      if (typeof handle.unref === 'function') handle.unref();
      logger.info({ intervalMs }, 'estate-mind: heartbeat started');
    },
    stop(): void {
      if (!handle) return;
      clearInterval(handle);
      handle = null;
      logger.info({}, 'estate-mind: heartbeat stopped');
    },
    tick,
  };
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function parsePositiveIntOr(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function clampInterval(ms: number): number {
  return Math.min(MAX_INTERVAL_MS, Math.max(MIN_INTERVAL_MS, Math.floor(ms)));
}
