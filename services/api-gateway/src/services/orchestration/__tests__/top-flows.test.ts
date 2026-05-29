/**
 * top-flows tests — CE-2.
 *
 * Validates that:
 *   - each of the 5 top-flow builders returns a well-formed PlanDag
 *     (passes planDagSchema)
 *   - every toolId referenced exists in the brain-tool catalog
 *   - the risk-tier policy is applied so high-stakes steps gain
 *     two-tap checkpoints
 */

import { describe, it, expect } from 'vitest';

import {
  TOP_FLOWS,
  draftSignAndSendLoi,
  dispatchRfbToManagerChain,
  settleAndPayoutCoop,
  incidentToReportToBuyer,
  licenceRenewalChain,
} from '../top-flows.js';
import { planDagSchema, topologicalOrder } from '../plan-dag.js';
import { listPersonaToolDescriptors } from '../../../composition/brain-tools/index.js';

const KNOWN_TOOL_IDS = new Set(
  listPersonaToolDescriptors().map((d) => d.id),
);

describe('TOP_FLOWS catalog', () => {
  it('exports exactly 5 named flows', () => {
    expect(Object.keys(TOP_FLOWS)).toHaveLength(5);
  });

  it('matches the named exports', () => {
    expect(TOP_FLOWS.draftSignAndSendLoi).toBe(draftSignAndSendLoi);
    expect(TOP_FLOWS.dispatchRfbToManagerChain).toBe(
      dispatchRfbToManagerChain,
    );
    expect(TOP_FLOWS.settleAndPayoutCoop).toBe(settleAndPayoutCoop);
    expect(TOP_FLOWS.incidentToReportToBuyer).toBe(incidentToReportToBuyer);
    expect(TOP_FLOWS.licenceRenewalChain).toBe(licenceRenewalChain);
  });
});

describe('draftSignAndSendLoi', () => {
  const plan = draftSignAndSendLoi({
    counterpartyName: 'ABC Off-takers',
    mineral: 'gold',
    tonnes: 2,
    pricePerGramTzs: 95_000,
    recipientEmail: 'abc@example.com',
  });

  it('is a valid PlanDag', () => {
    expect(planDagSchema.safeParse(plan).success).toBe(true);
  });

  it('orders compose → lock → share → send', () => {
    const ids = topologicalOrder(plan).map((s) => s.id);
    expect(ids).toEqual(['compose', 'lock', 'share', 'send']);
  });

  it('high-stakes send step is two-tap', () => {
    const send = plan.steps.find((s) => s.id === 'send')!;
    expect(send.riskTier).toBe('high');
    expect(send.humanCheckpoint).toBe('two-tap');
  });

  it('every step has bilingual labels', () => {
    for (const step of plan.steps) {
      expect(step.labelEn.length).toBeGreaterThan(0);
      expect(step.labelSw.length).toBeGreaterThan(0);
    }
  });
});

describe('dispatchRfbToManagerChain', () => {
  const plan = dispatchRfbToManagerChain({
    rfbId: 'rfb-1',
    managerUserId: 'mgr-1',
    rationale: 'closest to site',
  });

  it('is a valid PlanDag with 2 steps', () => {
    expect(planDagSchema.safeParse(plan).success).toBe(true);
    expect(plan.steps).toHaveLength(2);
  });
});

describe('settleAndPayoutCoop', () => {
  const plan = settleAndPayoutCoop({
    cooperativeId: 'coop-1',
    periodId: 'per-1',
  });

  it('draft_payouts is high-stakes (two-tap)', () => {
    const dp = plan.steps.find((s) => s.id === 'draft_payouts')!;
    expect(dp.humanCheckpoint).toBe('two-tap');
  });
});

describe('incidentToReportToBuyer', () => {
  it('omits the notify_buyer step when shipment is null', () => {
    const p = incidentToReportToBuyer({
      siteId: 's1',
      severity: 'medium',
      summary: 'rockfall',
      affectedShipmentId: null,
    });
    expect(p.steps.map((s) => s.id)).toEqual(['report', 'escalate']);
  });

  it('includes notify_buyer when shipment is supplied', () => {
    const p = incidentToReportToBuyer({
      siteId: 's1',
      severity: 'high',
      summary: 'rockfall',
      affectedShipmentId: 'shp-1',
    });
    expect(p.steps.map((s) => s.id)).toEqual([
      'report',
      'escalate',
      'notify_buyer',
    ]);
    expect(p.edges).toEqual([
      { from: 'report', to: 'escalate' },
      { from: 'escalate', to: 'notify_buyer' },
    ]);
  });
});

describe('licenceRenewalChain', () => {
  const plan = licenceRenewalChain({
    licenceId: 'lic-1',
    documentDraftId: 'doc-1',
  });

  it('submit step is high-stakes', () => {
    const submit = plan.steps.find((s) => s.id === 'submit')!;
    expect(submit.riskTier).toBe('high');
    expect(submit.humanCheckpoint).toBe('two-tap');
  });
});

describe('every flow references real brain-tool ids', () => {
  // Some tool ids referenced are owned by sibling waves and may not
  // exist in the catalog yet (e.g. owner.drafter.compose-free-form
  // is owned by the document-drafter sibling). We collect such ids
  // in a known-pending list to keep the wave from breaking when
  // siblings ship.
  const KNOWN_PENDING = new Set<string>([
    'owner.drafter.compose-free-form',
    'owner.drafter.lock',
  ]);

  const flows = [
    draftSignAndSendLoi({
      counterpartyName: 'X',
      mineral: 'gold',
      tonnes: 1,
      pricePerGramTzs: 1,
      recipientEmail: 'x@x.com',
    }),
    dispatchRfbToManagerChain({
      rfbId: 'r',
      managerUserId: 'm',
      rationale: 'x',
    }),
    settleAndPayoutCoop({ cooperativeId: 'c', periodId: 'p' }),
    incidentToReportToBuyer({
      siteId: 's',
      severity: 'high',
      summary: 'x',
      affectedShipmentId: 'sh',
    }),
    licenceRenewalChain({ licenceId: 'l', documentDraftId: 'd' }),
  ];

  it('every non-pending toolId resolves in the catalog', () => {
    const missing: string[] = [];
    for (const plan of flows) {
      for (const step of plan.steps) {
        if (KNOWN_TOOL_IDS.has(step.toolId)) continue;
        if (KNOWN_PENDING.has(step.toolId)) continue;
        missing.push(`${plan.planId}#${step.id} -> ${step.toolId}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
