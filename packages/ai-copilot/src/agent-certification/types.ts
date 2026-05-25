/**
 * Agent certification types.
 *
 * Certificates are signed statements that an agent (internal or external /
 * partner via MCP) is authorised to act against a tenant's data inside a
 * specific scope set, up until expiry. Revocation is supported.
 */

export type AgentScope =
  | 'properties.read'
  | 'properties.write'
  | 'leases.read'
  | 'leases.write'
  | 'arrears.read'
  | 'arrears.write'
  | 'maintenance.read'
  | 'maintenance.write'
  | 'documents.read'
  | 'documents.write'
  | 'financials.read'
  | 'financials.write'
  | 'tenants.read'
  | 'tenants.write'
  | 'compliance.read'
  | 'inspections.read'
  | 'inspections.write'
  | 'copilot.invoke';

export const ALL_SCOPES: readonly AgentScope[] = [
  'properties.read',
  'properties.write',
  'leases.read',
  'leases.write',
  'arrears.read',
  'arrears.write',
  'maintenance.read',
  'maintenance.write',
  'documents.read',
  'documents.write',
  'financials.read',
  'financials.write',
  'tenants.read',
  'tenants.write',
  'compliance.read',
  'inspections.read',
  'inspections.write',
  'copilot.invoke',
] as const;

export interface AgentCertificate {
  readonly id: string;
  readonly agentId: string;
  readonly tenantId: string;
  readonly scopes: readonly AgentScope[];
  readonly issuer: string;
  readonly issuedAt: string;
  readonly expiresAt: string;
  readonly signature: string;
  readonly revoked: boolean;
  readonly revokedAt?: string;
  readonly revokedReason?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface IssueCertificateInput {
  readonly agentId: string;
  readonly tenantId: string;
  readonly scopes: readonly AgentScope[];
  readonly issuer: string;
  readonly validForMs: number;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface VerifyResult {
  readonly ok: boolean;
  readonly reason?:
    | 'not_found'
    | 'tenant_mismatch'
    | 'expired'
    | 'revoked'
    | 'scope_not_granted'
    | 'bad_signature';
  readonly certificate?: AgentCertificate;
}

export interface CertRevocation {
  readonly id: string;
  readonly certId: string;
  readonly tenantId: string;
  readonly revokedAt: string;
  readonly revokedBy: string;
  readonly reason: string;
}

export interface CertStore {
  insert(cert: AgentCertificate): Promise<void>;
  findById(certId: string): Promise<AgentCertificate | null>;
  findByAgentAndTenant(
    agentId: string,
    tenantId: string,
  ): Promise<readonly AgentCertificate[]>;
  markRevoked(
    certId: string,
    revokedAt: string,
    reason: string,
  ): Promise<void>;
  listForTenant(tenantId: string): Promise<readonly AgentCertificate[]>;
  insertRevocation(revocation: CertRevocation): Promise<void>;
  listRevocations(tenantId: string): Promise<readonly CertRevocation[]>;
}
