/**
 * Tests for the Pino tenant log scrubber.
 *
 * Persona: Mr. Mwikila, SEC-1.
 */
import { describe, it, expect } from 'vitest';
import { scrubLogEntry, deepScrubLogEntry } from '../logging/tenant-scrubber.js';
import { runInTenantContext } from '../context/tenant-context.js';
import { asTenantId, type TenantContext, type TenantId } from '../types.js';

function makeCtx(t: string): TenantContext {
  const tid = asTenantId(t) as TenantId;
  return { tenantId: tid, actorTenantId: tid, requestId: 'req_scrub_test' };
}

describe('tenant-scrubber', () => {
  it('redacts cross-tenant id in a log entry', async () => {
    const ctx = makeCtx('tenant_alpha');
    await runInTenantContext(ctx, () => {
      const out = scrubLogEntry({ tenantId: 'tenant_beta', msg: 'hello' });
      expect(out.tenantId).toBe('[REDACTED:CROSS-TENANT]');
      expect(out._isolationViolation).toBeDefined();
      expect(out._isolationViolation?.observedTenantId).toBe('tenant_beta');
    });
  });

  it('adds tenantId when context is bound and entry lacks one', async () => {
    const ctx = makeCtx('tenant_alpha');
    await runInTenantContext(ctx, () => {
      const out = scrubLogEntry({ msg: 'hi' });
      expect(out.tenantId).toBe('tenant_alpha');
    });
  });

  it('leaves entries unchanged when there is no bound context', () => {
    const out = scrubLogEntry({ msg: 'standalone' });
    expect(out).toEqual({ msg: 'standalone' });
  });

  it('deepScrubLogEntry walks nested objects', async () => {
    const ctx = makeCtx('tenant_alpha');
    await runInTenantContext(ctx, () => {
      const out = deepScrubLogEntry({
        msg: 'wrap',
        nested: { tenantId: 'tenant_beta', detail: 'leaky' },
      });
      const nested = out.nested as Record<string, unknown>;
      expect(nested.tenantId).toBe('[REDACTED:CROSS-TENANT]');
      expect(nested._isolationViolation).toBeDefined();
    });
  });
});
