/**
 * In-memory `TacitConsentRepository`.
 *
 * Wave HARVEST. Pure-memory adapter for tests + dev. The key shape
 * matches the table PK (subjectUserId, tenantId).
 */

import type { Consent, TacitConsentRepository } from '../types.js';
import { computeTacitAuditHash } from '../audit/audit-chain-link.js';

interface InMemoryConsentRepoDeps {
  readonly now: () => Date;
}

function key(subjectUserId: string, tenantId: string): string {
  return `${subjectUserId}::${tenantId}`;
}

export function createInMemoryTacitConsentRepository(
  deps: InMemoryConsentRepoDeps = { now: () => new Date() },
): TacitConsentRepository {
  const rows = new Map<string, Consent>();

  return {
    async grant(
      subjectUserId: string,
      tenantId: string,
    ): Promise<Consent> {
      const grantedAt = deps.now().toISOString();
      const auditHash = computeTacitAuditHash({
        kind: 'consent.grant',
        subjectUserId,
        tenantId,
        grantedAt,
      });
      const row: Consent = Object.freeze({
        subjectUserId,
        tenantId,
        status: 'granted',
        grantedAt,
        revokedAt: null,
        auditHash,
      });
      rows.set(key(subjectUserId, tenantId), row);
      return row;
    },

    async revoke(
      subjectUserId: string,
      tenantId: string,
    ): Promise<Consent | null> {
      const existing = rows.get(key(subjectUserId, tenantId));
      if (!existing) return null;
      const revokedAt = deps.now().toISOString();
      const auditHash = computeTacitAuditHash(
        {
          kind: 'consent.revoke',
          subjectUserId,
          tenantId,
          revokedAt,
        },
        existing.auditHash,
      );
      const next: Consent = Object.freeze({
        ...existing,
        status: 'revoked',
        revokedAt,
        auditHash,
      });
      rows.set(key(subjectUserId, tenantId), next);
      return next;
    },

    async read(
      subjectUserId: string,
      tenantId: string,
    ): Promise<Consent | null> {
      return rows.get(key(subjectUserId, tenantId)) ?? null;
    },
  };
}
