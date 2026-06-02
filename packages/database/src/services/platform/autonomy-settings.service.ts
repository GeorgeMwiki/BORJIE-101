/**
 * Platform autonomy-settings Drizzle adapter — backs the Control-Tower
 * numeric/boolean knobs that have no other home (webhook rate cap +
 * embeddings token throttle). Migration 0179.
 *
 * Companion to:
 *   - packages/database/src/schemas/platform-autonomy-settings.schema.ts
 *   - services/api-gateway/src/routes/admin/control-tower.hono.ts
 *
 * Mirrors the killswitch-write / feature-flags adapter contracts:
 *   - one row per `setting_key`
 *   - `setSetting` captures the previous (enabled, int_value) snapshot for
 *     the rollback contract, then upserts
 *   - hard DB failures on WRITE re-throw (operator must know); reads degrade
 *     to null so a Control-Tower read never takes the surface down.
 */
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { platformAutonomySettings } from '../../schemas/platform-autonomy-settings.schema.js';
import type { DatabaseClient } from '../../client.js';
import { logger } from '../../logger.js';

export interface AutonomySettingSnapshot {
  readonly enabled: boolean;
  readonly intValue: number | null;
}

export interface SetAutonomySettingArgs {
  readonly settingKey: string;
  readonly enabled: boolean;
  readonly intValue: number | null;
  readonly note: string | null;
}

export interface SetAutonomySettingResult {
  readonly settingKey: string;
  readonly enabled: boolean;
  readonly intValue: number | null;
  readonly note: string | null;
  readonly previous: AutonomySettingSnapshot | null;
  readonly updatedAt: string;
}

export interface RestoreAutonomySettingArgs {
  readonly settingKey: string;
  readonly previous: AutonomySettingSnapshot | null;
}

export interface PlatformAutonomySettingsService {
  setSetting(
    args: SetAutonomySettingArgs,
  ): Promise<SetAutonomySettingResult>;
  restoreSetting(args: RestoreAutonomySettingArgs): Promise<void>;
  /** Operator helper — read the current value (or null when unset). */
  readSetting(settingKey: string): Promise<AutonomySettingSnapshot | null>;
}

export interface AutonomySettingsDeps {
  /**
   * Caller id for the `set_by` audit column. The route threads the
   * acting admin's user id through a per-call getter so every write
   * stamps the live operator.
   */
  readonly resolveActor: () => string;
}

interface RawRow {
  enabled: unknown;
  intValue: unknown;
  note: unknown;
}

function toBool(v: unknown): boolean {
  return v === true;
}

function toIntOrNull(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
}

export function createPlatformAutonomySettingsService(
  db: DatabaseClient,
  deps: AutonomySettingsDeps,
): PlatformAutonomySettingsService {
  return {
    async readSetting(settingKey) {
      try {
        if (!settingKey) return null;
        const rows = (await db
          .select({
            enabled: platformAutonomySettings.enabled,
            intValue: platformAutonomySettings.intValue,
            note: platformAutonomySettings.note,
          })
          .from(platformAutonomySettings)
          .where(eq(platformAutonomySettings.settingKey, settingKey))
          .limit(1)) as ReadonlyArray<RawRow>;
        const r = rows[0];
        if (!r) return null;
        return { enabled: toBool(r.enabled), intValue: toIntOrNull(r.intValue) };
      } catch (error) {
        logger.error('platform.autonomySettings.readSetting failed', { error });
        return null;
      }
    },

    async setSetting(args) {
      if (!args.settingKey) {
        throw new Error(
          'platform.autonomySettings.setSetting: settingKey is required',
        );
      }
      const actor = deps.resolveActor();
      const now = new Date();
      try {
        const existingRows = (await db
          .select({
            enabled: platformAutonomySettings.enabled,
            intValue: platformAutonomySettings.intValue,
            note: platformAutonomySettings.note,
          })
          .from(platformAutonomySettings)
          .where(eq(platformAutonomySettings.settingKey, args.settingKey))
          .limit(1)) as ReadonlyArray<RawRow>;
        const existing = existingRows[0] ?? null;
        const previous: AutonomySettingSnapshot | null = existing
          ? {
              enabled: toBool(existing.enabled),
              intValue: toIntOrNull(existing.intValue),
            }
          : null;

        if (!existing) {
          await db.insert(platformAutonomySettings).values({
            id: randomUUID(),
            settingKey: args.settingKey,
            enabled: args.enabled,
            intValue: args.intValue,
            note: args.note,
            prevEnabled: null,
            prevIntValue: null,
            setAt: now,
            setBy: actor,
          } as never);
        } else {
          await db
            .update(platformAutonomySettings)
            .set({
              enabled: args.enabled,
              intValue: args.intValue,
              note: args.note,
              prevEnabled: previous?.enabled ?? null,
              prevIntValue: previous?.intValue ?? null,
              setAt: now,
              setBy: actor,
            } as never)
            .where(eq(platformAutonomySettings.settingKey, args.settingKey));
        }
        return {
          settingKey: args.settingKey,
          enabled: args.enabled,
          intValue: args.intValue,
          note: args.note,
          previous,
          updatedAt: now.toISOString(),
        };
      } catch (error) {
        logger.error('platform.autonomySettings.setSetting failed', { error });
        throw error instanceof Error
          ? error
          : new Error('platform.autonomySettings.setSetting failed');
      }
    },

    async restoreSetting(args) {
      if (!args.settingKey) {
        throw new Error(
          'platform.autonomySettings.restoreSetting: settingKey is required',
        );
      }
      const actor = deps.resolveActor();
      const now = new Date();
      try {
        if (!args.previous) {
          await db
            .delete(platformAutonomySettings)
            .where(eq(platformAutonomySettings.settingKey, args.settingKey));
          return;
        }
        await db
          .update(platformAutonomySettings)
          .set({
            enabled: args.previous.enabled,
            intValue: args.previous.intValue,
            setAt: now,
            setBy: actor,
          } as never)
          .where(eq(platformAutonomySettings.settingKey, args.settingKey));
      } catch (error) {
        logger.error('platform.autonomySettings.restoreSetting failed', {
          error,
        });
        throw error instanceof Error
          ? error
          : new Error('platform.autonomySettings.restoreSetting failed');
      }
    },
  };
}
