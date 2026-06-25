/**
 * workforce-deps-wiring.ts — composes the REAL `WorkforceDeps` so the
 * workforce-orchestrator's `assignTask()` finally fires.
 *
 * THE DARK SYNAPSE THIS LIGHTS
 * ----------------------------
 * `assignTask(deps, input)` (packages/workforce-orchestrator/src/assign-task.ts)
 * is exported with ZERO callers because its `WorkforceDeps` was never
 * composed against the real DB + notifications. assignTask ALREADY derives
 * the risk tier, schedules followups, fires the kickoff `channel.send()`
 * push, and audits — so building these five adapters lights up
 * assign + deliver + guide in ONE dispatch call. This module is the
 * single composition seam for that bundle.
 *
 * FILE LAYOUT (file-size rule — each unit <800 lines)
 * ---------------------------------------------------
 *   - ./workforce-db-helpers.ts     — the narrow db seam + row/RLS helpers.
 *   - ./workforce-store-adapter.ts  — the WorkforceStore over the LIVE
 *                                     substrate (employees + mining_tasks).
 *   - ./workforce-degraded-deps.ts  — the db===null fail-safe twins.
 *   - THIS file                     — channel / audit / content / tickets
 *                                     adapters + the `createWorkforceDeps`
 *                                     bundle (the single seam index.ts wires).
 *
 * CONTRACT SURPRISE (adapted + noted — see ./workforce-store-adapter.ts)
 * --------------------------------------------------------------------
 * The orchestrator package ships its OWN tables (work_assignments /
 * work_followups …, migrations 0241-0250) + its OWN Employee shape; NONE
 * were migrated into this repo. The store maps onto the REAL substrate the
 * spine already closes against: getEmployee → `employees`, insertAssignment →
 * `mining_tasks` (the table the workforce-mobile inbox lists AND the
 * /:id/complete loop closes against), insertFollowup → honest-degrade log.
 *
 * HARD RAILS (CLAUDE.md)
 * ----------------------
 *   - RLS FORCE: the cron/system path runs every write under
 *     `withServiceRoleContext` (no request middleware binds the GUC). Every
 *     query is ALSO explicitly tenant-scoped in SQL as defence in depth.
 *   - Pino-shim logger only; NO console.*.
 *   - Immutability: every mapped row is a fresh object; never mutate input.
 *   - Honest degrade: a missing rail logs + returns a safe value, never throws
 *     into assignTask's best-effort kickoff path.
 */

import { sql } from 'drizzle-orm';
import {
  type AuditChain,
  type ChannelAdapter,
  type ContentGenerator,
  type TicketCreator,
  type WorkforceDeps,
  type WorkforceStore,
} from '@borjie/workforce-orchestrator';
import type { PinoLikeLogger } from '../../utils/pino-shim.js';
import { createPinoLikeLogger } from '../../utils/pino-shim.js';
import {
  createDegradedAudit,
  createDegradedStore,
  createDegradedTickets,
} from './workforce-degraded-deps.js';
import { createWorkforceStore } from './workforce-store-adapter.js';
import { resolveEscalationContextEn } from '../escalation-context.js';
import {
  asNullableString,
  cryptoRandomId,
  errMsg,
  rowsOf,
  sha256Hex,
  withCtx,
  type DatabaseClient,
  type DbExecLike,
} from './workforce-db-helpers.js';

/** Notifications push port — the in-app deliver synapse (app_push rail). */
export interface NotificationsPort {
  /**
   * Enqueue one in-app push into `notification_dispatch_log` (the EXACT
   * idempotent contract the dispatcher-worker drains via push/email/SMS).
   * Returns whether the row was accepted. Best-effort: never throws.
   */
  enqueueAppPush(input: {
    readonly tenantId: string;
    readonly userId: string | null;
    readonly templateKey: string;
    readonly payload: Record<string, unknown>;
    readonly idempotencyKey: string;
    readonly correlationId: string;
  }): Promise<{ accepted: boolean }>;
}

// Re-export the store + helpers so existing import sites (and index.ts) can
// reach them from the single wiring entry point.
export { createWorkforceStore } from './workforce-store-adapter.js';
export type { DbExecLike } from './workforce-db-helpers.js';

// ─────────────────────────────────────────────────────────────────────
// ChannelAdapter — the DELIVER-IN-APP synapse (app_push rail).
// ─────────────────────────────────────────────────────────────────────

/**
 * Build the channel adapter over the real `notification_dispatch_log` push
 * rail (the EXACT idempotent contract the dispatcher-worker drains). This is
 * THE deliver-in-app synapse: assignTask calls `channel.send()` for the
 * kickoff, and workforce-mobile already has the task inbox + offline sync, so
 * this single adapter lights delivery end-to-end. Honest-degrade to a Pino
 * log sink when notifications are unavailable (never throws).
 */
export function createWorkforceChannelAdapter(args: {
  readonly notifications: NotificationsPort | null;
  readonly logger: PinoLikeLogger;
}): ChannelAdapter {
  const { notifications, logger } = args;
  return {
    async send(input) {
      if (notifications === null) {
        logger.warn(
          {
            tenantId: input.tenantId,
            employeeId: input.employeeId,
            template: input.template,
            organ: 'workforce-channel',
          },
          'workforce-channel: notifications unavailable — kickoff push logged only (honest-degrade, never thrown)',
        );
        return { delivered: false };
      }
      try {
        const assignmentId =
          typeof input.payload.assignmentId === 'string'
            ? input.payload.assignmentId
            : input.employeeId;
        const result = await notifications.enqueueAppPush({
          tenantId: input.tenantId,
          userId: input.employeeId || null,
          templateKey: input.template,
          payload: input.payload,
          // Idempotent by (assignment, employee, template) so a re-fired
          // kickoff coalesces instead of double-pushing the worker inbox.
          idempotencyKey: `workforce:${input.template}:${assignmentId}:${input.employeeId}`,
          correlationId: `workforce-assignment:${assignmentId}`,
        });
        return result.accepted
          ? { delivered: true, messageId: `ndl:${assignmentId}` }
          : { delivered: false };
      } catch (err) {
        logger.warn(
          {
            tenantId: input.tenantId,
            employeeId: input.employeeId,
            err: errMsg(err),
          },
          'workforce-channel: enqueueAppPush failed (honest-degrade → not delivered)',
        );
        return { delivered: false };
      }
    },
  };
}

/**
 * Default `NotificationsPort` over `notification_dispatch_log`. Mirrors the
 * monthly-close + announcement-fanout INSERT exactly (same columns, same
 * ON CONFLICT (tenant_id, idempotency_key) DO NOTHING idempotency).
 */
export function createDispatchLogNotificationsPort(args: {
  readonly db: DatabaseClient;
  readonly logger: PinoLikeLogger;
}): NotificationsPort {
  const { db, logger } = args;
  return {
    async enqueueAppPush(input) {
      try {
        let enqueued = 0;
        await withCtx(db, async (tx) => {
          const exec = (tx as unknown as DbExecLike).execute.bind(
            tx as unknown as DbExecLike,
          );
          if (!input.userId) return;
          // Resolve the user's ACTIVE Expo device tokens. The push rail must
          // deliver to a real ExponentPushToken[...] — NOT 'user:<id>', which
          // Expo rejects as DeviceNotRegistered → non-retryable dead-letter
          // (so app_push could NEVER be delivered before this fix). Emit one
          // dispatch row per registered device. tenant_id is uuid here, so
          // compare as text to avoid a cast failure on the resolved id.
          const res = await exec(sql`
            SELECT expo_push_token
              FROM device_push_tokens
             WHERE tenant_id::text = ${input.tenantId}
               AND user_id = ${input.userId}
               AND expo_push_token IS NOT NULL
               AND revoked_at IS NULL
          `);
          const tokens = Array.from(
            new Set(
              rowsOf(res)
                .map((r) => asNullableString(r.expo_push_token))
                .filter((t): t is string => !!t && t.length > 0),
            ),
          );
          for (const token of tokens) {
            const id = `ndl_${cryptoRandomId()}`;
            // Per-device idempotency: one dedupe slot per (key, token) so a
            // user with N devices gets N rows without colliding.
            const idem = `${input.idempotencyKey}::${token}`;
            await exec(sql`
              INSERT INTO notification_dispatch_log (
                id, tenant_id, user_id, channel, recipient_address,
                template_key, locale, payload, correlation_id, idempotency_key,
                attempt_count, delivery_status, created_at, updated_at
              ) VALUES (
                ${id}, ${input.tenantId}, ${input.userId}, 'app_push', ${token},
                ${input.templateKey}, 'en',
                ${JSON.stringify(input.payload)}::jsonb,
                ${input.correlationId}, ${idem},
                0, 'pending', NOW(), NOW()
              )
              ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
            `);
            enqueued += 1;
          }
        });
        if (enqueued === 0) {
          // No registered device — nothing to deliver. Honest: not accepted
          // (the prior code claimed acceptance then dead-lettered silently).
          logger.info(
            { tenantId: input.tenantId, userId: input.userId },
            'workforce-notifications: no active device token — app_push not enqueued',
          );
          return { accepted: false };
        }
        return { accepted: true };
      } catch (err) {
        logger.warn(
          {
            tenantId: input.tenantId,
            userId: input.userId,
            err: errMsg(err),
          },
          'workforce-notifications: dispatch-log enqueue failed (honest-degrade → not accepted)',
        );
        return { accepted: false };
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// AuditChain — append over the hash-chained ai_audit_chain.
// ─────────────────────────────────────────────────────────────────────

/**
 * Build the audit-chain adapter. Appends a hash-chained `ai_audit_chain`
 * row exactly as `tasks.hono.ts` does (per-tenant monotonic sequence_id,
 * prev_hash → this_hash sha256 stitch). assignTask audits
 * 'workforce.assign_task' BEFORE inserting the row so the chain id stamps
 * onto the assignment. Returns the new chain row id.
 */
export function createWorkforceAuditChain(args: {
  readonly db: DatabaseClient;
  readonly logger: PinoLikeLogger;
}): AuditChain {
  const { db, logger } = args;
  return {
    async append(entry) {
      const id = cryptoRandomId();
      const turnId = entry.turnId ?? id;
      const canonical = JSON.stringify({
        tenantId: entry.tenantId,
        turnId,
        action: entry.action,
        payload: entry.payload,
      });
      try {
        await withCtx(db, async (tx) => {
          const exec = (tx as unknown as DbExecLike).execute.bind(
            tx as unknown as DbExecLike,
          );
          const head = rowsOf(
            await exec(sql`
              SELECT COALESCE(MAX(sequence_id), 0) AS max_seq,
                     (SELECT this_hash FROM ai_audit_chain
                      WHERE tenant_id = ${entry.tenantId}
                      ORDER BY sequence_id DESC LIMIT 1) AS last_hash
              FROM ai_audit_chain
              WHERE tenant_id = ${entry.tenantId}
            `),
          )[0] ?? {};
          const sequenceId = Number(head.max_seq ?? 0) + 1;
          const prevHash =
            typeof head.last_hash === 'string' ? head.last_hash : '';
          const thisHash = await sha256Hex(prevHash + canonical);
          await exec(sql`
            INSERT INTO ai_audit_chain (
              id, tenant_id, sequence_id, turn_id, action,
              prev_hash, this_hash, payload, created_at
            ) VALUES (
              ${id}, ${entry.tenantId}, ${sequenceId}, ${turnId}, ${entry.action},
              ${prevHash}, ${thisHash},
              ${JSON.stringify({ payload: entry.payload })}::jsonb,
              ${new Date().toISOString()}
            )
          `);
        });
        return { chainId: id };
      } catch (err) {
        // assignTask awaits the audit append BEFORE the row insert; a fault
        // must not abort the assignment. Honest-degrade: return a synthetic
        // chain id and log — the durable spine write (the task) still lands.
        logger.warn(
          { tenantId: entry.tenantId, action: entry.action, err: errMsg(err) },
          'workforce-audit: ai_audit_chain append failed (honest-degrade → synthetic chainId; assignment still persists)',
        );
        return { chainId: id };
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// ContentGenerator — deterministic on-brand mining coaching stub.
// ─────────────────────────────────────────────────────────────────────

/**
 * Build the content generator. A real Haiku-cascade coaching adapter can be
 * injected later; the default is a deterministic, mining-coherent,
 * single-language (CLAUDE.md) stub. Never throws.
 */
export function createWorkforceContentGenerator(args: {
  readonly logger: PinoLikeLogger;
}): ContentGenerator {
  const { logger } = args;
  return {
    async generateCoaching(input) {
      const name = input.employee.employeeCode ?? input.employee.id;
      const text =
        input.triggerKind === 'exceptional_recognition'
          ? `Strong work this week, ${name}. Keep the pit running safely and on schedule.`
          : input.triggerKind === 'missed_deadline'
            ? `Let's get back on track, ${name}. Flag any blocker early so the site keeps moving.`
            : `Quick check-in, ${name}. Stay on top of safety and report progress on your assignment.`;
      return { text };
    },
    async inferSentiment(input) {
      // Deterministic neutral baseline — never a fabricated signal.
      const lower = input.text.toLowerCase();
      const score = /good|done|complete|ready|safe/.test(lower)
        ? 0.5
        : /blocked|stuck|broken|unsafe|delay/.test(lower)
          ? -0.5
          : 0;
      return { score };
    },
    async draftAdvisoryBrief() {
      logger.info(
        { organ: 'workforce-content' },
        'workforce-content: advisory-brief drafting not wired to the Haiku cascade — deterministic empty brief (honest-degrade)',
      );
      return {
        gaps: [],
        opportunities: [],
        recommendedActions: [],
        citations: [],
        overallScore: 0,
      };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// TicketCreator — escalation over the mining_escalations substrate.
// ─────────────────────────────────────────────────────────────────────

/**
 * Build the ticket creator over the live `mining_escalations` table (the
 * EXACT substrate the escalations.hono.ts route writes). Maps a workforce
 * escalation to an open escalation addressed at the assignee user. Never
 * throws — returns a synthetic id + logs on fault.
 */
export function createWorkforceTicketCreator(args: {
  readonly db: DatabaseClient;
  readonly logger: PinoLikeLogger;
}): TicketCreator {
  const { db, logger } = args;
  return {
    async createTicket(input) {
      const id = cryptoRandomId();
      const severity =
        input.severity === 'critical' || input.severity === 'high'
          ? 'critical'
          : input.severity === 'low'
            ? 'info'
            : 'warning';
      const narrative = input.title + ' — ' + input.description;
      // Born locale-complete: capture the English narrative in the additive
      // `context` bag so the escalations GET serves a real body to EN owners.
      const contextEn = await resolveEscalationContextEn(narrative, input.tenantId);
      try {
        await withCtx(db, async (tx) => {
          await (tx as unknown as DbExecLike).execute(sql`
            INSERT INTO mining_escalations (
              id, tenant_id, raised_by_user_id, to_user_id, to_role,
              source_kind, source_id, context_sw, severity, status, created_at,
              context
            ) VALUES (
              ${id}, ${input.tenantId}, ${input.assigneeUserId},
              ${input.assigneeUserId}, NULL,
              'task', NULL, ${narrative},
              ${severity}, 'open', NOW(),
              ${JSON.stringify({ contextEn })}::jsonb
            )
            ON CONFLICT (id) DO NOTHING
          `);
        });
        return { ticketId: id };
      } catch (err) {
        logger.warn(
          { tenantId: input.tenantId, err: errMsg(err) },
          'workforce-tickets: mining_escalations insert failed (honest-degrade → synthetic ticketId)',
        );
        return { ticketId: id };
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// The bundle — the single composition seam index.ts wires.
// ─────────────────────────────────────────────────────────────────────

export interface CreateWorkforceDepsArgs {
  /**
   * Drizzle client. Null → fully degraded: getEmployee returns null (so
   * assignTask throws a clear "employee not found"), nothing is persisted,
   * and the channel logs only. Production passes the shared client.
   */
  readonly db: DatabaseClient | null;
  /**
   * Notifications push port. Null → channel honest-degrades to a log sink.
   * Default production binding is the dispatch-log port over the same db.
   */
  readonly notifications?: NotificationsPort | null;
  /** Optional Haiku-cascade content generator override (else deterministic). */
  readonly content?: ContentGenerator;
  /** Optional audit chain override (else the hash-chained ai_audit_chain). */
  readonly auditChain?: AuditChain;
  readonly logger?: PinoLikeLogger;
  /** Injected clock (a Date). Default: a real wall clock. */
  readonly clock?: () => Date;
  /** Injected uuid. Default: crypto.randomUUID. */
  readonly uuid?: () => string;
}

/**
 * Compose the REAL `WorkforceDeps` — the dark synapse, lit. One call binds
 * store (mining_tasks + employees) · channel (notification_dispatch_log
 * app_push) · audit (ai_audit_chain) · content (deterministic) · tickets
 * (mining_escalations) plus the injected clock/uuid, so
 * `assignTask(workforceDeps, input)` finally fires end-to-end.
 *
 * Degraded mode (db === null): the store + channel honest-degrade and the
 * boot log records it — the bundle never crashes composition.
 */
export function createWorkforceDeps(
  args: CreateWorkforceDepsArgs,
): WorkforceDeps {
  const logger = args.logger ?? createPinoLikeLogger('workforce-deps');
  const db = args.db;
  const clock = args.clock ?? (() => new Date());
  const uuid =
    args.uuid ??
    (() =>
      globalThis.crypto?.randomUUID?.() ??
      `wf_${Date.now()}_${Math.random().toString(36).slice(2)}`);

  if (db === null) {
    logger.warn(
      { wiring: 'workforce-deps' },
      'workforce-deps: db is null — WorkforceDeps composed in DEGRADED mode (no persistence; getEmployee → null; channel logs only)',
    );
  }

  const notifications =
    args.notifications !== undefined
      ? args.notifications
      : db
        ? createDispatchLogNotificationsPort({ db, logger })
        : null;

  const store: WorkforceStore = db
    ? createWorkforceStore({ db, logger })
    : createDegradedStore(logger);

  const audit: AuditChain =
    args.auditChain ??
    (db
      ? createWorkforceAuditChain({ db, logger })
      : createDegradedAudit(logger, uuid));

  const tickets: TicketCreator = db
    ? createWorkforceTicketCreator({ db, logger })
    : createDegradedTickets(logger, uuid);

  const deps: WorkforceDeps = {
    store,
    channel: createWorkforceChannelAdapter({ notifications, logger }),
    audit,
    content: args.content ?? createWorkforceContentGenerator({ logger }),
    tickets,
    clock,
    uuid,
  };

  logger.info(
    {
      wiring: 'workforce-deps',
      storeBacked: Boolean(db),
      channelBacked: Boolean(notifications),
      assignmentTable: 'mining_tasks',
      deliverRail: 'notification_dispatch_log(app_push)',
      auditTable: 'ai_audit_chain',
      ticketTable: 'mining_escalations',
    },
    'workforce-deps: WorkforceDeps composed — assignTask() can now fire (assign → deliver → guide in one dispatch); the dark synapse is lit',
  );

  return deps;
}
