import { describe, it, expect } from 'vitest';
import { createProcurementAgent } from '../../src/juniors/procurement-agent.js';
import type { ClaudeClient } from '../../src/juniors/_shared.js';

const VALID = {
  reorder_timeline: [{
    item_id: 'i1', days_remaining: 10, alert_level: 'green',
    recommended_order_qty: 0, recommended_supplier_id: null, reason: 'sufficient stock',
  }],
  supplier_compliance: [],
  sole_source_notifications: [],
  confidence: 0.75,
  rationale: 'inventory healthy',
  evidence_ids: ['i1_consumption'],
  citations: [],
};

function claudeOf(payload: unknown): ClaudeClient {
  return { async complete() { return { content: JSON.stringify(payload) }; } };
}

const INPUT = {
  tenantId: 't1', siteId: 's1',
  items: [{
    item_id: 'i1', name: 'diesel', category: 'fuel', unit: 'L',
    current_qty: 1000, consumption_rate_per_day: 50,
  }],
};

describe('procurement-agent', () => {
  it('happy path returns reorder_timeline with evidence_ids', async () => {
    const agent = createProcurementAgent({ claude: claudeOf(VALID) });
    const out = await agent.processInput(INPUT);
    expect(out.reorder_timeline[0].alert_level).toBe('green');
    expect(out.evidence_ids.length).toBeGreaterThan(0);
  });

  it('rejects when evidence_ids is empty (Auditor base)', async () => {
    const agent = createProcurementAgent({ claude: claudeOf({ ...VALID, evidence_ids: [] }) });
    await expect(agent.processInput(INPUT)).rejects.toThrow(/validation_failed/);
  });

  it('propagates Claude errors', async () => {
    const claude: ClaudeClient = { async complete() { throw new Error('eoq_fail'); } };
    const agent = createProcurementAgent({ claude });
    await expect(agent.processInput(INPUT)).rejects.toThrow(/eoq_fail/);
  });
});
