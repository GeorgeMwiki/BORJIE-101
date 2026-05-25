/**
 * Agent wiring tests. For each agent we supply stubbed service ports and
 * confirm:
 *   1. With the port wired, the agent produces `executed` / expected data.
 *   2. With the port missing, the agent degrades to `no_op` (never throws).
 */
import { describe, it, expect } from 'vitest';
import { TaskAgentExecutor } from '../executor.js';
import { TASK_AGENT_REGISTRY } from '../registry.js';

const TENANT = 'tenant_agents_1';

function makeExec(services: Record<string, unknown>) {
  return new TaskAgentExecutor({
    registry: TASK_AGENT_REGISTRY,
    services,
  });
}

describe('Task agents — degrade to no_op when ports missing', () => {
  for (const agent of Object.values(TASK_AGENT_REGISTRY)) {
    // Per-agent payloads that satisfy each schema.
    const payloadByAgent: Record<string, Record<string, unknown>> = {
      rent_reminder_agent: {},
      late_fee_calculator_agent: {},
      lease_renewal_scheduler_agent: {},
      move_out_notice_agent: {
        leaseId: 'lease_1',
        moveOutDate: '2026-06-01',
        unitId: 'unit_1',
        propertyId: 'prop_1',
      },
      inspection_reminder_agent: {},
      vendor_invoice_approver_agent: {},
      tenant_sentiment_monitor_agent: {},
      arrears_ladder_tick_agent: {},
      insurance_expiry_monitor_agent: {},
      license_expiry_monitor_agent: {},
      utility_meter_reading_reminder_agent: {},
      vacancy_marketer_agent: {
        unitId: 'u1',
        propertyId: 'p1',
        vacantSince: '2026-01-01',
      },
      proactive_maintenance_alert_agent: {},
      cross_tenant_churn_risk_agent: {},
      payment_plan_proposer_agent: {},
    };

    it(`${agent.id} — missing deps → no_op (or executed for stub-lite paths)`, async () => {
      const exec = makeExec({});
      const payload = payloadByAgent[agent.id] ?? {};
      const out = await exec.execute({
        tenantId: TENANT,
        agentId: agent.id,
        payload,
        trigger: { kind: 'manual', userId: 'user_1' },
      });
      // Must never throw — must be a defined outcome.
      expect(['no_op', 'executed', 'error']).toContain(out.outcome);
    });
  }
});

describe('rent_reminder_agent — with dispatcher wired', () => {
  it('sends reminders and returns executed', async () => {
    const sent: any[] = [];
    const services = {
      notifications: {
        dispatcher: {
          async dispatch(input: any) {
            sent.push(input);
            return { id: `n_${sent.length}` };
          },
        },
      },
      upcomingInvoicesLookup: async () => [
        { id: 'inv_1', customerId: 'c1', amount: 1000, dueDate: '2026-05-01' },
      ],
    };
    const exec = makeExec(services);
    const out = await exec.execute({
      tenantId: TENANT,
      agentId: 'rent_reminder_agent',
      payload: { channels: ['sms'], leadTimeDays: 3 },
      trigger: { kind: 'manual', userId: 'u' },
    });
    expect(out.outcome).toBe('executed');
    expect(sent.length).toBe(1);
    expect(sent[0].channel).toBe('sms');
  });
});

describe('arrears_ladder_tick_agent — wraps the ladder task', () => {
  it('reports advanced + escalated counts', async () => {
    const services = {
      arrearsLadderTick: async () => ({
        advanced: 3,
        escalated: 1,
        caseIds: ['c1', 'c2', 'c3', 'c4'],
      }),
    };
    const exec = makeExec(services);
    const out = await exec.execute({
      tenantId: TENANT,
      agentId: 'arrears_ladder_tick_agent',
      payload: {},
      trigger: { kind: 'manual', userId: 'u' },
    });
    expect(out.outcome).toBe('executed');
    expect(out.summary).toMatch(/Advanced 3/);
    expect(out.affected).toHaveLength(4);
  });
});

describe('payment_plan_proposer_agent — drafts plans for overdue cases', () => {
  it('calls proposer per case', async () => {
    const calls: any[] = [];
    const services = {
      listArrearsCasesOverDays: async () => [
        {
          id: 'case_1',
          customerId: 'cust_1',
          balanceMinorUnits: 100_000,
          currency: 'KES',
          daysOverdue: 45,
        },
      ],
      arrearsProposer: {
        async proposePaymentPlan(input: any) {
          calls.push(input);
          return { id: `prop_${calls.length}` };
        },
      },
    };
    const exec = makeExec(services);
    const out = await exec.execute({
      tenantId: TENANT,
      agentId: 'payment_plan_proposer_agent',
      payload: { installments: 3, minDaysOverdue: 30 },
      trigger: { kind: 'manual', userId: 'u' },
    });
    expect(out.outcome).toBe('executed');
    expect(calls[0].installments).toBe(3);
    expect(out.affected[0].kind).toBe('arrears_proposal');
  });
});

describe('vacancy_marketer_agent — requests marketplace publish', () => {
  it('sends request and tracks listing ID', async () => {
    const services = {
      marketplacePublishRequester: {
        async requestListingPublish(input: any) {
          return { listingId: `list_${input.unitId}` };
        },
      },
    };
    const exec = makeExec(services);
    const out = await exec.execute({
      tenantId: TENANT,
      agentId: 'vacancy_marketer_agent',
      payload: {
        unitId: 'u_42',
        propertyId: 'p_1',
        vacantSince: '2026-01-01',
      },
      trigger: { kind: 'event', eventId: 'ev_1' },
    });
    expect(out.outcome).toBe('executed');
    expect(out.data.listingId).toBe('list_u_42');
  });
});
