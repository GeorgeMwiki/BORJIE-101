/**
 * SQL-backed `TacitConsentRepository`.
 *
 * Wave HARVEST. Issues parameterised SQL against the `tacit_consents`
 * table created by migration `0044_tacit_knowledge.sql`. PK is
 * `(subject_user_id, tenant_id)`.
 */

import type { Consent, ConsentStatus, TacitConsentRepository } from '../types.js';
import { computeTacitAuditHash } from '../audit/audit-chain-link.js';
import type { SqlRunner } from './sql-runner.js';

interface RawRow extends Readonly<Record<string, unknown>> {
  readonly subject_user_id: string;
  readonly tenant_id: string;
  readonly status: string;
  readonly granted_at: string;
  readonly revoked_at: string | null;
  readonly audit_hash: string;
}

function mapRow(row: RawRow): Consent {
  return Object.freeze({
    subjectUserId: row.subject_user_id,
    tenantId: row.tenant_id,
    status: row.status as ConsentStatus,
    grantedAt: row.granted_at,
    revokedAt: row.revoked_at,
    auditHash: row.audit_hash,
  });
}

interface SqlConsentRepoDeps {
  readonly runner: SqlRunner;
  readonly now: () => Date;
}

export function createSqlTacitConsentRepository(
  deps: SqlConsentRepoDeps,
): TacitConsentRepository {
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
      const sql = `
        INSERT INTO tacit_consents (
          subject_user_id, tenant_id, status, granted_at, revoked_at, audit_hash
        ) VALUES ($1, $2, 'granted', $3, NULL, $4)
        ON CONFLICT (subject_user_id, tenant_id) DO UPDATE
          SET status = 'granted',
              granted_at = EXCLUDED.granted_at,
              revoked_at = NULL,
              audit_hash = EXCLUDED.audit_hash
        RETURNING subject_user_id, tenant_id, status, granted_at, revoked_at, audit_hash
      `;
      const rs = await deps.runner.execute<RawRow>(sql, [
        subjectUserId,
        tenantId,
        grantedAt,
        auditHash,
      ]);
      const head = rs[0];
      if (head === undefined) {
        throw new Error('tacit_consents grant returned no row');
      }
      return mapRow(head);
    },

    async revoke(
      subjectUserId: string,
      tenantId: string,
    ): Promise<Consent | null> {
      const existingRs = await deps.runner.execute<RawRow>(
        `SELECT subject_user_id, tenant_id, status, granted_at, revoked_at, audit_hash
         FROM tacit_consents
         WHERE subject_user_id = $1 AND tenant_id = $2`,
        [subjectUserId, tenantId],
      );
      const existing = existingRs[0];
      if (existing === undefined) return null;
      const revokedAt = deps.now().toISOString();
      const auditHash = computeTacitAuditHash(
        {
          kind: 'consent.revoke',
          subjectUserId,
          tenantId,
          revokedAt,
        },
        existing.audit_hash,
      );
      const sql = `
        UPDATE tacit_consents
        SET status = 'revoked', revoked_at = $3, audit_hash = $4
        WHERE subject_user_id = $1 AND tenant_id = $2
        RETURNING subject_user_id, tenant_id, status, granted_at, revoked_at, audit_hash
      `;
      const rs = await deps.runner.execute<RawRow>(sql, [
        subjectUserId,
        tenantId,
        revokedAt,
        auditHash,
      ]);
      const head = rs[0];
      return head === undefined ? null : mapRow(head);
    },

    async read(
      subjectUserId: string,
      tenantId: string,
    ): Promise<Consent | null> {
      const sql = `
        SELECT subject_user_id, tenant_id, status, granted_at, revoked_at, audit_hash
        FROM tacit_consents
        WHERE subject_user_id = $1 AND tenant_id = $2
      `;
      const rs = await deps.runner.execute<RawRow>(sql, [
        subjectUserId,
        tenantId,
      ]);
      const head = rs[0];
      return head === undefined ? null : mapRow(head);
    },
  };
}
