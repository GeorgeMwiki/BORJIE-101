/**
 * Admin skills — happy-path + one rejection path + tenant-isolation tests.
 *
 * These are deterministic, in-memory tests. They don't hit the gateway;
 * they assert the skill's contract (Zod validation, tenant isolation,
 * PROPOSED gate).
 */

import { describe, it, expect } from 'vitest';
import { createCaseTool } from '../create-case.js';
import {
  assignWorkOrderCommitTool,
  HIGH_COST_THRESHOLD_KES,
} from '../assign-work-order.js';
import { approveLeaseRenewalTool } from '../approve-lease-renewal.js';
import { sendRentReminderTool } from '../send-rent-reminder.js';
import { draftOwnerStatementAdminTool } from '../draft-owner-statement.js';
import { approveTenderBidTool } from '../approve-tender-bid.js';
import { resolveArrearsCaseTool } from '../resolve-arrears-case.js';
import { reissueLetterTool } from '../reissue-letter.js';
import { updatePropertyFieldsTool } from '../update-property-fields.js';
import { assignTrainingTool } from '../assign-training.js';
import { acknowledgeExceptionTool } from '../acknowledge-exception.js';
import { updateAutonomyPolicyTool } from '../update-autonomy-policy.js';
import { ADMIN_SKILL_TOOLS } from '../index.js';
import { HIGH_RISK_THRESHOLDS } from '../shared.js';

const ctx = (tenantId: string) =>
  ({
    tenant: { tenantId },
    actor: { userId: 'u1', email: 'u@example.com', roles: ['admin'] },
    persona: {} as never,
    threadId: 'th_test',
  }) as never;

const TENANT_A = 'tenant_a';
const TENANT_B = 'tenant_b';

describe('admin skills registry', () => {
  it('exports 12 tools', () => {
    expect(ADMIN_SKILL_TOOLS).toHaveLength(12);
  });

  it('every tool has a skill.admin.* name and a description', () => {
    for (const t of ADMIN_SKILL_TOOLS) {
      expect(t.name).toMatch(/^skill\.admin\./);
      expect(t.description.length).toBeGreaterThan(20);
    }
  });
});

describe('skill.admin.create_case', () => {
  it('opens a case and returns an SLA window', async () => {
    const r = await createCaseTool.execute(
      {
        propertyId: 'p1',
        reportedByUserId: 'u1',
        category: 'plumbing',
        title: 'Kitchen tap leaking',
        description: 'Tap under the sink leaking onto floor; tenant reports puddle.',
        severity: 'high',
      },
      ctx(TENANT_A)
    );
    expect(r.ok).toBe(true);
    const data = r.data as { caseId: string; suggestedSlaHours: number };
    expect(data.caseId).toMatch(/^case_/);
    expect(data.suggestedSlaHours).toBe(24);
  });

  it('rejects missing title (validation)', async () => {
    const r = await createCaseTool.execute(
      {
        propertyId: 'p1',
        reportedByUserId: 'u1',
        category: 'plumbing',
        title: 'ab',
        description: 'short desc that passes min',
      },
      ctx(TENANT_A)
    );
    expect(r.ok).toBe(false);
  });

  it('rejects cross-tenant target', async () => {
    const r = await createCaseTool.execute(
      {
        tenantId: TENANT_B,
        propertyId: 'p1',
        reportedByUserId: 'u1',
        category: 'plumbing',
        title: 'Kitchen tap leaking',
        description: 'Tap under the sink leaking onto floor.',
      },
      ctx(TENANT_A)
    );
    expect(r.ok).toBe(false);
    expect(r.error).toContain('cross_tenant_access_denied');
  });
});

describe('skill.admin.assign_work_order', () => {
  it('commits when cost below threshold', async () => {
    const r = await assignWorkOrderCommitTool.execute(
      { workOrderId: 'wo1', vendorId: 'v1', estimatedCostKes: HIGH_COST_THRESHOLD_KES - 1 },
      ctx(TENANT_A)
    );
    expect(r.ok).toBe(true);
    expect(r.evidenceSummary).toContain('assigned');
  });

  it('proposes when cost above threshold', async () => {
    const r = await assignWorkOrderCommitTool.execute(
      { workOrderId: 'wo1', vendorId: 'v1', estimatedCostKes: HIGH_COST_THRESHOLD_KES + 1 },
      ctx(TENANT_A)
    );
    expect(r.ok).toBe(true);
    expect(r.evidenceSummary).toMatch(/^PROPOSED/);
  });

  it('rejects missing work-order id', async () => {
    const r = await assignWorkOrderCommitTool.execute(
      { vendorId: 'v1' },
      ctx(TENANT_A)
    );
    expect(r.ok).toBe(false);
  });
});

describe('skill.admin.approve_lease_renewal', () => {
  it('commits within policy (<=10%)', async () => {
    const r = await approveLeaseRenewalTool.execute(
      {
        renewalId: 'r1',
        leaseId: 'l1',
        currentRentKes: 50_000,
        proposedRentKes: 54_000,
        newEndDateIso: '2027-01-01T00:00:00.000Z',
        termMonths: 12,
      },
      ctx(TENANT_A)
    );
    expect(r.ok).toBe(true);
    expect(r.evidenceSummary).toContain('approved');
  });

  it('proposes when rent delta > 10%', async () => {
    const r = await approveLeaseRenewalTool.execute(
      {
        renewalId: 'r1',
        leaseId: 'l1',
        currentRentKes: 50_000,
        proposedRentKes: 65_000,
        newEndDateIso: '2027-01-01T00:00:00.000Z',
        termMonths: 12,
      },
      ctx(TENANT_A)
    );
    expect(r.ok).toBe(true);
    expect(r.evidenceSummary).toMatch(/^PROPOSED/);
  });

  it('rejects cross-tenant target', async () => {
    const r = await approveLeaseRenewalTool.execute(
      {
        tenantId: TENANT_B,
        renewalId: 'r1',
        leaseId: 'l1',
        currentRentKes: 50_000,
        proposedRentKes: 51_000,
        newEndDateIso: '2027-01-01T00:00:00.000Z',
        termMonths: 12,
      },
      ctx(TENANT_A)
    );
    expect(r.ok).toBe(false);
  });
});

describe('skill.admin.send_rent_reminder', () => {
  it('commits a small batch', async () => {
    const r = await sendRentReminderTool.execute(
      {
        recipients: [
          {
            tenantUserId: 'tu1',
            unitId: 'unit1',
            amountDueKes: 30_000,
            dueDateIso: '2026-05-05T00:00:00.000Z',
          },
        ],
      },
      ctx(TENANT_A)
    );
    expect(r.ok).toBe(true);
    expect(r.evidenceSummary).toContain('Queued');
  });

  it('proposes when recipient count above broadcast threshold', async () => {
    const recipients = Array.from(
      { length: HIGH_RISK_THRESHOLDS.broadcastRecipients + 5 },
      (_, i) => ({
        tenantUserId: `tu${i}`,
        unitId: `unit${i}`,
        amountDueKes: 10_000,
        dueDateIso: '2026-05-05T00:00:00.000Z',
      })
    );
    const r = await sendRentReminderTool.execute({ recipients }, ctx(TENANT_A));
    expect(r.ok).toBe(true);
    expect(r.evidenceSummary).toMatch(/^PROPOSED/);
  });
});

describe('skill.admin.draft_owner_statement', () => {
  it('drafts statement with nets per property', async () => {
    const r = await draftOwnerStatementAdminTool.execute(
      {
        ownerId: 'o1',
        ownerName: 'Owner One',
        period: '2026-03',
        properties: [
          {
            propertyId: 'p1',
            propertyName: 'Plot A',
            grossCollectedKes: 200_000,
            arrearsKes: 0,
            expensesKes: 15_000,
            mpesaFeesKes: 1_500,
          },
        ],
      },
      ctx(TENANT_A)
    );
    expect(r.ok).toBe(true);
    const data = r.data as { total: { netDisbursementKes: number } };
    expect(data.total.netDisbursementKes).toBeGreaterThan(0);
  });

  it('rejects invalid period', async () => {
    const r = await draftOwnerStatementAdminTool.execute(
      {
        ownerId: 'o1',
        ownerName: 'Owner One',
        period: 'march-2026',
        properties: [],
      },
      ctx(TENANT_A)
    );
    expect(r.ok).toBe(false);
  });
});

describe('skill.admin.approve_tender_bid', () => {
  it('commits bids below high-value cap', async () => {
    const r = await approveTenderBidTool.execute(
      {
        tenderId: 'tend1',
        bidId: 'bid1',
        vendorId: 'v1',
        priceTotalKes: HIGH_RISK_THRESHOLDS.tenderBidKes - 1,
        scoredBidIds: ['bid1', 'bid2'],
      },
      ctx(TENANT_A)
    );
    expect(r.ok).toBe(true);
    expect(r.evidenceSummary).toContain('approved');
  });

  it('proposes bids at or above high-value cap', async () => {
    const r = await approveTenderBidTool.execute(
      {
        tenderId: 'tend1',
        bidId: 'bid1',
        vendorId: 'v1',
        priceTotalKes: HIGH_RISK_THRESHOLDS.tenderBidKes + 1,
        scoredBidIds: ['bid1'],
      },
      ctx(TENANT_A)
    );
    expect(r.ok).toBe(true);
    expect(r.evidenceSummary).toMatch(/^PROPOSED/);
  });

  it('rejects bid not in scored list', async () => {
    const r = await approveTenderBidTool.execute(
      {
        tenderId: 'tend1',
        bidId: 'bid99',
        vendorId: 'v1',
        priceTotalKes: 50_000,
        scoredBidIds: ['bid1', 'bid2'],
      },
      ctx(TENANT_A)
    );
    expect(r.ok).toBe(false);
    expect(r.error).toContain('bid_not_scored');
  });
});

describe('skill.admin.resolve_arrears_case', () => {
  it('commits small payment_plan adjustments', async () => {
    const r = await resolveArrearsCaseTool.execute(
      {
        arrearsCaseId: 'ar1',
        tenantUserId: 'tu1',
        adjustmentKes: 5_000,
        resolution: 'payment_plan',
      },
      ctx(TENANT_A)
    );
    expect(r.ok).toBe(true);
    expect(r.evidenceSummary).toContain('resolved');
  });

  it('proposes write_off regardless of amount', async () => {
    const r = await resolveArrearsCaseTool.execute(
      {
        arrearsCaseId: 'ar1',
        tenantUserId: 'tu1',
        adjustmentKes: 100,
        resolution: 'write_off',
      },
      ctx(TENANT_A)
    );
    expect(r.ok).toBe(true);
    expect(r.evidenceSummary).toMatch(/^PROPOSED/);
  });
});

describe('skill.admin.reissue_letter', () => {
  it('returns PROPOSED by default', async () => {
    const r = await reissueLetterTool.execute(
      { originalLetterId: 'let1', reason: 'bounced_delivery' },
      ctx(TENANT_A)
    );
    expect(r.ok).toBe(true);
    expect(r.evidenceSummary).toMatch(/^PROPOSED/);
  });

  it('commits when force=true', async () => {
    const r = await reissueLetterTool.execute(
      { originalLetterId: 'let1', reason: 'bounced_delivery', force: true },
      ctx(TENANT_A)
    );
    expect(r.ok).toBe(true);
    expect(r.evidenceSummary).toContain('reissued');
  });
});

describe('skill.admin.update_property_fields', () => {
  it('patches allowed fields', async () => {
    const r = await updatePropertyFieldsTool.execute(
      { propertyId: 'p1', patch: { nickname: 'Sunrise Plaza', notes: 'New management notes' } },
      ctx(TENANT_A)
    );
    expect(r.ok).toBe(true);
    expect(r.evidenceSummary).toContain('updated');
  });

  it('rejects empty patch', async () => {
    const r = await updatePropertyFieldsTool.execute(
      { propertyId: 'p1', patch: {} },
      ctx(TENANT_A)
    );
    expect(r.ok).toBe(false);
  });
});

describe('skill.admin.assign_training', () => {
  it('commits small assignment', async () => {
    const r = await assignTrainingTool.execute(
      { trainingPathId: 'tp1', employeeIds: ['e1', 'e2', 'e3'] },
      ctx(TENANT_A)
    );
    expect(r.ok).toBe(true);
    expect(r.evidenceSummary).toContain('assigned');
  });

  it('proposes mass assignment', async () => {
    const employeeIds = Array.from(
      { length: HIGH_RISK_THRESHOLDS.broadcastRecipients + 10 },
      (_, i) => `e${i}`
    );
    const r = await assignTrainingTool.execute(
      { trainingPathId: 'tp1', employeeIds },
      ctx(TENANT_A)
    );
    expect(r.ok).toBe(true);
    expect(r.evidenceSummary).toMatch(/^PROPOSED/);
  });
});

describe('skill.admin.acknowledge_exception', () => {
  it('commits acknowledgement', async () => {
    const r = await acknowledgeExceptionTool.execute(
      {
        exceptionId: 'ex1',
        resolution: 'accept_autonomy_decision',
        note: 'looks correct',
      },
      ctx(TENANT_A)
    );
    expect(r.ok).toBe(true);
    expect(r.evidenceSummary).toContain('acknowledged');
  });

  it('rejects invalid resolution', async () => {
    const r = await acknowledgeExceptionTool.execute(
      { exceptionId: 'ex1', resolution: 'ignore' as never },
      ctx(TENANT_A)
    );
    expect(r.ok).toBe(false);
  });
});

describe('skill.admin.update_autonomy_policy', () => {
  it('always returns PROPOSED (without force)', async () => {
    const r = await updateAutonomyPolicyTool.execute(
      {
        domain: 'finance',
        level: 'auto_within_policy',
        costCeilingKes: 50_000,
        reason: 'expand automation for low-risk reconciliations',
      },
      ctx(TENANT_A)
    );
    expect(r.ok).toBe(true);
    expect(r.evidenceSummary).toMatch(/^PROPOSED/);
  });

  it('commits when force=true', async () => {
    const r = await updateAutonomyPolicyTool.execute(
      {
        domain: 'finance',
        level: 'auto_within_policy',
        costCeilingKes: 50_000,
        reason: 'expand automation for low-risk reconciliations',
        force: true,
      },
      ctx(TENANT_A)
    );
    expect(r.ok).toBe(true);
    expect(r.evidenceSummary).toMatch(/Autonomy finance/);
  });

  it('rejects invalid domain', async () => {
    const r = await updateAutonomyPolicyTool.execute(
      { domain: 'unknown' as never, level: 'manual', reason: 'r' },
      ctx(TENANT_A)
    );
    expect(r.ok).toBe(false);
  });
});
