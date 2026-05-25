/**
 * Amplified migration commit + diff skills — Phase 2.
 *
 * Preserves the existing `migrationCommitTool` contract in `./migration.ts`
 * (still exported from MIGRATION_SKILL_TOOLS). This module exposes:
 *
 *   - makeMigrationCommitTool(deps) — replaces the dry-run commit with a
 *     real MigrationService.commit() path behind the same tool name.
 *     Callers (copilot factory) inject the service and receive a
 *     ToolHandler ready for dispatcher registration.
 *   - migrationDiffAdvanced — diff with UPDATE bucket + per-row skipReason.
 */

import { z } from 'zod';
import type { ToolHandler } from '../../orchestrator/tool-dispatcher.js';
import {
  ExtractionBundleSchema,
  MigrationCommitParamsSchema,
  MigrationDiffParamsSchema,
  migrationDiff,
  type ExtractionBundle,
  type MigrationDiffResult,
} from './migration.js';

// ---------------------------------------------------------------------------
// Advanced diff with UPDATE bucket
// ---------------------------------------------------------------------------

export const MigrationDiffAdvancedParamsSchema = MigrationDiffParamsSchema.extend(
  {
    /** Existing snapshots keyed by natural key — used for UPDATE detection. */
    existingSnapshots: z
      .object({
        tenants: z
          .record(
            z.string(),
            z.object({
              phone: z.string().optional(),
              email: z.string().optional(),
              unitLabel: z.string().optional(),
              rentKes: z.number().optional(),
            })
          )
          .default({}),
        units: z
          .record(
            z.string(),
            z.object({
              bedrooms: z.number().optional(),
              rentKes: z.number().optional(),
              status: z.string().optional(),
            })
          )
          .default({}),
      })
      .default({}),
    /** Include per-row skip reasons (kept out of MigrationDiffResult for
     *  backwards compatibility). */
    includeSkipReasons: z.boolean().default(true),
  }
);

export interface RowSkip {
  readonly kind: 'properties' | 'units' | 'tenants' | 'employees' | 'departments' | 'teams';
  readonly naturalKey: string;
  readonly skipReason: string;
}

export interface MigrationDiffAdvancedResult extends MigrationDiffResult {
  readonly toUpdate: {
    readonly tenants: number;
    readonly units: number;
  };
  readonly skipReasons: RowSkip[];
}

export function migrationDiffAdvanced(
  params: z.infer<typeof MigrationDiffAdvancedParamsSchema>
): MigrationDiffAdvancedResult {
  const base = migrationDiff(params);
  const snapshots = params.existingSnapshots ?? { tenants: {}, units: {} };
  const skipReasons: RowSkip[] = [];

  // UPDATE detection for tenants: name matches an existing snapshot but a
  // comparable field has changed.
  let tenantUpdates = 0;
  for (const t of params.bundle.tenants) {
    const snap = snapshots.tenants?.[t.name];
    if (!snap) continue;
    const changed =
      (t.phone && snap.phone && t.phone !== snap.phone) ||
      (t.email && snap.email && t.email !== snap.email) ||
      (t.unitLabel && snap.unitLabel && t.unitLabel !== snap.unitLabel) ||
      (typeof t.rentKes === 'number' &&
        typeof snap.rentKes === 'number' &&
        t.rentKes !== snap.rentKes);
    if (changed) {
      tenantUpdates += 1;
    } else if (params.includeSkipReasons) {
      skipReasons.push({
        kind: 'tenants',
        naturalKey: t.name,
        skipReason: 'no field change vs existing snapshot',
      });
    }
  }

  let unitUpdates = 0;
  for (const u of params.bundle.units) {
    const key = `${u.propertyName}::${u.label}`;
    const snap = snapshots.units?.[key];
    if (!snap) continue;
    const changed =
      (typeof u.bedrooms === 'number' &&
        typeof snap.bedrooms === 'number' &&
        u.bedrooms !== snap.bedrooms) ||
      (typeof u.rentKes === 'number' &&
        typeof snap.rentKes === 'number' &&
        u.rentKes !== snap.rentKes) ||
      (u.status && snap.status && u.status !== snap.status);
    if (changed) {
      unitUpdates += 1;
    } else if (params.includeSkipReasons) {
      skipReasons.push({
        kind: 'units',
        naturalKey: key,
        skipReason: 'no field change vs existing snapshot',
      });
    }
  }

  return {
    ...base,
    toUpdate: { tenants: tenantUpdates, units: unitUpdates },
    skipReasons,
  };
}

export const migrationDiffAdvancedTool: ToolHandler = {
  name: 'skill.migration.diff_v2',
  description:
    'Advanced diff: ADD + UPDATE bucket vs existing snapshots + per-row skipReason. Preserves skill.migration.diff as the backward-compatible path.',
  parameters: {
    type: 'object',
    required: ['bundle'],
    properties: {
      bundle: { type: 'object' },
      existing: { type: 'object' },
      existingSnapshots: { type: 'object' },
      includeSkipReasons: { type: 'boolean' },
    },
  },
  async execute(params) {
    const parsed = MigrationDiffAdvancedParamsSchema.safeParse(params);
    if (!parsed.success) return { ok: false, error: parsed.error.message };
    const result = migrationDiffAdvanced(parsed.data);
    return {
      ok: true,
      data: result,
      evidenceSummary: `Diff v2: +${result.toAdd.properties}p/+${result.toAdd.units}u/+${result.toAdd.tenants}t/+${result.toAdd.employees}e | Δ${result.toUpdate.tenants}t/Δ${result.toUpdate.units}u | ${result.toSkip}skip`,
    };
  },
};

// ---------------------------------------------------------------------------
// Commit tool — real repository path.
// ---------------------------------------------------------------------------

export interface MigrationCommitDeps {
  /**
   * Resolve the run context from tool parameters. Returns tenantId/actorId
   * the service needs. Defaults to pulling from tool params (for tests).
   */
  readonly resolveContext?: (params: {
    runId: string;
    tenantId?: string;
    actorId?: string;
  }) => { tenantId: string; actorId: string };

  /** Commit handler — typically `migrationService.commit.bind(service)`. */
  readonly commit: (input: {
    tenantId: string;
    runId: string;
    actorId: string;
  }) => Promise<{
    ok: boolean;
    error?: { code: string; message: string };
    counts?: Record<string, number>;
    skipped?: Record<string, string[]>;
  }>;
}

export const MigrationCommitAmplifiedParamsSchema = MigrationCommitParamsSchema.extend(
  {
    runId: z.string().min(1),
    tenantId: z.string().optional(),
    actorId: z.string().optional(),
  }
);

export function makeMigrationCommitTool(deps: MigrationCommitDeps): ToolHandler {
  return {
    name: 'skill.migration.commit',
    description:
      'Commit an approved MigrationRun to the tenant database. Looks up run, asserts status=approved, executes repository transaction, emits MigrationCommittedEvent. Marks run failed on error.',
    parameters: {
      type: 'object',
      required: ['runId', 'bundle'],
      properties: {
        runId: { type: 'string' },
        tenantId: { type: 'string' },
        actorId: { type: 'string' },
        bundle: { type: 'object' },
        write: { type: 'boolean' },
      },
    },
    async execute(params, context) {
      const parsed = MigrationCommitAmplifiedParamsSchema.safeParse(params);
      if (!parsed.success) return { ok: false, error: parsed.error.message };

      const ctx = deps.resolveContext
        ? deps.resolveContext({
            runId: parsed.data.runId,
            tenantId: parsed.data.tenantId,
            actorId: parsed.data.actorId,
          })
        : {
            tenantId:
              parsed.data.tenantId ??
              (context as unknown as { tenant?: { tenantId?: string } })?.tenant
                ?.tenantId ??
              '',
            actorId:
              parsed.data.actorId ??
              (context as unknown as { actor?: { id?: string } })?.actor?.id ??
              '',
          };

      if (!ctx.tenantId || !ctx.actorId) {
        return {
          ok: false,
          error: 'missing tenantId/actorId in tool context',
        };
      }

      const result = await deps.commit({
        tenantId: ctx.tenantId,
        runId: parsed.data.runId,
        actorId: ctx.actorId,
      });

      if (!result.ok) {
        return {
          ok: false,
          error: result.error?.message ?? 'commit failed',
        };
      }

      const total = Object.values(result.counts ?? {}).reduce(
        (s, n) => s + (n ?? 0),
        0
      );

      return {
        ok: true,
        data: {
          runId: parsed.data.runId,
          counts: result.counts ?? {},
          skipped: result.skipped ?? {},
        },
        evidenceSummary: `Committed run ${parsed.data.runId}: ${total} rows written. Skips: ${sumSkips(result.skipped)}.`,
      };
    },
  };
}

function sumSkips(skipped?: Record<string, string[]>): number {
  if (!skipped) return 0;
  return Object.values(skipped).reduce((s, arr) => s + arr.length, 0);
}

// ---------------------------------------------------------------------------
// Bundle bridge — hand the ExtractionBundle from extract → run storage.
// ---------------------------------------------------------------------------

export interface StoredBundleShim {
  readonly properties: ExtractionBundle['properties'];
  readonly units: ExtractionBundle['units'];
  readonly tenants: ExtractionBundle['tenants'];
  readonly employees: ExtractionBundle['employees'];
  readonly departments: ExtractionBundle['departments'];
  readonly teams: ExtractionBundle['teams'];
}

export function toStoredBundle(bundle: ExtractionBundle): StoredBundleShim {
  // After parse, all fields are populated (schema uses .default([]) per field),
  // but the inferred input type marks them optional; cast to the required shape.
  return ExtractionBundleSchema.parse(bundle) as StoredBundleShim;
}
