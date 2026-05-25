/**
 * Persona branding service — Drizzle/Postgres adapter for the per-
 * tenant kernel-persona overrides table created in migration 0118.
 *
 * Responsibilities:
 *   1. `get(tenantId, surface)` — look up the surface-specific row;
 *      fall back to the surface-agnostic row (empty-string surface)
 *      when no specific row is present. Returns null when neither
 *      exists. Hard DB errors degrade to null with a console.error so
 *      the kernel never crashes when this table is missing or the DB
 *      is unreachable.
 *   2. `upsert(record)` — write a row, replacing any prior values for
 *      the same (tenantId, surface) pair. `updatedAt` is stamped
 *      automatically by the DB.
 *
 * The kernel-side port (`PersonaBrandingResolver` in
 * `@borjie/central-intelligence`) is duck-typed against this
 * service in the api-gateway composition root: the service returns
 * the persisted shape; the composition root maps it into the kernel
 * port's narrower `PersonaBrandingOverride` view.
 */

import { and, eq } from 'drizzle-orm';
import { personaBranding } from '../schemas/persona-branding.schema.js';
import type { DatabaseClient } from '../client.js';
import { logger } from '../logger.js';


// ─────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────

export interface PersonaBrandingShape {
  readonly tenantId: string;
  /** Empty string = surface-agnostic row that matches all surfaces. */
  readonly surface: string;
  readonly displayName: string | null;
  readonly openingPreamble: string | null;
  readonly voiceProfileId: string | null;
  readonly updatedAt: string;
}

export interface PersonaBrandingService {
  /**
   * Look up the override for a (tenantId, surface) pair. Tries the
   * specific surface row first; falls back to the empty-surface row
   * if no specific row is present. Returns null if neither exists.
   */
  get(tenantId: string, surface: string): Promise<PersonaBrandingShape | null>;

  /**
   * Insert-or-update a row. Empty-string surface is permitted (it is
   * the sentinel for "applies to all surfaces for this tenant").
   */
  upsert(record: Omit<PersonaBrandingShape, 'updatedAt'>): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────
// Factory
// ─────────────────────────────────────────────────────────────────────

const SURFACE_AGNOSTIC = '';

export function createPersonaBrandingService(
  db: DatabaseClient,
): PersonaBrandingService {
  return {
    async get(tenantId, surface): Promise<PersonaBrandingShape | null> {
      if (!tenantId) return null;
      const surfaceKey = typeof surface === 'string' ? surface : '';

      try {
        // 1) Try the specific surface row.
        if (surfaceKey !== SURFACE_AGNOSTIC) {
          const specific = await db
            .select({
              tenantId: personaBranding.tenantId,
              surface: personaBranding.surface,
              displayName: personaBranding.displayName,
              openingPreamble: personaBranding.openingPreamble,
              voiceProfileId: personaBranding.voiceProfileId,
              updatedAt: personaBranding.updatedAt,
            })
            .from(personaBranding)
            .where(
              and(
                eq(personaBranding.tenantId, tenantId),
                eq(personaBranding.surface, surfaceKey),
              ),
            )
            .limit(1);

          const hit = Array.isArray(specific) ? specific[0] : undefined;
          if (hit) return rowToShape(hit);
        }

        // 2) Fall back to the surface-agnostic row.
        const fallback = await db
          .select({
            tenantId: personaBranding.tenantId,
            surface: personaBranding.surface,
            displayName: personaBranding.displayName,
            openingPreamble: personaBranding.openingPreamble,
            voiceProfileId: personaBranding.voiceProfileId,
            updatedAt: personaBranding.updatedAt,
          })
          .from(personaBranding)
          .where(
            and(
              eq(personaBranding.tenantId, tenantId),
              eq(personaBranding.surface, SURFACE_AGNOSTIC),
            ),
          )
          .limit(1);

        const fbRow = Array.isArray(fallback) ? fallback[0] : undefined;
        return fbRow ? rowToShape(fbRow) : null;
      } catch (error) {
        // Hard DB failure — never crash the kernel; the caller treats
        // null as "no override" and falls back to the surface-default
        // persona.
        logger.error('persona-branding.get failed', { error: error });
        return null;
      }
    },

    async upsert(record): Promise<void> {
      if (!record || !record.tenantId) {
        throw new Error('persona-branding.upsert requires tenantId');
      }
      const surface =
        typeof record.surface === 'string' ? record.surface : SURFACE_AGNOSTIC;

      try {
        const values = {
          tenantId: record.tenantId,
          surface,
          displayName: record.displayName,
          openingPreamble: record.openingPreamble,
          voiceProfileId: record.voiceProfileId,
        };
        const setOnConflict = {
          displayName: record.displayName,
          openingPreamble: record.openingPreamble,
          voiceProfileId: record.voiceProfileId,
          updatedAt: new Date(),
        };
        await db
          .insert(personaBranding)
          .values(values as never)
          .onConflictDoUpdate({
            target: [personaBranding.tenantId, personaBranding.surface],
            set: setOnConflict as never,
          });
      } catch (error) {
        logger.error('persona-branding.upsert failed', { error: error });
        throw error instanceof Error
          ? error
          : new Error('persona-branding.upsert failed');
      }
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

interface PersonaBrandingRow {
  tenantId: string;
  surface: string;
  displayName: string | null;
  openingPreamble: string | null;
  voiceProfileId: string | null;
  updatedAt: Date | string;
}

function rowToShape(row: PersonaBrandingRow): PersonaBrandingShape {
  return {
    tenantId: row.tenantId,
    surface: row.surface,
    displayName: row.displayName,
    openingPreamble: row.openingPreamble,
    voiceProfileId: row.voiceProfileId,
    updatedAt:
      row.updatedAt instanceof Date
        ? row.updatedAt.toISOString()
        : String(row.updatedAt),
  };
}
