/**
 * Top-5 Complex Chat Flows — CE-2 multi-turn orchestration.
 *
 * These are the multi-step intents the audit
 * (`Docs/AUDIT/CHAT_ACTION_COVERAGE_2026-05-29.md`) flagged as
 * "not chain-orchestrated yet". Each function produces a `PlanDag`
 * the brain can render as a `<plan_preview>` inline block and the
 * runner can execute step-by-step.
 *
 * The 5 flows:
 *
 *   1. draftSignAndSendLoi    — owner: draft an LOI, lock, share, send
 *   2. dispatchRfbToManagerChain — owner: write RFB + dispatch + journal
 *   3. settleAndPayoutCoop    — manager: close settlement period + payout
 *   4. incidentToReportToBuyer — worker: incident → report → notify buyer
 *   5. licenceRenewalChain    — owner: start renewal → upload → submit
 *
 * Each flow is a pure function: takes a typed intent, returns a
 * fully-formed PlanDag. The risk-tier policy is applied so each
 * step's `humanCheckpoint` is filled in.
 *
 * Tool ids referenced here MUST exist in the brain-tool catalog
 * (`services/api-gateway/src/composition/brain-tools/`) — the
 * runner will fail at dispatch time if any toolId is unknown. The
 * unit tests in `__tests__/top-flows.test.ts` walk the catalog and
 * assert every toolId in every flow resolves.
 */

import { applyRiskTierPolicy, type PlanDag } from './plan-dag';

// ────────────────────────────────────────────────────────────────────
// Flow 1 — draft, lock, share, send an LOI
// ────────────────────────────────────────────────────────────────────

export interface DraftSignAndSendLoiIntent {
  readonly counterpartyName: string;
  readonly mineral: string;
  readonly tonnes: number;
  readonly pricePerGramTzs: number;
  readonly recipientEmail: string;
  readonly evidenceIds?: ReadonlyArray<string>;
}

export function draftSignAndSendLoi(
  intent: DraftSignAndSendLoiIntent,
): PlanDag {
  const evidence = intent.evidenceIds ?? [];
  return applyRiskTierPolicy({
    planId: `loi_${normalise(intent.counterpartyName)}_${Date.now().toString(36)}`,
    intent: `Draft LOI for ${intent.counterpartyName}: ${intent.tonnes}t ${intent.mineral} @ TZS ${intent.pricePerGramTzs}/g; sign + send to ${intent.recipientEmail}`,
    steps: [
      {
        id: 'compose',
        toolId: 'owner.drafter.compose-free-form',
        input: {
          docType: 'letter_of_intent',
          counterpartyName: intent.counterpartyName,
          fields: {
            mineral: intent.mineral,
            tonnes: intent.tonnes,
            pricePerGramTzs: intent.pricePerGramTzs,
          },
        },
        riskTier: 'low',
        evidenceIds: [...evidence],
        labelEn: 'Compose LOI draft',
        labelSw: 'Tunga rasimu ya LOI',
      },
      {
        id: 'lock',
        toolId: 'owner.drafter.lock',
        input: { revisionLabel: 'v1-locked' },
        riskTier: 'medium',
        evidenceIds: [...evidence],
        labelEn: 'Lock draft for signing',
        labelSw: 'Funga rasimu kwa saini',
      },
      {
        id: 'share',
        toolId: 'mining.ui.share_view',
        input: {
          entityType: 'draft',
          entityId: 'pending', // resolved post-compose
        },
        riskTier: 'medium',
        evidenceIds: [...evidence],
        labelEn: 'Generate signed share link',
        labelSw: 'Tengeneza kiungo cha kushirikisha',
      },
      {
        id: 'send',
        toolId: 'owner.messaging.send_to',
        input: {
          recipientEmail: intent.recipientEmail,
          subject: `LOI — ${intent.counterpartyName}`,
        },
        riskTier: 'high',
        evidenceIds: [...evidence],
        labelEn: 'Send LOI to counterparty',
        labelSw: 'Tuma LOI kwa mhusika',
      },
    ],
    edges: [
      { from: 'compose', to: 'lock' },
      { from: 'lock', to: 'share' },
      { from: 'share', to: 'send' },
    ],
  });
}

// ────────────────────────────────────────────────────────────────────
// Flow 2 — owner dispatch RFB to manager (decision-journal append)
// ────────────────────────────────────────────────────────────────────

export interface DispatchRfbChainIntent {
  readonly rfbId: string;
  readonly managerUserId: string;
  readonly rationale: string;
}

export function dispatchRfbToManagerChain(
  intent: DispatchRfbChainIntent,
): PlanDag {
  return applyRiskTierPolicy({
    planId: `rfb_dispatch_${intent.rfbId}_${Date.now().toString(36)}`,
    intent: `Dispatch RFB ${intent.rfbId} to manager ${intent.managerUserId}`,
    steps: [
      {
        id: 'dispatch',
        toolId: 'owner.rfb.dispatch_to_manager',
        input: {
          rfbId: intent.rfbId,
          managerUserId: intent.managerUserId,
        },
        riskTier: 'medium',
        evidenceIds: [intent.rfbId],
        labelEn: 'Dispatch RFB to manager',
        labelSw: 'Peleka RFB kwa meneja',
      },
      {
        id: 'journal',
        toolId: 'decisions.explain',
        input: {
          rationale: intent.rationale,
          subjectEntityKind: 'rfb',
          subjectEntityId: intent.rfbId,
        },
        riskTier: 'low',
        evidenceIds: [intent.rfbId],
        labelEn: 'Record decision in journal',
        labelSw: 'Andika uamuzi kwenye jarida',
      },
    ],
    edges: [{ from: 'dispatch', to: 'journal' }],
  });
}

// ────────────────────────────────────────────────────────────────────
// Flow 3 — close cooperative settlement period + draft payout
// ────────────────────────────────────────────────────────────────────

export interface SettleCoopIntent {
  readonly cooperativeId: string;
  readonly periodId: string;
}

export function settleAndPayoutCoop(intent: SettleCoopIntent): PlanDag {
  return applyRiskTierPolicy({
    planId: `coop_settle_${intent.periodId}_${Date.now().toString(36)}`,
    intent: `Close settlement period ${intent.periodId} for coop ${intent.cooperativeId}`,
    steps: [
      {
        id: 'list_period',
        toolId: 'cooperative.settlement_period_list',
        input: { cooperativeId: intent.cooperativeId },
        riskTier: 'low',
        evidenceIds: [intent.periodId],
        labelEn: 'Pull settlement period summary',
        labelSw: 'Vuta muhtasari wa kipindi',
      },
      {
        id: 'draft_payouts',
        toolId: 'cooperative.draft_settlement',
        input: {
          cooperativeId: intent.cooperativeId,
          periodId: intent.periodId,
        },
        riskTier: 'high',
        evidenceIds: [intent.periodId],
        labelEn: 'Draft member payouts (preview)',
        labelSw: 'Andaa malipo ya wanachama (mapitio)',
      },
    ],
    edges: [{ from: 'list_period', to: 'draft_payouts' }],
  });
}

// ────────────────────────────────────────────────────────────────────
// Flow 4 — worker reports incident → escalates → buyer notified
// ────────────────────────────────────────────────────────────────────

export interface IncidentToBuyerIntent {
  readonly siteId: string;
  readonly severity: 'low' | 'medium' | 'high';
  readonly summary: string;
  readonly affectedShipmentId: string | null;
}

export function incidentToReportToBuyer(
  intent: IncidentToBuyerIntent,
): PlanDag {
  const baseSteps = [
    {
      id: 'report',
      toolId: 'mining.incidents.report' as const,
      input: {
        siteId: intent.siteId,
        severity: intent.severity,
        summary: intent.summary,
      },
      riskTier: 'medium' as const,
      evidenceIds: [intent.siteId],
      labelEn: 'Log incident report',
      labelSw: 'Andika ripoti ya tukio',
    },
    {
      id: 'escalate',
      toolId: 'mining.escalations.raise' as const,
      input: {
        kind: 'safety_incident',
        siteId: intent.siteId,
        severity: intent.severity,
      },
      riskTier: intent.severity === 'high' ? ('high' as const) : ('medium' as const),
      evidenceIds: [intent.siteId],
      labelEn: 'Escalate to manager',
      labelSw: 'Panda kwa meneja',
    },
  ];
  const buyerStep = intent.affectedShipmentId
    ? [
        {
          id: 'notify_buyer',
          toolId: 'owner.messaging.send_to' as const,
          input: {
            recipientRole: 'buyer',
            subject: 'Shipment update — site incident',
            shipmentId: intent.affectedShipmentId,
          },
          riskTier: 'high' as const,
          evidenceIds: [intent.affectedShipmentId],
          labelEn: 'Notify affected buyer',
          labelSw: 'Mjulishe mnunuzi aliyeathirika',
        },
      ]
    : [];
  const steps = [...baseSteps, ...buyerStep];
  const edges = [
    { from: 'report', to: 'escalate' },
    ...(buyerStep.length > 0 ? [{ from: 'escalate', to: 'notify_buyer' }] : []),
  ];
  return applyRiskTierPolicy({
    planId: `incident_${intent.siteId}_${Date.now().toString(36)}`,
    intent: `Incident on site ${intent.siteId}: ${intent.summary}`,
    steps,
    edges,
  });
}

// ────────────────────────────────────────────────────────────────────
// Flow 5 — licence renewal start → upload → submit
// ────────────────────────────────────────────────────────────────────

export interface LicenceRenewalIntent {
  readonly licenceId: string;
  readonly documentDraftId: string;
}

export function licenceRenewalChain(intent: LicenceRenewalIntent): PlanDag {
  return applyRiskTierPolicy({
    planId: `lic_renew_${intent.licenceId}_${Date.now().toString(36)}`,
    intent: `Renew licence ${intent.licenceId}`,
    steps: [
      {
        id: 'start',
        toolId: 'owner.licence.start_renewal',
        input: { licenceId: intent.licenceId },
        riskTier: 'medium',
        evidenceIds: [intent.licenceId],
        labelEn: 'Open renewal workspace',
        labelSw: 'Fungua nafasi ya kuhuisha',
      },
      {
        id: 'upload',
        toolId: 'documents.upload',
        input: {
          draftId: intent.documentDraftId,
          category: 'licence_renewal',
        },
        riskTier: 'low',
        evidenceIds: [intent.licenceId, intent.documentDraftId],
        labelEn: 'Attach renewal document',
        labelSw: 'Ambatisha hati ya kuhuisha',
      },
      {
        id: 'submit',
        toolId: 'owner.licence.submit_renewal',
        input: {
          licenceId: intent.licenceId,
          documentDraftId: intent.documentDraftId,
        },
        riskTier: 'high',
        evidenceIds: [intent.licenceId, intent.documentDraftId],
        labelEn: 'Submit renewal to regulator',
        labelSw: 'Wasilisha kwa msimamizi',
      },
    ],
    edges: [
      { from: 'start', to: 'upload' },
      { from: 'upload', to: 'submit' },
    ],
  });
}

// ────────────────────────────────────────────────────────────────────
// Registry — all flows by name
// ────────────────────────────────────────────────────────────────────

export const TOP_FLOWS = Object.freeze({
  draftSignAndSendLoi,
  dispatchRfbToManagerChain,
  settleAndPayoutCoop,
  incidentToReportToBuyer,
  licenceRenewalChain,
} as const);

export type TopFlowName = keyof typeof TOP_FLOWS;

function normalise(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}
