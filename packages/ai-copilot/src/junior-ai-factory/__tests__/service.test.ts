import { describe, it, expect, beforeEach } from 'vitest';
import {
  DailyActionCapExceededError,
  InMemoryJuniorAIRepository,
  JuniorAIFactoryService,
  JuniorAINotActiveError,
  PolicySubsetViolationError,
  validatePolicySubset,
} from '../index.js';
import type { JuniorAIAuditEvent, JuniorAISpec } from '../index.js';
import { buildDefaultPolicy } from '../../autonomy/defaults.js';
import type { AutonomyPolicy } from '../../autonomy/types.js';

const TENANT = 'tenant_junior_1';
const LEAD = 'user_lead_1';

function buildTenantPolicy(): AutonomyPolicy {
  return {
    ...buildDefaultPolicy(TENANT),
    autonomousModeEnabled: true,
    // Loosen a few cells so subsets have room to move.
    leasing: {
      autoApproveRenewalsSameTerms: true,
      maxAutoApproveRentIncreasePct: 10,
      autoApproveApplicationScoreMin: 0.75,
      autoSendOfferLetters: true,
    },
  };
}

function buildSpec(overrides: Partial<JuniorAISpec> = {}): JuniorAISpec {
  return {
    tenantId: TENANT,
    teamLeadUserId: LEAD,
    domain: 'leasing',
    mandate: 'Handle same-terms renewals for ward 3.',
    policySubset: {
      leasing: {
        autoApproveRenewalsSameTerms: true,
        maxAutoApproveRentIncreasePct: 5,
        autoApproveApplicationScoreMin: 0.8,
        autoSendOfferLetters: false,
      },
    },
    toolAllowlist: ['renewal.draft', 'renewal.send'],
    memoryScope: 'team',
    certificationRequired: false,
    lifecycle: { maxActionsPerDay: 20 },
    ...overrides,
  };
}

function makeService(opts: {
  auditEvents?: JuniorAIAuditEvent[];
  clockIso?: string;
} = {}) {
  const repo = new InMemoryJuniorAIRepository();
  const now = opts.clockIso ? new Date(opts.clockIso) : new Date('2026-04-21T12:00:00.000Z');
  const service = new JuniorAIFactoryService({
    repository: repo,
    autonomyPolicyLoader: async () => buildTenantPolicy(),
    clock: () => now,
    onAudit: opts.auditEvents ? (ev) => void opts.auditEvents!.push(ev) : undefined,
  });
  return { repo, service, now };
}

describe('JuniorAIFactoryService', () => {
  let auditEvents: JuniorAIAuditEvent[];

  beforeEach(() => {
    auditEvents = [];
  });

  it('provision() persists a junior with status=active and emits audit', async () => {
    const { service } = makeService({ auditEvents });
    const rec = await service.provision(buildSpec());
    expect(rec.status).toBe('active');
    expect(rec.id).toMatch(/^junior_/);
    expect(rec.mandate).toContain('ward 3');
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0].kind).toBe('provisioned');
  });

  it('provision() rejects a policy subset that exceeds tenant caps', async () => {
    const { service } = makeService({ auditEvents });
    const badSpec = buildSpec({
      policySubset: {
        leasing: {
          autoApproveRenewalsSameTerms: true,
          // Tenant cap is 10; junior requests 15 → violation.
          maxAutoApproveRentIncreasePct: 15,
          autoApproveApplicationScoreMin: 0.8,
          autoSendOfferLetters: false,
        },
      },
    });
    await expect(service.provision(badSpec)).rejects.toBeInstanceOf(PolicySubsetViolationError);
    expect(auditEvents).toHaveLength(0);
  });

  it('provision() rejects when toolAllowlist is empty', async () => {
    const { service } = makeService();
    await expect(service.provision(buildSpec({ toolAllowlist: [] }))).rejects.toThrow(
      /toolAllowlist/,
    );
  });

  it('list() filters by teamLeadUserId', async () => {
    const { service } = makeService();
    await service.provision(buildSpec());
    await service.provision(buildSpec({ teamLeadUserId: 'user_lead_2' }));
    const mine = await service.list(TENANT, LEAD);
    expect(mine).toHaveLength(1);
    expect(mine[0].teamLeadUserId).toBe(LEAD);
    const all = await service.list(TENANT);
    expect(all).toHaveLength(2);
  });

  it('revoke() is immediate and terminal (status=revoked)', async () => {
    const { service } = makeService({ auditEvents });
    const rec = await service.provision(buildSpec());
    const revoked = await service.revoke(TENANT, rec.id);
    expect(revoked.status).toBe('revoked');
    expect(revoked.revokedAt).not.toBeNull();
    // adjustScope on a revoked junior is rejected.
    await expect(
      service.adjustScope(TENANT, rec.id, { mandate: 'new mandate' }),
    ).rejects.toBeInstanceOf(JuniorAINotActiveError);
    expect(auditEvents.map((e) => e.kind)).toEqual(['provisioned', 'revoked']);
  });

  it('adjustScope() re-validates the new subset and emits audit', async () => {
    const { service } = makeService({ auditEvents });
    const rec = await service.provision(buildSpec());
    const patched = await service.adjustScope(TENANT, rec.id, {
      policySubset: {
        leasing: {
          autoApproveRenewalsSameTerms: true,
          maxAutoApproveRentIncreasePct: 8,
          autoApproveApplicationScoreMin: 0.8,
          autoSendOfferLetters: false,
        },
      },
    });
    expect(patched.policySubset.leasing?.maxAutoApproveRentIncreasePct).toBe(8);
    const kinds = auditEvents.map((e) => e.kind);
    expect(kinds).toContain('scope_adjusted');

    // And that an over-scope patch is rejected.
    await expect(
      service.adjustScope(TENANT, rec.id, {
        policySubset: {
          leasing: {
            autoApproveRenewalsSameTerms: true,
            maxAutoApproveRentIncreasePct: 50,
            autoApproveApplicationScoreMin: 0.8,
            autoSendOfferLetters: false,
          },
        },
      }),
    ).rejects.toBeInstanceOf(PolicySubsetViolationError);
  });

  it('suspend() then adjustScope() fails with JuniorAINotActiveError', async () => {
    const { service } = makeService();
    const rec = await service.provision(buildSpec());
    await service.suspend(TENANT, rec.id, 'excessive spend');
    await expect(
      service.adjustScope(TENANT, rec.id, { mandate: 'x' }),
    ).rejects.toBeInstanceOf(JuniorAINotActiveError);
  });

  it('recordAction() enforces maxActionsPerDay and resets on new UTC day', async () => {
    const { repo, service } = makeService({
      clockIso: '2026-04-21T10:00:00.000Z',
    });
    const rec = await service.provision(buildSpec({ lifecycle: { maxActionsPerDay: 2 } }));
    await service.recordAction(TENANT, rec.id);
    await service.recordAction(TENANT, rec.id);
    await expect(service.recordAction(TENANT, rec.id)).rejects.toBeInstanceOf(
      DailyActionCapExceededError,
    );
    // Simulate rollover by seeding a new date via the repository.
    await repo.update(TENANT, rec.id, { actionsTodayDate: '2026-04-20', actionsToday: 2 });
    const after = await service.recordAction(TENANT, rec.id);
    expect(after.actionsToday).toBe(1);
  });

  it('provision() rejects expiresAt in the past', async () => {
    const { service } = makeService({ clockIso: '2026-04-21T10:00:00.000Z' });
    await expect(
      service.provision(
        buildSpec({
          lifecycle: { expiresAt: '2020-01-01T00:00:00.000Z' },
        }),
      ),
    ).rejects.toThrow(/expiresAt/);
  });

  it('validatePolicySubset() catches the safety-critical auto-send legal notices attempt', () => {
    const tenant = buildTenantPolicy();
    const violations = validatePolicySubset(
      {
        compliance: {
          autoDraftNotices: true,
          autoSendLegalNotices: true as never,
          autoRenewLicencesBefore: 30,
          escalateOnNewRegulation: true,
        },
      },
      tenant,
    );
    expect(violations.length).toBeGreaterThan(0);
    expect(violations.some((v) => v.includes('autoSendLegalNotices'))).toBe(true);
  });
});
