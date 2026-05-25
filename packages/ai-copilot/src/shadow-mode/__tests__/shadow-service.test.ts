/**
 * ShadowService tests — Wave 28.
 *
 * Validate:
 *   - enable/disable toggles config for the given domains
 *   - isShadow returns true only for enabled (tenant, domain) pairs
 *   - disablesAt auto-expires the config
 *   - recordDecision persists a row
 *   - generateReport tallies by domain + computes agreement
 *   - report bucket with no human decisions returns null agreementPct
 *   - duplicate enable calls are idempotent / union-merge domains
 *   - disable that drops the last domain removes the config entirely
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  ShadowService,
  InMemoryShadowModeRepository,
} from '../index.js';

const TENANT = 'tenant_shadow_1';

describe('ShadowService', () => {
  let svc: ShadowService;
  let repo: InMemoryShadowModeRepository;

  beforeEach(() => {
    repo = new InMemoryShadowModeRepository();
    svc = new ShadowService({ repository: repo });
  });

  it('enable adds domains and marks config recordOnly', async () => {
    const cfg = await svc.enable(TENANT, ['finance', 'leasing'], 7);
    expect(cfg.tenantId).toBe(TENANT);
    expect(cfg.domains).toContain('finance');
    expect(cfg.domains).toContain('leasing');
    expect(cfg.recordOnly).toBe(true);
    expect(cfg.disablesAt).not.toBeNull();
  });

  it('enable is union-merging — called twice, both sets are present', async () => {
    await svc.enable(TENANT, ['finance'], null);
    const second = await svc.enable(TENANT, ['leasing'], null);
    expect(second.domains).toEqual(expect.arrayContaining(['finance', 'leasing']));
  });

  it('isShadow returns true only for enabled domains', async () => {
    await svc.enable(TENANT, ['finance'], null);
    expect(await svc.isShadow(TENANT, 'finance')).toBe(true);
    expect(await svc.isShadow(TENANT, 'leasing')).toBe(false);
    expect(await svc.isShadow('other_tenant', 'finance')).toBe(false);
  });

  it('disable removes specific domains', async () => {
    await svc.enable(TENANT, ['finance', 'leasing', 'maintenance'], null);
    const after = await svc.disable(TENANT, ['leasing']);
    expect(after?.domains).toEqual(expect.arrayContaining(['finance', 'maintenance']));
    expect(after?.domains).not.toContain('leasing');
  });

  it('disable that removes all domains drops the config entirely', async () => {
    await svc.enable(TENANT, ['finance'], null);
    const after = await svc.disable(TENANT, ['finance']);
    expect(after).toBeNull();
    expect(await svc.getStatus(TENANT)).toBeNull();
  });

  it('disablesAt auto-expires — getStatus returns null when past', async () => {
    const fixedStart = new Date('2026-01-01T00:00:00Z');
    let cursor = fixedStart;
    const moving = new ShadowService({
      repository: repo,
      clock: () => cursor,
    });
    await moving.enable(TENANT, ['finance'], 1); // 1 day
    expect(await moving.getStatus(TENANT)).not.toBeNull();
    cursor = new Date('2026-01-05T00:00:00Z');
    expect(await moving.getStatus(TENANT)).toBeNull();
  });

  it('recordDecision persists and report tallies', async () => {
    await svc.recordDecision({
      tenantId: TENANT,
      domain: 'finance',
      wouldHaveActed: true,
      action: 'auto_send_reminder',
      rationale: 'above threshold',
      counterfactualConfidence: 0.88,
      humanDecision: 'approved',
      humanDecidedAt: new Date().toISOString(),
    });
    await svc.recordDecision({
      tenantId: TENANT,
      domain: 'finance',
      wouldHaveActed: false,
      action: 'skip_reminder',
      rationale: 'inside grace',
      counterfactualConfidence: 0.6,
      humanDecision: 'rejected',
      humanDecidedAt: new Date().toISOString(),
    });
    const report = await svc.generateReport(
      TENANT,
      new Date(Date.now() - 3_600_000).toISOString(),
      new Date(Date.now() + 3_600_000).toISOString(),
    );
    expect(report.totalDecisions).toBe(2);
    expect(report.wouldHaveActedCount).toBe(1);
    expect(report.byDomain.finance).toBeDefined();
    expect(report.byDomain.finance.total).toBe(2);
    // Both rows agree (acted+approved, notActed+rejected)
    expect(report.overallAgreementPct).toBe(1);
  });

  it('report bucket with no human decision returns null agreementPct', async () => {
    await svc.recordDecision({
      tenantId: TENANT,
      domain: 'leasing',
      wouldHaveActed: true,
      action: 'approve_renewal',
      rationale: 'within policy',
      counterfactualConfidence: 0.9,
      humanDecision: null,
      humanDecidedAt: null,
    });
    const report = await svc.generateReport(
      TENANT,
      new Date(Date.now() - 3_600_000).toISOString(),
      new Date(Date.now() + 3_600_000).toISOString(),
    );
    expect(report.byDomain.leasing.agreementPct).toBeNull();
    expect(report.overallAgreementPct).toBeNull();
  });

  it('tenant isolation — never leaks between tenants', async () => {
    await svc.enable('tenant_a', ['finance'], null);
    await svc.enable('tenant_b', ['leasing'], null);
    expect(await svc.isShadow('tenant_a', 'finance')).toBe(true);
    expect(await svc.isShadow('tenant_a', 'leasing')).toBe(false);
    expect(await svc.isShadow('tenant_b', 'finance')).toBe(false);
    expect(await svc.isShadow('tenant_b', 'leasing')).toBe(true);
  });
});
