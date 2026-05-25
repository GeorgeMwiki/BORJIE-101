import { describe, it, expect } from 'vitest';
import {
  generateSandboxEstate,
  isSandboxTenantId,
  SANDBOX_TENANT_PREFIX,
  createSandboxStore,
  putSandbox,
  getSandbox,
  deleteSandbox,
  gcSandboxes,
  sandboxCount,
  SCENARIO_CATALOG,
  runScenario,
} from '../sandbox/index.js';
import {
  MARKETING_FEW_SHOTS,
  selectFewShots,
  renderFewShotsForPrompt,
} from '../marketing-few-shots.js';
import { buildMarketingSystemPrompt } from '../marketing-persona.js';

describe('sandbox estate generator', () => {
  it('yields deterministic output for same seed', () => {
    const a = generateSandboxEstate({ sessionId: 'mk_abc', country: 'TZ' });
    const b = generateSandboxEstate({ sessionId: 'mk_abc', country: 'TZ' });
    expect(a.units.map((u) => u.id)).toEqual(b.units.map((u) => u.id));
    expect(a.arrears.length).toBe(b.arrears.length);
    expect(a.maintenance[0]?.id).toBe(b.maintenance[0]?.id);
  });

  it('produces 24 units with 22 occupied', () => {
    const e = generateSandboxEstate({ sessionId: 'mk_count', country: 'KE' });
    expect(e.units.length).toBe(24);
    expect(e.units.filter((u) => u.occupied).length).toBe(22);
    expect(e.units.filter((u) => !u.occupied).length).toBe(2);
  });

  it('produces 3 arrears cases, 5 maintenance tickets, 1 renewal, 1 compliance notice', () => {
    const e = generateSandboxEstate({ sessionId: 'mk_shape', country: 'UG' });
    expect(e.arrears.length).toBe(3);
    expect(e.maintenance.length).toBe(5);
    expect(e.renewals.length).toBe(1);
    expect(e.compliance.length).toBe(1);
  });

  it('isolates data across sessions', () => {
    const a = generateSandboxEstate({ sessionId: 'mk_A', country: 'TZ' });
    const b = generateSandboxEstate({ sessionId: 'mk_B', country: 'TZ' });
    expect(a.tenantId).not.toBe(b.tenantId);
    expect(a.units[0]!.id).not.toBe(b.units[0]!.id);
  });

  it('tags tenantId with sandbox prefix', () => {
    const e = generateSandboxEstate({ sessionId: 'mk_x', country: 'KE' });
    expect(e.tenantId.startsWith(SANDBOX_TENANT_PREFIX)).toBe(true);
    expect(isSandboxTenantId(e.tenantId)).toBe(true);
    expect(isSandboxTenantId('prod_tenant_1')).toBe(false);
  });

  it('respects country-specific currency', () => {
    expect(generateSandboxEstate({ sessionId: 'mk_ke', country: 'KE' }).currency).toBe('KES');
    expect(generateSandboxEstate({ sessionId: 'mk_tz', country: 'TZ' }).currency).toBe('TZS');
    expect(generateSandboxEstate({ sessionId: 'mk_ug', country: 'UG' }).currency).toBe('UGX');
  });
});

describe('sandbox store GC', () => {
  it('returns null after TTL lapses', () => {
    const store = createSandboxStore({ idleTtlMs: 60_000 });
    const e = generateSandboxEstate({ sessionId: 'mk_exp', country: 'TZ' });
    const t0 = new Date('2026-01-01T00:00:00Z');
    putSandbox(store, e, t0);
    expect(getSandbox(store, 'mk_exp', t0)).not.toBeNull();
    const later = new Date(t0.getTime() + 61_000);
    expect(getSandbox(store, 'mk_exp', later)).toBeNull();
  });

  it('touch on read extends the TTL', () => {
    const store = createSandboxStore({ idleTtlMs: 60_000 });
    const e = generateSandboxEstate({ sessionId: 'mk_touch', country: 'TZ' });
    const t0 = new Date('2026-01-01T00:00:00Z');
    putSandbox(store, e, t0);
    const mid = new Date(t0.getTime() + 30_000);
    expect(getSandbox(store, 'mk_touch', mid)).not.toBeNull();
    const later = new Date(mid.getTime() + 45_000);
    // After the 30s touch, another 45s is still inside TTL.
    expect(getSandbox(store, 'mk_touch', later)).not.toBeNull();
  });

  it('gcSandboxes removes expired entries', () => {
    const store = createSandboxStore({ idleTtlMs: 1_000 });
    const e = generateSandboxEstate({ sessionId: 'mk_gc', country: 'TZ' });
    const t0 = new Date('2026-01-01T00:00:00Z');
    putSandbox(store, e, t0);
    expect(sandboxCount(store)).toBe(1);
    const future = new Date(t0.getTime() + 5_000);
    expect(gcSandboxes(store, future)).toBe(1);
    expect(sandboxCount(store)).toBe(0);
  });

  it('deleteSandbox removes a specific entry', () => {
    const store = createSandboxStore();
    const e = generateSandboxEstate({ sessionId: 'mk_del', country: 'KE' });
    putSandbox(store, e);
    expect(deleteSandbox(store, 'mk_del')).toBe(true);
    expect(getSandbox(store, 'mk_del')).toBeNull();
    expect(deleteSandbox(store, 'mk_missing')).toBe(false);
  });
});

describe('sandbox scenarios', () => {
  it('catalogs exactly 5 scenarios', () => {
    expect(SCENARIO_CATALOG.length).toBe(5);
  });

  it('runs arrears triage successfully', () => {
    const e = generateSandboxEstate({ sessionId: 'mk_s1', country: 'TZ' });
    const run = runScenario('arrears_triage_u7', e);
    expect(run.steps.length).toBeGreaterThan(0);
    expect(run.summary.toLowerCase()).toMatch(/triaged|days late|arrears|recommended/);
  });

  it('runs owner report draft successfully', () => {
    const e = generateSandboxEstate({ sessionId: 'mk_s2', country: 'KE' });
    const run = runScenario('owner_report_draft', e);
    expect(run.steps.length).toBeGreaterThanOrEqual(5);
    expect(run.summary).toMatch(/drafted|Report/i);
  });

  it('runs leaking-roof triage', () => {
    const e = generateSandboxEstate({ sessionId: 'mk_s3', country: 'UG' });
    const run = runScenario('route_leaking_roof', e);
    expect(run.steps.length).toBeGreaterThanOrEqual(5);
  });

  it('runs renewal proposal', () => {
    const e = generateSandboxEstate({ sessionId: 'mk_s4', country: 'TZ' });
    const run = runScenario('renewal_proposal_u12', e);
    expect(run.steps.length).toBeGreaterThan(0);
  });

  it('runs mpesa reconciliation', () => {
    const e = generateSandboxEstate({ sessionId: 'mk_s5', country: 'KE' });
    const run = runScenario('mpesa_reconcile', e);
    expect(run.steps.length).toBeGreaterThanOrEqual(5);
  });
});

describe('marketing few-shots', () => {
  it('ships at least 20 exemplars', () => {
    expect(MARKETING_FEW_SHOTS.length).toBeGreaterThanOrEqual(20);
  });

  it('every exemplar has prospect + mwikila text', () => {
    for (const fs of MARKETING_FEW_SHOTS) {
      expect(fs.prospect.length).toBeGreaterThan(10);
      expect(fs.mwikila.length).toBeGreaterThan(100);
    }
  });

  it('selectFewShots is deterministic per seed', () => {
    const a = selectFewShots('seed-A', { count: 4 });
    const b = selectFewShots('seed-A', { count: 4 });
    expect(a.map((s) => s.id)).toEqual(b.map((s) => s.id));
  });

  it('renderFewShotsForPrompt builds an Example block', () => {
    const shots = selectFewShots('seed-render', { count: 2 });
    const txt = renderFewShotsForPrompt(shots);
    expect(txt).toContain('Example 1');
    expect(txt).toContain('Example 2');
    expect(txt).toContain('Prospect:');
    expect(txt).toContain('Mr. Mwikila:');
  });

  it('buildMarketingSystemPrompt injects few-shots', () => {
    const prompt = buildMarketingSystemPrompt({
      visitorRole: 'owner',
      sessionSeed: 'inject-test',
      fewShotCount: 3,
    });
    expect(prompt).toContain('Reference Exemplars');
    expect(prompt).toContain('Example 1');
  });
});
