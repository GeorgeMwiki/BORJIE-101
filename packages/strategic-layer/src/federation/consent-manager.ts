/**
 * `ConsentManager` — per-tenant opt-in for cognitive-memory cross-
 * tenant federation. Default deny; scoped; expiring; revocable
 * (prospective).
 *
 * Spec: STRATEGIC_DIRECTION_LAYER_SPEC.md §15.6.
 *
 * The cognitive-memory federation promoter MUST call `isAllowed()`
 * before promoting any cell to `platform_memory_cells`. Revocation
 * is *prospective* — already-federated cells are not yanked (matches
 * GDPR Art. 17 carve-out for de-identified statistical data).
 */

import {
  type ConsentScope,
  type ConsentStatus,
  type FederationConsent,
  type FederationConsentsRepository,
  type GrantConsentInput,
  STRATEGIC_CONSTANTS,
  StrategicLayerError,
} from '../types.js';
import { computeStrategicAuditHash } from '../audit/audit-chain-link.js';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface ConsentManagerDeps {
  readonly repo: FederationConsentsRepository;
  /** Clock injection for deterministic testing. */
  readonly now: () => Date;
}

export interface ConsentManager {
  grant(input: GrantConsentInput): Promise<FederationConsent>;
  revoke(
    tenantId: string,
    scope: ConsentScope,
    revokedBy: string,
  ): Promise<FederationConsent>;
  /** Returns `true` iff an active, non-expired consent covers `scope`. */
  isAllowed(tenantId: string, scope: ConsentScope): Promise<boolean>;
  list(tenantId: string): Promise<ReadonlyArray<FederationConsent>>;
}

export function createConsentManager(
  deps: ConsentManagerDeps,
): ConsentManager {
  const { repo, now } = deps;

  return {
    async grant(input: GrantConsentInput): Promise<FederationConsent> {
      if (
        input.durationDays <= 0 ||
        input.durationDays > STRATEGIC_CONSTANTS.MAX_CONSENT_DAYS
      ) {
        throw new StrategicLayerError(
          `durationDays must be in (0, ${STRATEGIC_CONSTANTS.MAX_CONSENT_DAYS}] — got ${input.durationDays}`,
          'INVALID_CONSENT_DURATION',
          { durationDays: input.durationDays },
        );
      }
      const grantedAt = now();
      const expiresAt = new Date(
        grantedAt.getTime() + input.durationDays * MS_PER_DAY,
      );
      const auditHash = computeStrategicAuditHash({
        op: 'consent_grant',
        tenantId: input.tenantId,
        scope: input.scope,
        grantedBy: input.grantedBy,
        grantedAt: grantedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
      });
      const row: FederationConsent = Object.freeze({
        tenantId: input.tenantId,
        scope: input.scope,
        grantedAt: grantedAt.toISOString(),
        expiresAt: expiresAt.toISOString(),
        grantedBy: input.grantedBy,
        status: 'active' as ConsentStatus,
        revokedAt: null,
        revokedBy: null,
        auditHash,
      });
      return repo.upsert(row);
    },

    async revoke(
      tenantId: string,
      scope: ConsentScope,
      revokedBy: string,
    ): Promise<FederationConsent> {
      const existing = await repo.find(tenantId, scope);
      if (existing === null) {
        throw new StrategicLayerError(
          `Cannot revoke absent consent: tenant=${tenantId} scope=${scope}`,
          'CONSENT_NOT_FOUND',
          { tenantId, scope },
        );
      }
      if (existing.status !== 'active') {
        // Idempotent: already revoked/expired.
        return existing;
      }
      const revokedAt = now().toISOString();
      const auditHash = computeStrategicAuditHash(
        {
          op: 'consent_revoke',
          tenantId,
          scope,
          revokedBy,
          revokedAt,
        },
        existing.auditHash,
      );
      const updated: FederationConsent = Object.freeze({
        ...existing,
        status: 'revoked' as ConsentStatus,
        revokedAt,
        revokedBy,
        auditHash,
      });
      return repo.upsert(updated);
    },

    async isAllowed(
      tenantId: string,
      scope: ConsentScope,
    ): Promise<boolean> {
      // Check for a direct match first, then the 'all' fallback.
      const direct = await repo.find(tenantId, scope);
      if (direct !== null && isActiveAt(direct, now())) {
        return true;
      }
      if (scope !== 'all') {
        const all = await repo.find(tenantId, 'all');
        if (all !== null && isActiveAt(all, now())) {
          return true;
        }
      }
      return false;
    },

    list(tenantId): Promise<ReadonlyArray<FederationConsent>> {
      return repo.list(tenantId);
    },
  };
}

function isActiveAt(consent: FederationConsent, at: Date): boolean {
  if (consent.status !== 'active') {
    return false;
  }
  return new Date(consent.expiresAt).getTime() > at.getTime();
}
