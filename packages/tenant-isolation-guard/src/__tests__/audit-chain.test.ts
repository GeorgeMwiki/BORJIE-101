/**
 * Tests for the audit-chain tenant continuity guard.
 *
 * Persona: Mr. Mwikila, SEC-1.
 */
import { describe, it, expect } from 'vitest';
import {
  assertTenantChainContinuity,
  assertTenantChainContinuitySync,
  type AuditChainEntry,
  type PrevHashLookup,
} from '../audit/tenant-chain-guard.js';
import { runInTenantContext } from '../context/tenant-context.js';
import { asTenantId, IsolationViolation, type TenantContext, type TenantId } from '../types.js';

function makeCtx(t: string): TenantContext {
  const tid = asTenantId(t) as TenantId;
  return { tenantId: tid, actorTenantId: tid, requestId: 'req_chain_test' };
}

describe('tenant-chain-guard', () => {
  it('allows null prev_hash (genesis entry)', async () => {
    const ctx = makeCtx('tenant_alpha');
    const lookup: PrevHashLookup = async () => null;
    await runInTenantContext(ctx, async () => {
      await expect(
        assertTenantChainContinuity({ prevHash: null, lookup }),
      ).resolves.toBeUndefined();
    });
  });

  it('throws when prev_hash references another tenant', async () => {
    const ctx = makeCtx('tenant_alpha');
    const lookup: PrevHashLookup = async () => ({
      id: 'e1',
      tenant_id: 'tenant_beta',
      prev_hash: null,
      hash: 'h-prev',
      created_at: '2026-05-26T00:00:00Z',
    });
    await runInTenantContext(ctx, async () => {
      await expect(
        assertTenantChainContinuity({ prevHash: 'h-prev', lookup }),
      ).rejects.toBeInstanceOf(IsolationViolation);
    });
  });

  it('throws when prev_hash is not resolvable in tenant chain', async () => {
    const ctx = makeCtx('tenant_alpha');
    const lookup: PrevHashLookup = async () => null;
    await runInTenantContext(ctx, async () => {
      await expect(
        assertTenantChainContinuity({ prevHash: 'h-missing', lookup }),
      ).rejects.toBeInstanceOf(IsolationViolation);
    });
  });

  it('sync variant accepts same-tenant prev entry', async () => {
    const ctx = makeCtx('tenant_alpha');
    const entry: AuditChainEntry = {
      id: 'e1',
      tenant_id: 'tenant_alpha',
      prev_hash: null,
      hash: 'h-prev',
      created_at: '2026-05-26T00:00:00Z',
    };
    await runInTenantContext(ctx, () => {
      expect(() => assertTenantChainContinuitySync({ prevHashEntry: entry })).not.toThrow();
    });
  });
});
