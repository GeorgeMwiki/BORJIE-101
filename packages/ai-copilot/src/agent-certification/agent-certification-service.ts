/**
 * AgentCertificationService
 *
 * Issues signed certificates tying (agent, tenant, scopes, expiry) and
 * verifies them on inbound calls (e.g. from @borjie/mcp-server).
 *
 * Signing uses HMAC-SHA256 over a canonical JSON body. The signing secret is
 * injected; tenants never see it. Verification is time-safe and tenant-scoped.
 */

import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import type {
  AgentCertificate,
  AgentScope,
  CertStore,
  IssueCertificateInput,
  VerifyResult,
} from './types.js';

export interface AgentCertificationServiceConfig {
  readonly signingSecret: string;
  readonly issuerId: string;
  readonly clockSkewMs?: number;
}

export class AgentCertificationService {
  private readonly store: CertStore;
  private readonly config: AgentCertificationServiceConfig;

  constructor(store: CertStore, config: AgentCertificationServiceConfig) {
    if (!config.signingSecret || config.signingSecret.length < 16) {
      throw new Error(
        'AgentCertificationService: signingSecret must be \u2265 16 chars',
      );
    }
    this.store = store;
    this.config = { clockSkewMs: 5_000, ...config };
  }

  async issue(input: IssueCertificateInput): Promise<AgentCertificate> {
    if (!input.agentId || !input.tenantId) {
      throw new Error('issue(): agentId and tenantId are required');
    }
    if (!Array.isArray(input.scopes) || input.scopes.length === 0) {
      throw new Error('issue(): at least one scope is required');
    }
    if (input.validForMs <= 0 || input.validForMs > THREE_YEARS_MS) {
      throw new Error(
        `issue(): validForMs must be in (0, ${THREE_YEARS_MS}] ms`,
      );
    }

    const issuedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + input.validForMs).toISOString();
    const id = `cert_${randomUUID()}`;

    const unsigned = {
      id,
      agentId: input.agentId,
      tenantId: input.tenantId,
      scopes: [...input.scopes].sort(),
      issuer: this.config.issuerId,
      issuedAt,
      expiresAt,
    };
    const signature = this.sign(unsigned);

    const cert: AgentCertificate = {
      ...unsigned,
      signature,
      revoked: false,
      metadata: input.metadata,
    };

    await this.store.insert(cert);
    return cert;
  }

  async verify(
    certId: string,
    tenantId: string,
    requiredScope: AgentScope,
  ): Promise<VerifyResult> {
    // nosemgrep: missing-tenant-id-arg reason: certs are globally-unique by certId; cross-tenant access is explicitly rejected on the next line via `cert.tenantId !== tenantId`.
    const cert = await this.store.findById(certId);
    if (!cert) return { ok: false, reason: 'not_found' };
    if (cert.tenantId !== tenantId) {
      return { ok: false, reason: 'tenant_mismatch', certificate: cert };
    }
    if (cert.revoked) {
      return { ok: false, reason: 'revoked', certificate: cert };
    }
    if (!cert.scopes.includes(requiredScope)) {
      return { ok: false, reason: 'scope_not_granted', certificate: cert };
    }
    const now = Date.now();
    const skew = this.config.clockSkewMs ?? 0;
    if (new Date(cert.expiresAt).getTime() + skew < now) {
      return { ok: false, reason: 'expired', certificate: cert };
    }
    if (!this.verifySignature(cert)) {
      return { ok: false, reason: 'bad_signature', certificate: cert };
    }
    return { ok: true, certificate: cert };
  }

  async revoke(
    certId: string,
    tenantId: string,
    revokedBy: string,
    reason: string,
  ): Promise<void> {
    // nosemgrep: missing-tenant-id-arg reason: certs are globally-unique by certId; cross-tenant revoke is explicitly rejected on the next lines via `cert.tenantId !== tenantId`.
    const cert = await this.store.findById(certId);
    if (!cert) throw new Error(`Certificate ${certId} not found`);
    if (cert.tenantId !== tenantId) {
      throw new Error('Cross-tenant revoke forbidden');
    }
    const now = new Date().toISOString();
    await this.store.markRevoked(certId, now, reason);
    await this.store.insertRevocation({
      id: `rev_${randomUUID()}`,
      certId,
      tenantId,
      revokedAt: now,
      revokedBy,
      reason,
    });
  }

  async listForTenant(tenantId: string): Promise<readonly AgentCertificate[]> {
    return this.store.listForTenant(tenantId);
  }

  async listRevocations(tenantId: string) {
    return this.store.listRevocations(tenantId);
  }

  private sign(body: Record<string, unknown>): string {
    const canonical = canonicalise(body);
    return createHmac('sha256', this.config.signingSecret)
      .update(canonical)
      .digest('hex');
  }

  private verifySignature(cert: AgentCertificate): boolean {
    const expected = this.sign({
      id: cert.id,
      agentId: cert.agentId,
      tenantId: cert.tenantId,
      scopes: [...cert.scopes].sort(),
      issuer: cert.issuer,
      issuedAt: cert.issuedAt,
      expiresAt: cert.expiresAt,
    });
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(cert.signature, 'hex');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
}

const THREE_YEARS_MS = 3 * 365 * 24 * 60 * 60 * 1000;

function canonicalise(obj: Record<string, unknown>): string {
  const keys = Object.keys(obj).sort();
  const pairs = keys.map((k) => {
    const value = obj[k];
    const serialised =
      Array.isArray(value) ? JSON.stringify(value) : JSON.stringify(value);
    return `${k}=${serialised}`;
  });
  return pairs.join('&');
}
