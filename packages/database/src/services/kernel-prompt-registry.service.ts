/**
 * Kernel prompt registry service — Drizzle adapter for
 * `kernel_prompt_registry` (migration 0148).
 *
 * Central Command Phase D (D5 — Rollout safety). Exposes the small CRUD
 * surface the rollout controller + the admin promote/rollback router
 * call. The service NEVER throws on read paths: a degraded DB collapses
 * to an empty result, and the rollout controller's caller (the kernel)
 * falls back to its hard-coded preamble.
 *
 * Write paths (promote / rollback / register / archive) DO throw on
 * invalid transitions so the admin tool surfaces the failure to the
 * operator immediately — silent no-ops on a rollout API would defeat
 * the whole purpose of the table.
 */
import { randomUUID } from 'crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import {

  kernelPromptRegistry,
  type KernelPromptStatus,
} from '../schemas/kernel-prompt-registry.schema.js';
import { logger } from '../logger.js';
import type { DatabaseClient } from '../client.js';

// ─────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────

export interface PromptVersionRow {
  readonly id: string;
  readonly capability: string;
  readonly version: string;
  readonly promptText: string;
  readonly goldenSetVersion: string;
  readonly status: KernelPromptStatus;
  readonly promotedAt: string;
  readonly promotedBy: string;
  readonly archivedAt: string | null;
  readonly archivedReason: string | null;
  readonly metadata: Readonly<Record<string, unknown>>;
}

export interface RegisterShadowArgs {
  readonly capability: string;
  readonly version: string;
  readonly promptText: string;
  readonly goldenSetVersion: string;
  readonly promotedBy: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface PromoteArgs {
  readonly capability: string;
  readonly version: string;
  readonly toStatus: Extract<KernelPromptStatus, 'canary' | 'canary-25' | 'active'>;
  readonly promotedBy: string;
}

export interface RollbackArgs {
  readonly capability: string;
  readonly reason: string;
  readonly promotedBy: string;
}

export interface RollbackResult {
  readonly previousActive: PromptVersionRow | null;
  readonly restoredActive: PromptVersionRow | null;
}

export interface KernelPromptRegistryService {
  /** Register a brand-new shadow variant. Fails if (capability, version) already exists. */
  registerShadow(args: RegisterShadowArgs): Promise<PromptVersionRow>;
  /** Promote a row from `shadow` → `canary` → `canary-25` → `active`. Validates state machine. */
  promote(args: PromoteArgs): Promise<PromptVersionRow>;
  /**
   * Mark the currently `active` row `archived` (carries `reason`) and
   * restore the most recently archived prior-`active` row back to
   * `active`. Returns both for the operator's audit trail.
   */
  rollback(args: RollbackArgs): Promise<RollbackResult>;
  /** Auto-rollback path from the SLO tracker. Marks `degraded` (held for review). */
  markDegraded(capability: string, version: string, reason: string): Promise<PromptVersionRow | null>;
  /** Read all versions for a capability, ordered by `promoted_at DESC`. */
  listForCapability(capability: string): Promise<ReadonlyArray<PromptVersionRow>>;
  /** Read the row matching `(capability, version)`. */
  findByVersion(capability: string, version: string): Promise<PromptVersionRow | null>;
  /** Read the single `active` row for a capability (or null). */
  findActive(capability: string): Promise<PromptVersionRow | null>;
  /** Read all rows in a canary state (`canary` | `canary-25`) for a capability. */
  findCanaries(capability: string): Promise<ReadonlyArray<PromptVersionRow>>;
  /** Read all `shadow` rows for a capability. */
  findShadows(capability: string): Promise<ReadonlyArray<PromptVersionRow>>;
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

interface DbRowShape {
  readonly id: string;
  readonly capability: string;
  readonly version: string;
  readonly promptText: string;
  readonly goldenSetVersion: string;
  readonly status: string;
  readonly promotedAt: Date | string;
  readonly promotedBy: string;
  readonly archivedAt: Date | string | null;
  readonly archivedReason: string | null;
  readonly metadata: unknown;
}

function toIso(value: Date | string | null): string | null {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return value;
}

function rowToVersion(row: DbRowShape): PromptVersionRow {
  return {
    id: row.id,
    capability: row.capability,
    version: row.version,
    promptText: row.promptText,
    goldenSetVersion: row.goldenSetVersion,
    status: row.status as KernelPromptStatus,
    promotedAt: toIso(row.promotedAt) ?? new Date(0).toISOString(),
    promotedBy: row.promotedBy,
    archivedAt: toIso(row.archivedAt),
    archivedReason: row.archivedReason,
    metadata:
      row.metadata && typeof row.metadata === 'object'
        ? (row.metadata as Readonly<Record<string, unknown>>)
        : {},
  };
}

/**
 * Legal forward transitions for the rollout state machine. The
 * rollback path is a separate operation (it swaps `active` to
 * `archived` and re-activates a prior row).
 */
const FORWARD_TRANSITIONS: Readonly<Record<KernelPromptStatus, ReadonlyArray<KernelPromptStatus>>> = {
  shadow: ['canary'],
  canary: ['canary-25', 'active', 'shadow'],
  'canary-25': ['active', 'canary', 'shadow'],
  active: ['archived'],
  degraded: ['archived', 'shadow'],
  archived: [],
};

function assertTransition(from: KernelPromptStatus, to: KernelPromptStatus): void {
  const allowed = FORWARD_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new Error(
      `kernel-prompt-registry: illegal status transition ${from} -> ${to}`,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────

const selectCols = {
  id: kernelPromptRegistry.id,
  capability: kernelPromptRegistry.capability,
  version: kernelPromptRegistry.version,
  promptText: kernelPromptRegistry.promptText,
  goldenSetVersion: kernelPromptRegistry.goldenSetVersion,
  status: kernelPromptRegistry.status,
  promotedAt: kernelPromptRegistry.promotedAt,
  promotedBy: kernelPromptRegistry.promotedBy,
  archivedAt: kernelPromptRegistry.archivedAt,
  archivedReason: kernelPromptRegistry.archivedReason,
  metadata: kernelPromptRegistry.metadata,
};

export function createKernelPromptRegistryService(
  db: DatabaseClient,
): KernelPromptRegistryService {
  async function readByVersion(
    capability: string,
    version: string,
  ): Promise<PromptVersionRow | null> {
    try {
      const rows = await db
        .select(selectCols)
        .from(kernelPromptRegistry)
        .where(
          and(
            eq(kernelPromptRegistry.capability, capability),
            eq(kernelPromptRegistry.version, version),
          ),
        )
        .limit(1);
      const r = Array.isArray(rows) ? rows[0] : undefined;
      return r ? rowToVersion(r as DbRowShape) : null;
    } catch (error) {
      logger.error('kernel-prompt-registry.findByVersion failed', { error: error });
      return null;
    }
  }

  async function readByStatus(
    capability: string,
    status: KernelPromptStatus | ReadonlyArray<KernelPromptStatus>,
  ): Promise<ReadonlyArray<PromptVersionRow>> {
    const statuses = Array.isArray(status) ? status : [status];
    try {
      const rows = await db
        .select(selectCols)
        .from(kernelPromptRegistry)
        .where(
          and(
            eq(kernelPromptRegistry.capability, capability),
            // OR list of statuses — emit via SQL `IN`.
            sql`${kernelPromptRegistry.status} = ANY(${statuses as string[]})`,
          ),
        )
        .orderBy(desc(kernelPromptRegistry.promotedAt));
      return (Array.isArray(rows) ? rows : []).map((r) =>
        rowToVersion(r as DbRowShape),
      );
    } catch (error) {
      logger.error('kernel-prompt-registry.readByStatus failed', { error: error });
      return [];
    }
  }

  return {
    async registerShadow(args) {
      if (!args.capability || !args.version || !args.promptText) {
        throw new Error(
          'kernel-prompt-registry.registerShadow: capability, version, promptText required',
        );
      }
      const existing = await readByVersion(args.capability, args.version);
      if (existing) {
        throw new Error(
          `kernel-prompt-registry.registerShadow: (${args.capability}, ${args.version}) already registered`,
        );
      }
      const id = randomUUID();
      await db.insert(kernelPromptRegistry).values({
        id,
        capability: args.capability,
        version: args.version,
        promptText: args.promptText,
        goldenSetVersion: args.goldenSetVersion,
        status: 'shadow',
        promotedAt: new Date(),
        promotedBy: args.promotedBy,
        metadata: (args.metadata ?? {}) as Record<string, unknown>,
      } as never);
      const row = await readByVersion(args.capability, args.version);
      if (!row) {
        throw new Error(
          'kernel-prompt-registry.registerShadow: insert succeeded but read-back returned no row',
        );
      }
      return row;
    },

    async promote(args) {
      const row = await readByVersion(args.capability, args.version);
      if (!row) {
        throw new Error(
          `kernel-prompt-registry.promote: (${args.capability}, ${args.version}) not found`,
        );
      }
      assertTransition(row.status, args.toStatus);

      // When promoting TO `active`, demote the current active row to
      // `archived` so there is at most one active version per
      // capability at any time.
      if (args.toStatus === 'active') {
        const currentActive = await this.findActive(args.capability);
        if (currentActive && currentActive.version !== args.version) {
          await db
            .update(kernelPromptRegistry)
            .set({
              status: 'archived',
              archivedAt: new Date(),
              archivedReason: `superseded by ${args.version}`,
            } as never)
            .where(
              and(
                eq(kernelPromptRegistry.capability, args.capability),
                eq(kernelPromptRegistry.version, currentActive.version),
              ),
            );
        }
      }

      await db
        .update(kernelPromptRegistry)
        .set({
          status: args.toStatus,
          promotedAt: new Date(),
          promotedBy: args.promotedBy,
        } as never)
        .where(
          and(
            eq(kernelPromptRegistry.capability, args.capability),
            eq(kernelPromptRegistry.version, args.version),
          ),
        );
      const next = await readByVersion(args.capability, args.version);
      if (!next) {
        throw new Error(
          'kernel-prompt-registry.promote: update succeeded but read-back returned no row',
        );
      }
      return next;
    },

    async rollback(args) {
      const previousActive = await this.findActive(args.capability);
      if (!previousActive) {
        return { previousActive: null, restoredActive: null };
      }
      // Archive the broken active row WITH the operator-provided reason.
      await db
        .update(kernelPromptRegistry)
        .set({
          status: 'archived',
          archivedAt: new Date(),
          archivedReason: `rollback: ${args.reason}`,
          promotedBy: args.promotedBy,
          promotedAt: new Date(),
        } as never)
        .where(
          and(
            eq(kernelPromptRegistry.capability, args.capability),
            eq(kernelPromptRegistry.version, previousActive.version),
          ),
        );

      // Find the most recently archived prior-active row (the one we
      // archived during its supersede) and restore it.
      let restoredActive: PromptVersionRow | null = null;
      try {
        const candidates = await db
          .select(selectCols)
          .from(kernelPromptRegistry)
          .where(
            and(
              eq(kernelPromptRegistry.capability, args.capability),
              eq(kernelPromptRegistry.status, 'archived'),
            ),
          )
          .orderBy(desc(kernelPromptRegistry.archivedAt));
        const list = (Array.isArray(candidates) ? candidates : []).map((r) =>
          rowToVersion(r as DbRowShape),
        );
        // Skip the row we just archived (matching reason prefix).
        const prior = list.find(
          (r) =>
            r.version !== previousActive.version &&
            !(r.archivedReason ?? '').startsWith('rollback:') &&
            !(r.archivedReason ?? '').startsWith('degraded:'),
        );
        if (prior) {
          await db
            .update(kernelPromptRegistry)
            .set({
              status: 'active',
              promotedAt: new Date(),
              promotedBy: args.promotedBy,
              archivedAt: null,
              archivedReason: null,
            } as never)
            .where(
              and(
                eq(kernelPromptRegistry.capability, args.capability),
                eq(kernelPromptRegistry.version, prior.version),
              ),
            );
          restoredActive = await readByVersion(args.capability, prior.version);
        }
      } catch (error) {
        logger.error('kernel-prompt-registry.rollback restore failed', { error: error });
      }

      return {
        previousActive: await readByVersion(
          args.capability,
          previousActive.version,
        ),
        restoredActive,
      };
    },

    async markDegraded(capability, version, reason) {
      const row = await readByVersion(capability, version);
      if (!row) return null;
      if (row.status === 'archived') return row;
      try {
        await db
          .update(kernelPromptRegistry)
          .set({
            status: 'degraded',
            promotedAt: new Date(),
            archivedReason: `degraded: ${reason}`,
          } as never)
          .where(
            and(
              eq(kernelPromptRegistry.capability, capability),
              eq(kernelPromptRegistry.version, version),
            ),
          );
      } catch (error) {
        logger.error('kernel-prompt-registry.markDegraded failed', { error: error });
        return row;
      }
      return readByVersion(capability, version);
    },

    async listForCapability(capability) {
      try {
        const rows = await db
          .select(selectCols)
          .from(kernelPromptRegistry)
          .where(eq(kernelPromptRegistry.capability, capability))
          .orderBy(desc(kernelPromptRegistry.promotedAt));
        return (Array.isArray(rows) ? rows : []).map((r) =>
          rowToVersion(r as DbRowShape),
        );
      } catch (error) {
        logger.error('kernel-prompt-registry.listForCapability failed', { error: error });
        return [];
      }
    },

    findByVersion: readByVersion,

    async findActive(capability) {
      const rows = await readByStatus(capability, 'active');
      return rows[0] ?? null;
    },

    async findCanaries(capability) {
      return readByStatus(capability, ['canary', 'canary-25']);
    },

    async findShadows(capability) {
      return readByStatus(capability, 'shadow');
    },
  };
}

export { kernelPromptRegistry };
