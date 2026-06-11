import { describe, it, expect } from 'vitest';
import {
  buildCanonicalRlsBlock,
  verifyRlsForced,
  TENANT_GUC,
  SERVICE_ROLE_GUC,
} from '../rls-force-injector.js';
import { TENANT, ns } from './fakes.js';

describe('buildCanonicalRlsBlock', () => {
  it('emits ENABLE + FORCE + tenant_isolation + service_role_bypass + REVOKE anon', () => {
    const block = buildCanonicalRlsBlock(TENANT, [ns('assay')]);
    expect(block).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(block).toMatch(/FORCE ROW LEVEL SECURITY/);
    expect(block).toMatch(/CREATE POLICY tenant_isolation/);
    expect(block).toMatch(/CREATE POLICY service_role_bypass/);
    expect(block).toContain(`tenant_id = ${TENANT_GUC}`);
    expect(block).toContain(`${SERVICE_ROLE_GUC} = 'true'`);
    expect(block).toMatch(/REVOKE ALL ON public\.%I FROM anon/);
    expect(block).toMatch(/pg_roles WHERE rolname = 'anon'/);
  });

  it('throws when given a non-namespaced table', () => {
    expect(() => buildCanonicalRlsBlock(TENANT, ['tenants'])).toThrow();
  });

  it('throws on a non-slug tenantId', () => {
    expect(() => buildCanonicalRlsBlock('BAD;DROP', [ns('assay')])).toThrow();
  });

  it('throws on an empty table list', () => {
    expect(() => buildCanonicalRlsBlock(TENANT, [])).toThrow();
  });
});

describe('verifyRlsForced', () => {
  it('accepts a migration where every spawned table is FORCE-RLS covered', () => {
    const t = ns('assay');
    const block = buildCanonicalRlsBlock(TENANT, [t]);
    const r = verifyRlsForced(block, [t]);
    expect(r.ok).toBe(true);
  });

  it('rejects when a spawned table is missing from the RLS block', () => {
    const block = buildCanonicalRlsBlock(TENANT, [ns('assay')]);
    const r = verifyRlsForced(block, [ns('assay'), ns('shipment')]);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/shipment/);
  });

  it('rejects RLS bound to a NON-canonical GUC (legacy current_app_tenant_id)', () => {
    const t = ns('assay');
    const legacy = [
      `ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`,
      `ALTER TABLE public.${t} FORCE ROW LEVEL SECURITY;`,
      `CREATE POLICY tenant_isolation ON public.${t} FOR ALL USING (tenant_id = public.current_app_tenant_id());`,
      `CREATE POLICY service_role_bypass ON public.${t} FOR ALL USING (true);`,
    ].join('\n');
    const r = verifyRlsForced(legacy, [t]);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/non-canonical GUC/i);
  });

  it('rejects RLS bound to an arbitrary foreign app setting name', () => {
    const t = ns('assay');
    const foreign = [
      `ALTER TABLE public.${t} ENABLE ROW LEVEL SECURITY;`,
      `ALTER TABLE public.${t} FORCE ROW LEVEL SECURITY;`,
      `CREATE POLICY tenant_isolation ON public.${t} FOR ALL USING (tenant_id = current_setting('app.evil_tenant', true));`,
      `CREATE POLICY service_role_bypass ON public.${t} FOR ALL USING (current_setting('app.is_service_role', true) = 'true');`,
    ].join('\n');
    const r = verifyRlsForced(foreign, [t]);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/non-canonical GUC/i);
  });
});

// ─────────────────────────────────────────────────────────────────────
// FIX 2 — per-table (not global) policy + GUC verification. The earlier
// `/CREATE POLICY tenant_isolation/.test(wholeSql)` form let a SECOND
// table carry ENABLE+FORCE with ZERO policies (or a `USING (true)`) yet
// pass because SOME other table's block contained the policy keyword.
// ─────────────────────────────────────────────────────────────────────
describe('verifyRlsForced — per-table policy coverage (FIX 2)', () => {
  it('accepts the canonical FOREACH block as the control (still ACCEPTED)', () => {
    const t1 = ns('assay');
    const t2 = ns('shipment');
    const block = buildCanonicalRlsBlock(TENANT, [t1, t2]);
    const r = verifyRlsForced(block, [t1, t2], TENANT);
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it('REJECTS a 2-table block where table B has ENABLE+FORCE but NO policy', () => {
    // Table A is fully covered by a canonical-shaped block; table B is
    // bolted on with ENABLE+FORCE but no policy. The OLD global check
    // would see table A's CREATE POLICY keyword and wave B through.
    const a = ns('assay');
    const b = ns('shipment');
    const blockForA = buildCanonicalRlsBlock(TENANT, [a]);
    const bWithoutPolicy = [
      `ALTER TABLE public.${b} ENABLE ROW LEVEL SECURITY;`,
      `ALTER TABLE public.${b} FORCE ROW LEVEL SECURITY;`,
    ].join('\n');
    const sql = `${blockForA}\n\n${bWithoutPolicy}`;
    const r = verifyRlsForced(sql, [a, b]);
    expect(r.ok).toBe(false);
    // B is not listed in the (single) canonical block's table array, and
    // its hand-rolled ENABLE/FORCE lives outside that block.
    expect(r.errors.join(' ')).toMatch(
      new RegExp(`${b}|outside the canonical guard block`, 'i'),
    );
  });

  it('REJECTS a per-table tenant_isolation bound to USING (true)', () => {
    const t = ns('assay');
    const wideOpen = [
      'DO $ddlguard_rls$',
      'DECLARE tbl text;',
      `  tenant_tables text[] := ARRAY[ '${t}' ];`,
      'BEGIN',
      '  FOREACH tbl IN ARRAY tenant_tables LOOP',
      "    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', tbl);",
      "    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY;', tbl);",
      '    EXECUTE format($pol$',
      '      CREATE POLICY tenant_isolation ON public.%I',
      '      FOR ALL USING (true) WITH CHECK (true);',
      '    $pol$, tbl);',
      '    EXECUTE format($pol$',
      `      CREATE POLICY service_role_bypass ON public.%I FOR ALL USING (${SERVICE_ROLE_GUC} = 'true') WITH CHECK (${SERVICE_ROLE_GUC} = 'true');`,
      '    $pol$, tbl);',
      '  END LOOP;',
      'END',
      '$ddlguard_rls$;',
    ].join('\n');
    const r = verifyRlsForced(wideOpen, [t]);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/canonical USING|tenant_isolation/i);
  });

  it('REJECTS an author-supplied CREATE POLICY outside the canonical block', () => {
    const t = ns('assay');
    const block = buildCanonicalRlsBlock(TENANT, [t]);
    const sql = `${block}\nCREATE POLICY backdoor ON public.${t} FOR ALL USING (true);`;
    const r = verifyRlsForced(sql, [t], TENANT);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/outside the canonical guard block/i);
  });

  it('REJECTS a hand-rolled block that does not byte-match the canonical (tenantId supplied)', () => {
    // Structurally plausible but author-authored: a second FOR ALL clause
    // / reordered text will not byte-match the freshly-built canonical.
    const t = ns('assay');
    const built = buildCanonicalRlsBlock(TENANT, [t]);
    const tampered = built.replace('FOR ALL', 'FOR ALL /* tamper */');
    const r = verifyRlsForced(tampered, [t], TENANT);
    expect(r.ok).toBe(false);
    expect(r.errors.join(' ')).toMatch(/byte-match the canonical|outside the canonical/i);
  });
});
