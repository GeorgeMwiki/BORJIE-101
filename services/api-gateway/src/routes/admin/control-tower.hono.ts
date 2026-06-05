/**
 * /api/v1/admin/control-tower — cross-tenant Control-Tower toggles wired to
 * REAL platform state (WS-5).
 *
 * The admin Control Tower (apps/admin-web .../control-tower) exposes five
 * cross-tenant levers. This route makes each one drive a real backend control
 * instead of local React state:
 *
 *   global-kill        -> platform killswitch-write service   (scope=platform,
 *                         level halt/live; FAIL-CLOSED — write errors surface)
 *   jr-autonomy        -> platform feature flag junior_agent_autonomy   (global)
 *   predictions-mode   -> platform feature flag predictions_append_mode (global)
 *   webhook-rate-cap   -> autonomy-settings webhook_rate_cap_per_min
 *   embed-throttle     -> autonomy-settings embed_token_throttle_per_min
 *
 * Four-eye gating reuses the admin-superpowers pattern: a HIGH-impact toggle
 * lands as a `pending_approval` undo_journal row and does NOT mutate real state
 * until a SECOND admin approves via `/toggle/:journalId/approve`. The approval
 * endpoint is where the real mutation runs. LOW-impact toggles (the two rate
 * caps) apply immediately but still record a journal row + a SOC2 security
 * event.
 *
 * Every toggle attempt emits a `platform.control_tower.toggle` SecurityEvent
 * (SOC 2 CC7.2 / GDPR Art.30) via withSecurityEvents.
 *
 * Routes:
 *   GET  /controls                          read the persisted state of each toggle
 *   POST /toggle                            propose a toggle change
 *   POST /toggle/:journalId/approve         second-eye approval (real mutation)
 *
 * Auth: Supabase JWT + requireRole(SUPER_ADMIN | ADMIN). SUPPORT is excluded —
 * these levers are cross-tenant and irreversible-adjacent, unlike the read-only
 * SUPPORT scope on the superpowers route.
 *
 * HARD RULES honoured:
 *   - Kill-switch is FAIL-CLOSED: a killswitch write error is NEVER swallowed —
 *     the approval returns 500 CONTROL_APPLY_FAILED and the journal row stays
 *     pending_approval (not flipped to applied).
 *   - HIGH-risk policy prefix (kill_switch / four_eye): literal control rules,
 *     no generalisation — each controlId maps to one explicit apply function.
 */

import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';

import {
  undoJournal,
  createPlatformKillswitchWriteService,
  createPlatformFeatureFlagsService,
  createPlatformAutonomySettingsService,
  PLATFORM_AUTONOMY_SETTING_KEYS,
} from '@borjie/database';
import { withSecurityEvents } from '@borjie/observability';
import { authMiddleware, requireRole } from '../../middleware/hono-auth';
import { databaseMiddleware } from '../../middleware/database';
import { createLogger } from '../../utils/logger';
import { UserRole } from '../../types/user-role';

const moduleLogger = createLogger('admin-control-tower');

// ─── Control registry — explicit, literal mapping (no generalisation) ────────

type ControlImpact = 'high' | 'low';

interface ControlSpec {
  readonly id: string;
  readonly title: string;
  /** high => four-eye gated; low => apply immediately (still audited). */
  readonly impact: ControlImpact;
  /** Which backend the toggle drives (for the read + audit detail). */
  readonly backend: 'killswitch' | 'feature_flag' | 'autonomy_setting';
}

/**
 * The five Control-Tower levers. The order + ids match the admin-web client so
 * the UI can hydrate `GET /controls` directly onto its rows.
 */
const CONTROLS: ReadonlyArray<ControlSpec> = Object.freeze([
  { id: 'global-kill', title: 'Global platform kill-switch', impact: 'high', backend: 'killswitch' },
  { id: 'jr-autonomy', title: 'Junior agent autonomy', impact: 'high', backend: 'feature_flag' },
  { id: 'predictions-mode', title: 'Predictions append mode', impact: 'high', backend: 'feature_flag' },
  { id: 'webhook-rate-cap', title: 'Outbound webhook rate cap', impact: 'low', backend: 'autonomy_setting' },
  { id: 'embed-throttle', title: 'Embeddings token throttle', impact: 'low', backend: 'autonomy_setting' },
]);

const CONTROL_BY_ID: ReadonlyMap<string, ControlSpec> = new Map(
  CONTROLS.map((c) => [c.id, c]),
);

const FEATURE_FLAG_KEYS: Readonly<Record<string, string>> = Object.freeze({
  'jr-autonomy': 'junior_agent_autonomy',
  'predictions-mode': 'predictions_append_mode',
});

const AUTONOMY_KEYS: Readonly<Record<string, string>> = Object.freeze({
  'webhook-rate-cap': PLATFORM_AUTONOMY_SETTING_KEYS.WEBHOOK_RATE_CAP,
  'embed-throttle': PLATFORM_AUTONOMY_SETTING_KEYS.EMBED_THROTTLE,
});

const CONTROL_IDS = CONTROLS.map((c) => c.id) as [string, ...string[]];

// ─── Schemas ─────────────────────────────────────────────────────────────────

const toggleSchema = z.object({
  controlId: z.enum(CONTROL_IDS),
  desiredState: z.enum(['on', 'off']),
  /** Numeric ceiling for rate-cap controls; ignored for the others. */
  intValue: z.number().int().min(0).max(10_000_000).optional(),
  reason: z.string().min(8).max(2000),
});

const approveSchema = z.object({
  decisionNote: z.string().min(1).max(2000).optional(),
});

// ─── Service resolution ──────────────────────────────────────────────────────

/**
 * Structural shapes of the three platform write services the route drives. We
 * duck-type so the route can accept either pre-built services off
 * `c.get('services')` (future registry wiring / tests) OR construct them from
 * the request-scoped Drizzle client (the default production path, mirroring how
 * killswitch.hono.ts builds applyKillswitch directly from `db`).
 */
interface KillswitchWriteLike {
  writeKillswitch(args: {
    scope: 'platform' | `tenant:${string}`;
    level: 'live' | 'degraded' | 'halt';
    reasonCode: string;
    note: string | null;
  }): Promise<unknown>;
}
interface FeatureFlagWriteLike {
  setFlag(args: {
    flagName: string;
    value: boolean;
    scope: 'global' | `tenant:${string}`;
  }): Promise<unknown>;
}
interface AutonomyWriteLike {
  setSetting(args: {
    settingKey: string;
    enabled: boolean;
    intValue: number | null;
    note: string | null;
  }): Promise<unknown>;
}

interface ControlServices {
  readonly killswitch: KillswitchWriteLike;
  readonly featureFlags: FeatureFlagWriteLike;
  readonly autonomy: AutonomyWriteLike;
}

/**
 * Resolve the three backing services. Prefers pre-built instances on
 * `c.get('services')` (slots `platformKillswitchWrite` / `platformFeatureFlagsWrite`
 * / `platformAutonomySettings`); otherwise constructs them from the
 * request-scoped db with the acting admin id as the audit actor.
 */
function resolveControlServices(
  c: any,
  actorId: string,
): ControlServices {
  const bag = (c.get('services') ?? {}) as Record<string, unknown>;
  const db = c.get('db');
  const resolveActor = () => actorId;

  const killswitch =
    (bag.platformKillswitchWrite as KillswitchWriteLike | undefined) ??
    (createPlatformKillswitchWriteService(db, {
      resolveActor,
    }) as unknown as KillswitchWriteLike);

  const featureFlags =
    (bag.platformFeatureFlagsWrite as FeatureFlagWriteLike | undefined) ??
    (createPlatformFeatureFlagsService(db, {
      resolveActor,
    }) as unknown as FeatureFlagWriteLike);

  const autonomy =
    (bag.platformAutonomySettings as AutonomyWriteLike | undefined) ??
    (createPlatformAutonomySettingsService(db, {
      resolveActor,
    }) as unknown as AutonomyWriteLike);

  return { killswitch, featureFlags, autonomy };
}

/**
 * Apply a control's desired state to its REAL backend. Throws on backend
 * failure — callers MUST let it propagate (kill-switch fail-closed). Returns a
 * small detail object recorded on the journal + security event.
 */
async function applyControl(
  services: ControlServices,
  spec: ControlSpec,
  desiredState: 'on' | 'off',
  intValue: number | null,
  reason: string,
): Promise<Record<string, unknown>> {
  if (spec.backend === 'killswitch') {
    // global-kill ON => platform HALT; OFF => platform live.
    const level = desiredState === 'on' ? 'halt' : 'live';
    await services.killswitch.writeKillswitch({
      scope: 'platform',
      level,
      reasonCode: 'KILLSWITCH_HALT',
      note: reason.slice(0, 500),
    });
    return { backend: 'killswitch', scope: 'platform', level };
  }

  if (spec.backend === 'feature_flag') {
    const flagName = FEATURE_FLAG_KEYS[spec.id];
    if (!flagName) {
      throw new Error(`control-tower: no feature flag mapped for ${spec.id}`);
    }
    await services.featureFlags.setFlag({
      flagName,
      value: desiredState === 'on',
      scope: 'global',
    });
    return { backend: 'feature_flag', flagName, value: desiredState === 'on' };
  }

  // autonomy_setting (rate caps / throttle)
  const settingKey = AUTONOMY_KEYS[spec.id];
  if (!settingKey) {
    throw new Error(`control-tower: no autonomy setting mapped for ${spec.id}`);
  }
  await services.autonomy.setSetting({
    settingKey,
    enabled: desiredState === 'on',
    intValue: intValue ?? null,
    note: reason.slice(0, 500),
  });
  return {
    backend: 'autonomy_setting',
    settingKey,
    enabled: desiredState === 'on',
    intValue: intValue ?? null,
  };
}

// ─── App ─────────────────────────────────────────────────────────────────────

const app = new Hono();
app.use('*', authMiddleware);
app.use('*', requireRole(UserRole.SUPER_ADMIN, UserRole.ADMIN));
app.use('*', databaseMiddleware);

function dbUnavailable(c: any) {
  return c.json(
    {
      success: false,
      error: {
        code: 'CONTROL_TOWER_DB_UNAVAILABLE',
        message: 'Database not configured',
      },
    },
    503,
  );
}

// GET /controls — read the persisted state of each toggle so the admin UI
// hydrates real state (not mock React state).
app.get('/controls', async (c: any) => {
  const db = c.get('db');
  if (!db) return dbUnavailable(c);
  const auth = c.get('auth') as { userId: string };

  // Read-side services (actor only used for write columns; harmless here).
  const bag = (c.get('services') ?? {}) as Record<string, unknown>;
  const ksRead = bag.platformKillswitchWrite as
    | { readCurrent?: (s: string) => Promise<{ level?: string } | null> }
    | undefined;
  const ffRead = bag.platformFeatureFlagsWrite as
    | { read?: (f: string) => Promise<{ globalValue?: unknown } | null> }
    | undefined;
  const asRead = bag.platformAutonomySettings as
    | { readSetting?: (k: string) => Promise<{ enabled?: boolean; intValue?: number | null } | null> }
    | undefined;

  const killswitch = ksRead ?? createPlatformKillswitchWriteService(db, { resolveActor: () => auth.userId });
  const featureFlags = ffRead ?? createPlatformFeatureFlagsService(db, { resolveActor: () => auth.userId });
  const autonomy = asRead ?? createPlatformAutonomySettingsService(db, { resolveActor: () => auth.userId });

  const controls = await Promise.all(
    CONTROLS.map(async (spec) => {
      const base = { id: spec.id, title: spec.title, impact: spec.impact, backend: spec.backend };
      try {
        if (spec.backend === 'killswitch') {
          const cur = await killswitch.readCurrent?.('platform');
          // ON (kill engaged) when platform level is halt.
          return { ...base, state: cur?.level === 'halt' ? 'on' : 'off' };
        }
        if (spec.backend === 'feature_flag') {
          const flagName = FEATURE_FLAG_KEYS[spec.id]!;
          const read = await featureFlags.read?.(flagName);
          return { ...base, state: read?.globalValue === true ? 'on' : 'off' };
        }
        const settingKey = AUTONOMY_KEYS[spec.id]!;
        const setting = await autonomy.readSetting?.(settingKey);
        return {
          ...base,
          state: setting?.enabled === false ? 'off' : 'on',
          intValue: setting?.intValue ?? null,
        };
      } catch (err) {
        moduleLogger.warn('control-tower: read failed for control', {
          controlId: spec.id,
          error: err instanceof Error ? err.message : String(err),
        });
        return { ...base, state: 'unknown' };
      }
    }),
  );

  return c.json({ success: true, data: { controls } });
});

// POST /toggle — propose a toggle change.
//
// HIGH-impact controls land as pending_approval (four-eye); the real mutation
// is deferred to the approve endpoint. LOW-impact controls apply immediately.
app.post(
  '/toggle',
  withSecurityEvents(
    {
      action: 'platform.control_tower.toggle',
      resource: 'platform.control_tower',
      severity: 'critical',
    },
    async (c: any) => {
      const auth = c.get('auth') as { tenantId: string; userId: string; role: string };
      const db = c.get('db');
      if (!db) return dbUnavailable(c);

      const raw = await c.req.json().catch(() => null);
      const parsed = toggleSchema.safeParse(raw);
      if (!parsed.success) {
        return c.json(
          {
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid control-tower toggle payload',
              issues: parsed.error.issues,
            },
          },
          400,
        );
      }
      const input = parsed.data;
      const spec = CONTROL_BY_ID.get(input.controlId);
      if (!spec) {
        return c.json(
          {
            success: false,
            error: { code: 'UNKNOWN_CONTROL', message: `Unknown control ${input.controlId}` },
          },
          400,
        );
      }

      const requiresFourEye = spec.impact === 'high';
      const provenanceBase = {
        surface: 'admin-web:control-tower',
        adminRole: auth.role,
        reason: input.reason,
        controlId: spec.id,
        backend: spec.backend,
        desiredState: input.desiredState,
        intValue: input.intValue ?? null,
        requires_four_eye: requiresFourEye,
      };

      if (requiresFourEye) {
        // Defer the real mutation — write the pending journal row only.
        const [row] = await db
          .insert(undoJournal)
          .values({
            tenantId: auth.tenantId,
            actorId: auth.userId,
            entityType: 'platform_control',
            entityId: spec.id,
            actionKind: 'control_toggle',
            toolId: 'admin.ui.control_tower',
            beforeState: null,
            afterState: { controlId: spec.id, desiredState: input.desiredState, intValue: input.intValue ?? null },
            windowSeconds: 300,
            provenance: { ...provenanceBase, status: 'pending_approval' },
          })
          .returning();

        moduleLogger.info('control-tower: toggle proposed (4-eye)', {
          adminId: auth.userId,
          controlId: spec.id,
          desiredState: input.desiredState,
          journalId: row?.id,
        });

        return c.json({
          success: true,
          data: {
            accepted: true,
            requiresFourEye: true,
            status: 'pending_approval',
            journalId: row?.id,
            controlId: spec.id,
            desiredState: input.desiredState,
          },
        });
      }

      // LOW-impact: drive the real backend immediately.
      const services = resolveControlServices(c, auth.userId);
      let applyDetail: Record<string, unknown>;
      try {
        applyDetail = await applyControl(
          services,
          spec,
          input.desiredState,
          input.intValue ?? null,
          input.reason,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        moduleLogger.error('control-tower: low-impact apply failed', {
          adminId: auth.userId,
          controlId: spec.id,
          error: message,
        });
        return c.json(
          {
            success: false,
            error: { code: 'CONTROL_APPLY_FAILED', controlId: spec.id, message },
          },
          500,
        );
      }

      const [row] = await db
        .insert(undoJournal)
        .values({
          tenantId: auth.tenantId,
          actorId: auth.userId,
          entityType: 'platform_control',
          entityId: spec.id,
          actionKind: 'control_toggle',
          toolId: 'admin.ui.control_tower',
          beforeState: null,
          afterState: applyDetail,
          windowSeconds: 300,
          provenance: { ...provenanceBase, status: 'applied', applyDetail },
        })
        .returning();

      moduleLogger.info('control-tower: toggle applied (low-impact)', {
        adminId: auth.userId,
        controlId: spec.id,
        desiredState: input.desiredState,
        journalId: row?.id,
      });

      return c.json({
        success: true,
        data: {
          accepted: true,
          requiresFourEye: false,
          status: 'applied',
          journalId: row?.id,
          controlId: spec.id,
          desiredState: input.desiredState,
          applyDetail,
        },
      });
    },
  ),
);

// POST /toggle/:journalId/approve — second-eye approval. THIS is where a
// HIGH-impact control's real mutation runs. Forbidden if approver == proposer.
app.post(
  '/toggle/:journalId/approve',
  withSecurityEvents(
    {
      action: 'platform.control_tower.approve',
      resource: 'platform.control_tower',
      severity: 'critical',
    },
    async (c: any) => {
      const auth = c.get('auth') as { tenantId: string; userId: string; role: string };
      const db = c.get('db');
      const journalId = c.req.param('journalId');
      if (!db) return dbUnavailable(c);

      const raw = await c.req.json().catch(() => ({}));
      const parsed = approveSchema.safeParse(raw);
      if (!parsed.success) {
        return c.json(
          {
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message: 'Invalid approval payload',
              issues: parsed.error.issues,
            },
          },
          400,
        );
      }

      const [candidate] = await db
        .select()
        .from(undoJournal)
        .where(
          and(eq(undoJournal.id, journalId), eq(undoJournal.tenantId, auth.tenantId)),
        )
        .limit(1);

      if (!candidate) {
        return c.json(
          {
            success: false,
            error: { code: 'NOT_FOUND', message: 'Control-tower journal entry not found' },
          },
          404,
        );
      }
      if (candidate.actorId === auth.userId) {
        return c.json(
          {
            success: false,
            error: {
              code: 'FOUR_EYE_SAME_ACTOR',
              message: 'Approver must differ from the proposing admin',
            },
          },
          409,
        );
      }
      const provenance = (candidate.provenance as Record<string, unknown> | null) ?? {};
      if (provenance.requires_four_eye !== true) {
        return c.json(
          {
            success: false,
            error: {
              code: 'FOUR_EYE_NOT_REQUIRED',
              message: 'This control toggle did not require four-eye approval',
            },
          },
          409,
        );
      }
      if (provenance.status === 'applied') {
        return c.json(
          {
            success: false,
            error: { code: 'ALREADY_APPLIED', message: 'Toggle already approved + applied' },
          },
          409,
        );
      }

      const controlId = String(provenance.controlId ?? candidate.entityId);
      const spec = CONTROL_BY_ID.get(controlId);
      if (!spec) {
        return c.json(
          {
            success: false,
            error: { code: 'UNKNOWN_CONTROL', message: `Unknown control ${controlId}` },
          },
          409,
        );
      }
      const desiredState = provenance.desiredState === 'off' ? 'off' : 'on';
      const intValue =
        typeof provenance.intValue === 'number' ? provenance.intValue : null;
      const reason = typeof provenance.reason === 'string' ? provenance.reason : 'four-eye approved';

      // Run the REAL mutation. FAIL-CLOSED: a backend error (esp. the
      // kill-switch) MUST surface — we do NOT flip the journal to applied and
      // we return 500 so the operator knows the platform state did not change.
      const services = resolveControlServices(c, auth.userId);
      let applyDetail: Record<string, unknown>;
      try {
        applyDetail = await applyControl(services, spec, desiredState, intValue, reason);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        moduleLogger.error('control-tower: approval apply FAILED (fail-closed)', {
          journalId,
          controlId,
          approverId: auth.userId,
          error: message,
        });
        return c.json(
          {
            success: false,
            error: { code: 'CONTROL_APPLY_FAILED', controlId, message },
          },
          500,
        );
      }

      const nextProvenance = {
        ...provenance,
        status: 'applied',
        approved_by_user_id: auth.userId,
        approved_by_role: auth.role,
        approved_at: new Date().toISOString(),
        applyDetail,
        ...(parsed.data.decisionNote !== undefined && {
          approver_note: parsed.data.decisionNote,
        }),
      };

      const [row] = await db
        .update(undoJournal)
        .set({ provenance: nextProvenance })
        .where(eq(undoJournal.id, journalId))
        .returning();

      moduleLogger.info('control-tower: toggle approved + applied (4-eye)', {
        journalId: row?.id ?? journalId,
        controlId,
        proposingActorId: candidate.actorId,
        approvingActorId: auth.userId,
      });

      return c.json({
        success: true,
        data: {
          applied: true,
          journalId: row?.id ?? journalId,
          controlId,
          desiredState,
          applyDetail,
        },
      });
    },
  ),
);

export const adminControlTowerRouter = app;
export default adminControlTowerRouter;
