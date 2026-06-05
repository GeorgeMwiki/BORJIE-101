import { describe, it, expect } from 'vitest';
import { TASK_AGENT_REGISTRY, TASK_AGENTS } from '../registry.js';

describe('TASK_AGENT_REGISTRY', () => {
  it('exposes exactly the 15 agents required by Phase B Wave 30', () => {
    expect(TASK_AGENTS.length).toBe(15);
  });

  it('uses the agent.id as the registry key (no drift)', () => {
    for (const [key, agent] of Object.entries(TASK_AGENT_REGISTRY)) {
      expect(key).toBe(agent.id);
    }
  });

  it('is frozen — the registry cannot be mutated after import', () => {
    expect(Object.isFrozen(TASK_AGENT_REGISTRY)).toBe(true);
  });

  it('every agent has a trigger, guardrails, and zod schema', () => {
    for (const agent of TASK_AGENTS) {
      expect(agent.id).toBeTruthy();
      expect(agent.title).toBeTruthy();
      expect(agent.description).toBeTruthy();
      expect(agent.trigger).toBeDefined();
      expect(['cron', 'event', 'manual']).toContain(agent.trigger.kind);
      expect(agent.guardrails.autonomyDomain).toBeTruthy();
      expect(agent.guardrails.autonomyAction).toBeTruthy();
      expect(typeof agent.guardrails.invokesLLM).toBe('boolean');
      expect(agent.payloadSchema).toBeDefined();
      expect(typeof agent.execute).toBe('function');
    }
  });

  it('includes every required Wave-30 agent id', () => {
    const required = [
      'royalty_reminder_agent',
      'late_fee_calculator_agent',
      'offtake_renewal_scheduler_agent',
      'site_closure_notice_agent',
      'inspection_reminder_agent',
      'vendor_invoice_approver_agent',
      'buyer_sentiment_monitor_agent',
      'royalty_arrears_ladder_tick_agent',
      'insurance_expiry_monitor_agent',
      'license_expiry_monitor_agent',
      'production_meter_reading_reminder_agent',
      'available_capacity_marketer_agent',
      'proactive_maintenance_alert_agent',
      'cross_buyer_churn_risk_agent',
      'payment_plan_proposer_agent',
    ];
    for (const id of required) {
      expect(TASK_AGENT_REGISTRY[id]).toBeDefined();
    }
  });
});
