/**
 * `language_user_profile` repository.
 *
 * In-memory implementation. The PK is (tenant_id, user_id) so the
 * upsert is keyed on that pair.
 */

import {
  type ClockPort,
  type GopBaseline,
  type Language,
  type UpsertUserProfileInput,
  type UserLanguageProfile,
  type UserProfileRepository,
} from '../types.js';

export interface InMemoryUserProfileRepoDeps {
  readonly clock?: ClockPort;
}

export function createInMemoryUserProfileRepository(
  deps: InMemoryUserProfileRepoDeps = {},
): UserProfileRepository {
  const clock: ClockPort = deps.clock ?? { now: () => new Date() };
  const rows = new Map<string, UserLanguageProfile>();

  function key(tenantId: string, userId: string): string {
    return `${tenantId}|${userId}`;
  }

  function freeze(row: UserLanguageProfile): UserLanguageProfile {
    return Object.freeze({
      ...row,
      pronunciationProfile: Object.freeze({ ...row.pronunciationProfile }),
      dialectTags: Object.freeze([...row.dialectTags]),
    });
  }

  return {
    async upsert(input) {
      const k = key(input.tenantId, input.userId);
      const existing = rows.get(k);
      const now = clock.now();
      const preferredLang: Language =
        input.preferredLang ?? existing?.preferredLang ?? 'en';
      const secondaryLang: Language =
        input.secondaryLang ?? existing?.secondaryLang ?? 'sw';
      const pronunciationProfile: Readonly<Record<string, GopBaseline>> =
        input.pronunciationProfile ?? existing?.pronunciationProfile ?? {};
      const dialectTags: ReadonlyArray<string> =
        input.dialectTags ?? existing?.dialectTags ?? [];
      const createdAt = existing?.createdAt ?? now;
      const row: UserLanguageProfile = freeze({
        tenantId: input.tenantId,
        userId: input.userId,
        preferredLang,
        secondaryLang,
        pronunciationProfile,
        dialectTags,
        createdAt,
        updatedAt: now,
      });
      rows.set(k, row);
      return row;
    },

    async findByKey(tenantId, userId) {
      return rows.get(key(tenantId, userId)) ?? null;
    },

    async setPreferredLang(tenantId, userId, lang) {
      const k = key(tenantId, userId);
      const existing = rows.get(k);
      if (existing === undefined) return null;
      const row = freeze({
        ...existing,
        preferredLang: lang,
        updatedAt: clock.now(),
      });
      rows.set(k, row);
      return row;
    },
  };
}

// =============================================================================
// SQL adapter shape (documentation only).
// =============================================================================

export interface UserProfileSqlRow {
  readonly tenant_id: string;
  readonly user_id: string;
  readonly preferred_lang: string;
  readonly secondary_lang: string;
  readonly pronunciation_profile: unknown;
  readonly dialect_tags: ReadonlyArray<string>;
  readonly created_at: Date;
  readonly updated_at: Date;
}

/**
 * Narrow guard for upsert input. Useful at HTTP boundaries.
 */
export function isUpsertUserProfileInput(
  v: unknown,
): v is UpsertUserProfileInput {
  if (typeof v !== 'object' || v === null) return false;
  const c = v as Record<string, unknown>;
  return typeof c.tenantId === 'string' && typeof c.userId === 'string';
}
