/**
 * Onboarding-state persistence — Wave COMPANY-BRAIN (Y-D).
 *
 * Wraps the Drizzle calls behind a port so the jumpstart orchestrator
 * stays test-able without a live Postgres.
 */

import { sql } from 'drizzle-orm';
import { onboardingState } from '@borjie/database';

import type { IngestIntent } from '../ingestion-intent-inferrer/types.js';

export interface OnboardingStateRow {
  readonly tenantId: string;
  readonly status: 'pending' | 'ready' | 'demoed' | 'dismissed';
  readonly firstIngestAt: string | null;
  readonly jumpstartedAt: string | null;
}

export interface OnboardingPersistence {
  /** Read the per-tenant onboarding row. Returns null when absent. */
  fetch(tenantId: string): Promise<OnboardingStateRow | null>;
  /**
   * Idempotently mark the tenant as having had its first ingest.
   * No-ops when the row already has a firstIngestAt timestamp.
   */
  markFirstIngest(args: {
    readonly tenantId: string;
    readonly nowIso: string;
  }): Promise<OnboardingStateRow>;
  /**
   * Transition the row to 'demoed' and snapshot the intent. Idempotent
   * — returns the existing row when already 'demoed' or 'dismissed'.
   */
  markJumpstarted(args: {
    readonly tenantId: string;
    readonly nowIso: string;
    readonly intent: IngestIntent;
  }): Promise<OnboardingStateRow>;
}

interface PersistenceDb {
  execute(query: unknown): Promise<unknown>;
}

function rowsOf(result: unknown): ReadonlyArray<Record<string, unknown>> {
  if (Array.isArray(result)) return result as ReadonlyArray<Record<string, unknown>>;
  const wrapped = result as { rows?: ReadonlyArray<Record<string, unknown>> };
  return wrapped?.rows ?? [];
}

function rowToState(row: Record<string, unknown> | undefined | null): OnboardingStateRow | null {
  if (!row) return null;
  const tenantId = row['tenant_id'] ?? row['tenantId'];
  if (!tenantId) return null;
  const status = String(row['status'] ?? 'pending') as OnboardingStateRow['status'];
  const firstIngestAt = row['first_ingest_at'] ?? row['firstIngestAt'] ?? null;
  const jumpstartedAt = row['jumpstarted_at'] ?? row['jumpstartedAt'] ?? null;
  return Object.freeze({
    tenantId: String(tenantId),
    status,
    firstIngestAt: firstIngestAt ? new Date(firstIngestAt as string).toISOString() : null,
    jumpstartedAt: jumpstartedAt ? new Date(jumpstartedAt as string).toISOString() : null,
  });
}

export function createDrizzleOnboardingPersistence(
  db: PersistenceDb,
): OnboardingPersistence {
  return {
    async fetch(tenantId) {
      const result = await db.execute(sql`
        SELECT tenant_id, status, first_ingest_at, jumpstarted_at, first_intent_at
          FROM ${onboardingState}
         WHERE tenant_id = ${tenantId}
         LIMIT 1
      `);
      return rowToState(rowsOf(result)[0] ?? null);
    },

    async markFirstIngest({ tenantId, nowIso }) {
      const result = await db.execute(sql`
        INSERT INTO onboarding_state (tenant_id, first_ingest_at, status, updated_at)
        VALUES (${tenantId}, ${nowIso}::timestamptz, 'ready', ${nowIso}::timestamptz)
        ON CONFLICT (tenant_id)
        DO UPDATE SET
          first_ingest_at = COALESCE(onboarding_state.first_ingest_at, EXCLUDED.first_ingest_at),
          status = CASE
            WHEN onboarding_state.status IN ('demoed','dismissed') THEN onboarding_state.status
            ELSE 'ready'
          END,
          updated_at = EXCLUDED.updated_at
        RETURNING tenant_id, status, first_ingest_at, jumpstarted_at, first_intent_at
      `);
      const row = rowToState(rowsOf(result)[0] ?? null);
      if (!row) {
        throw new Error('onboarding-jumpstart: markFirstIngest returned no row');
      }
      return row;
    },

    async markJumpstarted({ tenantId, nowIso, intent }) {
      const intentJson = JSON.stringify(intent);
      const result = await db.execute(sql`
        INSERT INTO onboarding_state (
          tenant_id, first_ingest_at, jumpstarted_at, first_intent_at,
          status, first_intent_json, updated_at
        )
        VALUES (
          ${tenantId}, ${nowIso}::timestamptz, ${nowIso}::timestamptz, ${nowIso}::timestamptz,
          'demoed', ${intentJson}::jsonb, ${nowIso}::timestamptz
        )
        ON CONFLICT (tenant_id)
        DO UPDATE SET
          jumpstarted_at = COALESCE(onboarding_state.jumpstarted_at, EXCLUDED.jumpstarted_at),
          first_intent_at = COALESCE(onboarding_state.first_intent_at, EXCLUDED.first_intent_at),
          status = CASE
            WHEN onboarding_state.status = 'dismissed' THEN 'dismissed'
            ELSE 'demoed'
          END,
          first_intent_json = CASE
            WHEN onboarding_state.first_intent_json = '{}'::jsonb THEN EXCLUDED.first_intent_json
            ELSE onboarding_state.first_intent_json
          END,
          updated_at = EXCLUDED.updated_at
        RETURNING tenant_id, status, first_ingest_at, jumpstarted_at, first_intent_at
      `);
      const row = rowToState(rowsOf(result)[0] ?? null);
      if (!row) {
        throw new Error('onboarding-jumpstart: markJumpstarted returned no row');
      }
      return row;
    },
  };
}
