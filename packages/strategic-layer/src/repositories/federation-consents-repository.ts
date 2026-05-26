/**
 * Repository for `federation_consents` (in-memory + SQL adapters).
 *
 * PK is the composite `(tenant_id, scope)`. `upsert` is the only
 * write path — grant and revoke both go through it.
 */

import {
  type ConsentScope,
  type ConsentStatus,
  type FederationConsent,
  type FederationConsentsRepository,
} from '../types.js';
import type { SqlRunner } from './sql-runner.js';

// ---------------------------------------------------------------------------
// In-memory adapter
// ---------------------------------------------------------------------------

export function createInMemoryFederationConsentsRepository(): FederationConsentsRepository {
  // Composite-key map: `${tenantId}::${scope}` → row.
  const rows = new Map<string, FederationConsent>();

  const key = (tenantId: string, scope: ConsentScope): string =>
    `${tenantId}::${scope}`;

  return {
    async upsert(row: FederationConsent): Promise<FederationConsent> {
      const frozen = Object.freeze({ ...row });
      rows.set(key(frozen.tenantId, frozen.scope), frozen);
      return frozen;
    },

    async find(
      tenantId: string,
      scope: ConsentScope,
    ): Promise<FederationConsent | null> {
      return rows.get(key(tenantId, scope)) ?? null;
    },

    async list(
      tenantId: string,
    ): Promise<ReadonlyArray<FederationConsent>> {
      const out: FederationConsent[] = [];
      for (const row of rows.values()) {
        if (row.tenantId === tenantId) {
          out.push(row);
        }
      }
      return out;
    },
  };
}

// ---------------------------------------------------------------------------
// SQL adapter
// ---------------------------------------------------------------------------

interface SqlConsentRow {
  readonly tenant_id: string;
  readonly scope: string;
  readonly granted_at: Date | string;
  readonly expires_at: Date | string;
  readonly granted_by: string;
  readonly status: string;
  readonly revoked_at: Date | string | null;
  readonly revoked_by: string | null;
  readonly audit_hash: string;
}

export function createSqlFederationConsentsRepository(
  sql: SqlRunner,
): FederationConsentsRepository {
  return {
    async upsert(row: FederationConsent): Promise<FederationConsent> {
      await sql.query(
        `INSERT INTO federation_consents
           (tenant_id, scope, granted_at, expires_at, granted_by, status,
            revoked_at, revoked_by, audit_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         ON CONFLICT (tenant_id, scope) DO UPDATE
           SET granted_at = EXCLUDED.granted_at,
               expires_at = EXCLUDED.expires_at,
               granted_by = EXCLUDED.granted_by,
               status     = EXCLUDED.status,
               revoked_at = EXCLUDED.revoked_at,
               revoked_by = EXCLUDED.revoked_by,
               audit_hash = EXCLUDED.audit_hash`,
        [
          row.tenantId,
          row.scope,
          row.grantedAt,
          row.expiresAt,
          row.grantedBy,
          row.status,
          row.revokedAt,
          row.revokedBy,
          row.auditHash,
        ],
      );
      return row;
    },

    async find(
      tenantId: string,
      scope: ConsentScope,
    ): Promise<FederationConsent | null> {
      const result = await sql.query<SqlConsentRow>(
        `SELECT * FROM federation_consents
          WHERE tenant_id = $1 AND scope = $2`,
        [tenantId, scope],
      );
      const first = result.rows[0];
      return first === undefined ? null : mapSqlRow(first);
    },

    async list(
      tenantId: string,
    ): Promise<ReadonlyArray<FederationConsent>> {
      const result = await sql.query<SqlConsentRow>(
        `SELECT * FROM federation_consents WHERE tenant_id = $1`,
        [tenantId],
      );
      return result.rows.map(mapSqlRow);
    },
  };
}

function mapSqlRow(row: SqlConsentRow): FederationConsent {
  return Object.freeze({
    tenantId: row.tenant_id,
    scope: row.scope as ConsentScope,
    grantedAt: typeof row.granted_at === 'string'
      ? row.granted_at
      : row.granted_at.toISOString(),
    expiresAt: typeof row.expires_at === 'string'
      ? row.expires_at
      : row.expires_at.toISOString(),
    grantedBy: row.granted_by,
    status: row.status as ConsentStatus,
    revokedAt:
      row.revoked_at === null
        ? null
        : typeof row.revoked_at === 'string'
          ? row.revoked_at
          : row.revoked_at.toISOString(),
    revokedBy: row.revoked_by,
    auditHash: row.audit_hash,
  });
}
