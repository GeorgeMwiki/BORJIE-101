import { describe, it, expect } from 'vitest';
import {
  tenantCreditTool,
  runTenantCredit,
} from '../../skills/estate/tenant-credit.js';
import { ESTATE_SKILL_TOOLS } from '../../skills/estate/index.js';

describe('skill.estate.get_tenant_credit', () => {
  it('is registered in ESTATE_SKILL_TOOLS', () => {
    expect(
      ESTATE_SKILL_TOOLS.find((t) => t.name === 'skill.estate.get_tenant_credit'),
    ).toBeDefined();
  });

  it('runTenantCredit returns a credit_rating_card block', () => {
    const result = runTenantCredit({
      tenantId: 't-1',
      customerId: 'c-1',
      totalInvoices: 12,
      paidOnTimeCount: 11,
      paidLate30DaysCount: 1,
      paidLate60DaysCount: 0,
      paidLate90PlusCount: 0,
      defaultCount: 0,
      extensionsGranted: 1,
      extensionsHonored: 1,
      installmentAgreementsOffered: 0,
      installmentAgreementsHonored: 0,
      rentToIncomeRatio: 0.3,
      avgTenancyMonths: 12,
      activeTenancyCount: 1,
      disputeCount: 0,
      damageDeductionCount: 0,
      subleaseViolationCount: 0,
      newestInvoiceAt: new Date().toISOString(),
      oldestInvoiceAt: new Date(Date.now() - 365 * 86400_000).toISOString(),
      asOf: new Date().toISOString(),
    });
    expect(result.card.blockType).toBe('credit_rating_card');
    expect(result.card.dimensionBars.length).toBe(5);
    expect(result.rating.numericScore).not.toBeNull();
  });

  it('tool.execute returns ok=true on valid params', async () => {
    const res = await tenantCreditTool.execute(
      {
        tenantId: 't-1',
        customerId: 'c-1',
        totalInvoices: 10,
        paidOnTimeCount: 10,
      },
      {} as never,
    );
    expect(res.ok).toBe(true);
  });

  it('tool.execute returns ok=false on missing required params', async () => {
    const res = await tenantCreditTool.execute(
      { tenantId: 't-1' } as never,
      {} as never,
    );
    expect(res.ok).toBe(false);
  });

  it('tool.execute insufficient-data path emits a clear summary', async () => {
    const res = await tenantCreditTool.execute(
      {
        tenantId: 't-1',
        customerId: 'c-1',
        totalInvoices: 1,
        paidOnTimeCount: 1,
      },
      {} as never,
    );
    expect(res.ok).toBe(true);
    expect(res.evidenceSummary).toMatch(/insufficient/i);
  });
});
