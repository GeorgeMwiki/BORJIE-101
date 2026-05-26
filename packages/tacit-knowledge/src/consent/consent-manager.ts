/**
 * Consent manager.
 *
 * Wave HARVEST. Surfaces the subject-owned consent semantics — grant,
 * revoke, and per-write check. Sits between the interview engine and
 * the consent repository so the engine never inlines consent logic.
 *
 * Default: a subject's consent is **granted** when first recorded.
 * Absence of a row blocks writes — the engine treats "no consent row"
 * as "no consent". Revoke flips the row to `status = 'revoked'` and
 * blocks all subsequent persistence under that `subject_user_id`.
 *
 * The package does NOT retroactively delete cells already persisted
 * into cognitive-memory — that is the cognitive-memory store's
 * responsibility under its own retention discipline.
 */

import type { Consent, TacitConsentRepository } from '../types.js';

export interface ConsentManager {
  grant(
    subjectUserId: string,
    tenantId: string,
  ): Promise<Consent>;
  revoke(
    subjectUserId: string,
    tenantId: string,
  ): Promise<Consent | null>;
  /**
   * Returns true if the subject has a granted consent record for
   * this tenant. Returns false when the record is missing or
   * revoked.
   */
  isGranted(
    subjectUserId: string,
    tenantId: string,
  ): Promise<boolean>;
}

export function createConsentManager(
  repo: TacitConsentRepository,
): ConsentManager {
  return {
    async grant(
      subjectUserId: string,
      tenantId: string,
    ): Promise<Consent> {
      return repo.grant(subjectUserId, tenantId);
    },

    async revoke(
      subjectUserId: string,
      tenantId: string,
    ): Promise<Consent | null> {
      return repo.revoke(subjectUserId, tenantId);
    },

    async isGranted(
      subjectUserId: string,
      tenantId: string,
    ): Promise<boolean> {
      const row = await repo.read(subjectUserId, tenantId);
      if (row === null) return false;
      return row.status === 'granted';
    },
  };
}
