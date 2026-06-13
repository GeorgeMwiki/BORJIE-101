/**
 * Engine-level egress chokepoint: a tab carrying a disallowed URL must NOT be
 * persistable when a `urlEgressPolicy` is wired, and the same tab must persist
 * when no policy is supplied (opt-in, backward-compatible). This proves the
 * membrane gates the real storage path, not just the standalone validator.
 */

import { describe, expect, it } from 'vitest';
import { createGenUIEngine } from '../engine.js';
import { PortalGenUiEgressError } from '../security/url-egress.js';
import { verifyAuditChain } from '../audit/audit-chain.js';

const POLICY = { allowedHosts: ['supabase.co', 'borjie.app'] };

async function generateTab(engine = createGenUIEngine()) {
  const intent = (await engine.detectIntent({
    message: 'we need to track our staff payroll',
  }))!;
  const out = await engine.generate({
    intent,
    tenantId: 't1',
    userId: 'u1',
    actorId: 'system',
  });
  return out.tab;
}

describe('engine egress chokepoint', () => {
  it('rejects persisting a tab whose spec carries a disallowed URL', async () => {
    const engine = createGenUIEngine({ urlEgressPolicy: POLICY });
    const tab = await generateTab();
    const poisoned = { ...tab, title: 'https://evil.example/exfil?d=secret' };

    await expect(engine.persist({ tab: poisoned })).rejects.toBeInstanceOf(
      PortalGenUiEgressError,
    );
  });

  it('allows persisting a tab whose URLs are all allowlisted', async () => {
    const engine = createGenUIEngine({ urlEgressPolicy: POLICY });
    const tab = await generateTab();
    const ok = { ...tab, title: 'https://files.borjie.app/report.pdf' };

    const result = await engine.persist({ tab: ok });
    expect(result.id).toBeTruthy();
  });

  it('does not gate when no policy is wired (opt-in)', async () => {
    const engine = createGenUIEngine();
    const tab = await generateTab();
    const poisoned = { ...tab, title: 'https://evil.example/exfil?d=secret' };

    const result = await engine.persist({ tab: poisoned });
    expect(result.id).toBeTruthy();
  });

  it('seals the audit chain on persist (stored tab is tamper-evident)', async () => {
    const engine = createGenUIEngine();
    const tab = await generateTab(engine);
    const { id } = await engine.persist({ tab });

    const stored = await engine.get(id);
    expect(stored).toBeTruthy();
    expect((stored!.audit.history[0] as { hash?: string }).hash).toBeTruthy();
    expect(verifyAuditChain(stored!.audit).ok).toBe(true);
  });
});
