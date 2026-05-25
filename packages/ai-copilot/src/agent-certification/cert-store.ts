/**
 * Cert store \u2014 in-memory + Postgres-backed implementations.
 *
 * The in-memory store is used for unit tests and pilot environments. The
 * Postgres store uses the `agent_certifications` and
 * `agent_cert_revocations` tables introduced in migration 0055.
 *
 * Both implementations preserve immutability: certificates are never
 * mutated after insert. Revocation creates a new row in the revocations
 * table AND flips the `revoked` flag on the certificate via markRevoked().
 */

import type {
  AgentCertificate,
  CertRevocation,
  CertStore,
} from './types.js';

export class InMemoryCertStore implements CertStore {
  private certs: readonly AgentCertificate[] = [];
  private revocations: readonly CertRevocation[] = [];

  async insert(cert: AgentCertificate): Promise<void> {
    this.certs = [...this.certs, { ...cert }];
  }

  async findById(certId: string): Promise<AgentCertificate | null> {
    return this.certs.find((c) => c.id === certId) ?? null;
  }

  async findByAgentAndTenant(
    agentId: string,
    tenantId: string,
  ): Promise<readonly AgentCertificate[]> {
    return this.certs.filter(
      (c) => c.agentId === agentId && c.tenantId === tenantId,
    );
  }

  async markRevoked(
    certId: string,
    revokedAt: string,
    reason: string,
  ): Promise<void> {
    this.certs = this.certs.map((c) =>
      c.id === certId
        ? { ...c, revoked: true, revokedAt, revokedReason: reason }
        : c,
    );
  }

  async listForTenant(
    tenantId: string,
  ): Promise<readonly AgentCertificate[]> {
    return this.certs.filter((c) => c.tenantId === tenantId);
  }

  async insertRevocation(revocation: CertRevocation): Promise<void> {
    this.revocations = [...this.revocations, { ...revocation }];
  }

  async listRevocations(
    tenantId: string,
  ): Promise<readonly CertRevocation[]> {
    return this.revocations.filter((r) => r.tenantId === tenantId);
  }
}

/**
 * Shape of the DB row helper. Kept minimal: the real driver (pg / postgres.js)
 * is injected by the composition root so this file stays driver-agnostic.
 */
export interface SqlRunner {
  query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ rows: readonly Row[] }>;
}

export class PostgresCertStore implements CertStore {
  constructor(private readonly sql: SqlRunner) {}

  async insert(cert: AgentCertificate): Promise<void> {
    await this.sql.query(
      `INSERT INTO agent_certifications (
        id, agent_id, tenant_id, scopes, issuer,
        issued_at, expires_at, signature, revoked, metadata
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        cert.id,
        cert.agentId,
        cert.tenantId,
        JSON.stringify(cert.scopes),
        cert.issuer,
        cert.issuedAt,
        cert.expiresAt,
        cert.signature,
        cert.revoked,
        JSON.stringify(cert.metadata ?? {}),
      ],
    );
  }

  async findById(certId: string): Promise<AgentCertificate | null> {
    const { rows } = await this.sql.query<Record<string, unknown>>(
      `SELECT * FROM agent_certifications WHERE id = $1`,
      [certId],
    );
    return rows[0] ? mapRow(rows[0]) : null;
  }

  async findByAgentAndTenant(
    agentId: string,
    tenantId: string,
  ): Promise<readonly AgentCertificate[]> {
    const { rows } = await this.sql.query<Record<string, unknown>>(
      `SELECT * FROM agent_certifications
       WHERE agent_id = $1 AND tenant_id = $2
       ORDER BY issued_at DESC`,
      [agentId, tenantId],
    );
    return rows.map(mapRow);
  }

  async markRevoked(
    certId: string,
    revokedAt: string,
    reason: string,
  ): Promise<void> {
    await this.sql.query(
      `UPDATE agent_certifications
       SET revoked = TRUE, revoked_at = $2, revoked_reason = $3
       WHERE id = $1`,
      [certId, revokedAt, reason],
    );
  }

  async listForTenant(
    tenantId: string,
  ): Promise<readonly AgentCertificate[]> {
    const { rows } = await this.sql.query<Record<string, unknown>>(
      `SELECT * FROM agent_certifications
       WHERE tenant_id = $1
       ORDER BY issued_at DESC`,
      [tenantId],
    );
    return rows.map(mapRow);
  }

  async insertRevocation(revocation: CertRevocation): Promise<void> {
    await this.sql.query(
      `INSERT INTO agent_cert_revocations (
        id, cert_id, tenant_id, revoked_at, revoked_by, reason
      ) VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        revocation.id,
        revocation.certId,
        revocation.tenantId,
        revocation.revokedAt,
        revocation.revokedBy,
        revocation.reason,
      ],
    );
  }

  async listRevocations(
    tenantId: string,
  ): Promise<readonly CertRevocation[]> {
    const { rows } = await this.sql.query<Record<string, unknown>>(
      `SELECT * FROM agent_cert_revocations
       WHERE tenant_id = $1
       ORDER BY revoked_at DESC`,
      [tenantId],
    );
    return rows.map((r) => ({
      id: String(r.id),
      certId: String(r.cert_id),
      tenantId: String(r.tenant_id),
      revokedAt: String(r.revoked_at),
      revokedBy: String(r.revoked_by),
      reason: String(r.reason),
    }));
  }
}

function mapRow(row: Record<string, unknown>): AgentCertificate {
  return {
    id: String(row.id),
    agentId: String(row.agent_id),
    tenantId: String(row.tenant_id),
    scopes: parseScopes(row.scopes),
    issuer: String(row.issuer),
    issuedAt: String(row.issued_at),
    expiresAt: String(row.expires_at),
    signature: String(row.signature),
    revoked: Boolean(row.revoked),
    revokedAt: row.revoked_at ? String(row.revoked_at) : undefined,
    revokedReason: row.revoked_reason ? String(row.revoked_reason) : undefined,
    metadata: parseMetadata(row.metadata),
  };
}

function parseScopes(raw: unknown): readonly AgentCertificate['scopes'][number][] {
  if (Array.isArray(raw)) return raw as AgentCertificate['scopes'];
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }
  return [];
}

function parseMetadata(
  raw: unknown,
): Readonly<Record<string, unknown>> | undefined {
  if (raw == null) return undefined;
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return undefined;
    }
  }
  return undefined;
}
