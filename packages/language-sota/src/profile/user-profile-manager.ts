/**
 * User language profile manager.
 *
 * Owns the (tenant, user) → preferred / secondary language + dialect
 * tags + per-phoneme pronunciation baseline. Plugged into the
 * repository port supplied by the host application.
 *
 * Single-shot operations only — bulk operations would invite the
 * caller to mutate rows in place, which the spec forbids.
 */

import { mergeBaseline } from '../phoneme/phoneme-aligner.js';
import {
  LanguageSotaError,
  type GopBaseline,
  type Language,
  type Phoneme,
  type UserLanguageProfile,
  type UserProfileRepository,
} from '../types.js';
import { buildBaseline } from '../phoneme/phoneme-aligner.js';

export interface UserProfileManagerDeps {
  readonly repository: UserProfileRepository;
}

export interface UserProfileManager {
  ensureProfile(input: {
    readonly tenantId: string;
    readonly userId: string;
    readonly preferredLang?: Language;
    readonly secondaryLang?: Language;
  }): Promise<UserLanguageProfile>;

  setPreferred(
    tenantId: string,
    userId: string,
    lang: Language,
  ): Promise<UserLanguageProfile>;

  addDialectTag(
    tenantId: string,
    userId: string,
    tag: string,
  ): Promise<UserLanguageProfile>;

  /**
   * Fold a fresh utterance's phoneme stream into the existing
   * pronunciation baseline. Returns the updated profile.
   */
  updateBaseline(input: {
    readonly tenantId: string;
    readonly userId: string;
    readonly phonemes: ReadonlyArray<Phoneme>;
  }): Promise<UserLanguageProfile>;
}

export function createUserProfileManager(
  deps: UserProfileManagerDeps,
): UserProfileManager {
  return {
    async ensureProfile(input) {
      const existing = await deps.repository.findByKey(
        input.tenantId,
        input.userId,
      );
      if (existing !== null) {
        return existing;
      }
      const upsertInput: {
        readonly tenantId: string;
        readonly userId: string;
        readonly preferredLang?: Language;
        readonly secondaryLang?: Language;
      } = {
        tenantId: input.tenantId,
        userId: input.userId,
        ...(input.preferredLang !== undefined
          ? { preferredLang: input.preferredLang }
          : {}),
        ...(input.secondaryLang !== undefined
          ? { secondaryLang: input.secondaryLang }
          : {}),
      };
      return deps.repository.upsert(upsertInput);
    },

    async setPreferred(tenantId, userId, lang) {
      const updated = await deps.repository.setPreferredLang(
        tenantId,
        userId,
        lang,
      );
      if (updated === null) {
        throw new LanguageSotaError(
          'profile-not-found',
          `no profile for tenant=${tenantId} user=${userId}`,
        );
      }
      return updated;
    },

    async addDialectTag(tenantId, userId, tag) {
      const existing = await deps.repository.findByKey(tenantId, userId);
      if (existing === null) {
        throw new LanguageSotaError(
          'profile-not-found',
          `no profile for tenant=${tenantId} user=${userId}`,
        );
      }
      const tags = existing.dialectTags.includes(tag)
        ? existing.dialectTags
        : [...existing.dialectTags, tag];
      return deps.repository.upsert({
        tenantId,
        userId,
        dialectTags: tags,
      });
    },

    async updateBaseline(input) {
      const existing = await deps.repository.findByKey(
        input.tenantId,
        input.userId,
      );
      const baseDelta: Readonly<Record<string, GopBaseline>> = buildBaseline([
        input.phonemes,
      ]);
      const merged = existing === null
        ? baseDelta
        : mergeBaseline(existing.pronunciationProfile, baseDelta);
      return deps.repository.upsert({
        tenantId: input.tenantId,
        userId: input.userId,
        pronunciationProfile: merged,
      });
    },
  };
}
