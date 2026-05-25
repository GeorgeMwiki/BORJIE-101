import { describe, it, expect, beforeEach } from 'vitest';
import {
  AutonomyPolicyService,
  InMemoryAutonomyPolicyRepository,
  buildDefaultPolicy,
} from '../../autonomy/index.js';

const TENANT = 'tenant_autonomy_1';

describe('AutonomyPolicyService', () => {
  let svc: AutonomyPolicyService;
  let repo: InMemoryAutonomyPolicyRepository;

  beforeEach(() => {
    repo = new InMemoryAutonomyPolicyRepository();
    svc = new AutonomyPolicyService({ repository: repo });
  });

  it('createPolicy seeds defaults when no policy exists', async () => {
    const policy = await svc.createPolicy(TENANT, 'head_1');
    expect(policy.tenantId).toBe(TENANT);
    expect(policy.autonomousModeEnabled).toBe(false);
    expect(policy.finance.reminderDayOffsets).toEqual([5, 10, 20]);
    expect(policy.leasing.maxAutoApproveRentIncreasePct).toBe(8);
    expect(policy.maintenance.autoApproveBelowMinorUnits).toBe(100_000);
    expect(policy.compliance.autoSendLegalNotices).toBe(false);
  });

  it('createPolicy is idempotent — returns existing row', async () => {
    const first = await svc.createPolicy(TENANT, 'head_1');
    const second = await svc.createPolicy(TENANT, 'head_2');
    expect(second.updatedBy).toBe(first.updatedBy);
  });

  it('updatePolicy merges per-domain blocks and bumps version', async () => {
    await svc.createPolicy(TENANT, 'head_1');
    const updated = await svc.updatePolicy(TENANT, {
      autonomousModeEnabled: true,
      maintenance: { autoApproveBelowMinorUnits: 250_000 },
      updatedBy: 'head_2',
    });
    expect(updated.autonomousModeEnabled).toBe(true);
    expect(updated.maintenance.autoApproveBelowMinorUnits).toBe(250_000);
    expect(updated.maintenance.autoDispatchTrustedVendors).toBe(true);
    expect(updated.version).toBe(2);
    expect(updated.updatedBy).toBe('head_2');
  });

  it('updatePolicy never allows autoSendLegalNotices to flip on', async () => {
    await svc.createPolicy(TENANT, 'head_1');
    const updated = await svc.updatePolicy(TENANT, {
      compliance: { autoSendLegalNotices: true as unknown as false },
    });
    expect(updated.compliance.autoSendLegalNotices).toBe(false);
  });

  it('isAuthorized blocks every action when master switch is off', async () => {
    await svc.createPolicy(TENANT, 'head_1');
    const decision = await svc.isAuthorized(TENANT, 'finance', 'send_reminder');
    expect(decision.authorized).toBe(false);
    expect(decision.requiresApproval).toBe(true);
    expect(decision.policyRuleMatched).toBe('master_switch_off');
  });

  it('isAuthorized authorises finance reminders when enabled', async () => {
    await svc.createPolicy(TENANT, 'head_1');
    await svc.updatePolicy(TENANT, { autonomousModeEnabled: true });
    const decision = await svc.isAuthorized(TENANT, 'finance', 'send_reminder');
    expect(decision.authorized).toBe(true);
    expect(decision.policyRuleMatched).toBe('finance.auto_send_reminders');
  });

  it('isAuthorized sends refund over-threshold to approval', async () => {
    await svc.createPolicy(TENANT, 'head_1');
    await svc.updatePolicy(TENANT, { autonomousModeEnabled: true });
    const decision = await svc.isAuthorized(TENANT, 'finance', 'approve_refund', {
      amountMinorUnits: 999_999_99,
    });
    expect(decision.authorized).toBe(false);
    expect(decision.requiresApproval).toBe(true);
  });

  it('isAuthorized approves renewal within rent-increase ceiling', async () => {
    await svc.createPolicy(TENANT, 'head_1');
    await svc.updatePolicy(TENANT, { autonomousModeEnabled: true });
    const under = await svc.isAuthorized(TENANT, 'leasing', 'approve_renewal', {
      rentIncreasePct: 6,
    });
    const over = await svc.isAuthorized(TENANT, 'leasing', 'approve_renewal', {
      rentIncreasePct: 12,
    });
    expect(under.authorized).toBe(true);
    expect(over.authorized).toBe(false);
  });

  it('isAuthorized escalates safety-critical maintenance tickets', async () => {
    await svc.createPolicy(TENANT, 'head_1');
    await svc.updatePolicy(TENANT, { autonomousModeEnabled: true });
    const decision = await svc.isAuthorized(
      TENANT,
      'maintenance',
      'approve_work_order',
      { amountMinorUnits: 50_000, isSafetyCritical: true },
    );
    expect(decision.authorized).toBe(false);
    expect(decision.policyRuleMatched).toBe('maintenance.safety_escalate');
  });

  it('isAuthorized HARD-blocks legal-notice auto-sending', async () => {
    await svc.createPolicy(TENANT, 'head_1');
    await svc.updatePolicy(TENANT, { autonomousModeEnabled: true });
    const decision = await svc.isAuthorized(
      TENANT,
      'compliance',
      'send_notice',
      { isLegalNotice: true },
    );
    expect(decision.authorized).toBe(false);
    expect(decision.requiresApproval).toBe(false);
    expect(decision.policyRuleMatched).toBe('compliance.legal_notice_blocked');
  });

  it('isAuthorized escalates negative-sentiment communications', async () => {
    await svc.createPolicy(TENANT, 'head_1');
    await svc.updatePolicy(TENANT, { autonomousModeEnabled: true });
    const decision = await svc.isAuthorized(
      TENANT,
      'communications',
      'send_routine_update',
      { sentimentScore: -0.8 },
    );
    expect(decision.authorized).toBe(false);
    expect(decision.policyRuleMatched).toBe('communications.negative_sentiment');
  });

  it('buildDefaultPolicy is tenant-isolated (different tenants get fresh objects)', () => {
    const a = buildDefaultPolicy('t_a');
    const b = buildDefaultPolicy('t_b');
    expect(a.tenantId).toBe('t_a');
    expect(b.tenantId).toBe('t_b');
    expect(a).not.toBe(b);
  });
});
