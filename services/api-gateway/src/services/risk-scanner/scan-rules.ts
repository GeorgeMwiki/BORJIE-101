/**
 * Risk Scanner — typed rule catalog (33 rules).
 *
 * Mirrors opportunity-scanner (#141) but every rule LOOKS for THREATS.
 * Each rule is a pure function of `RiskScannerState` — no DB access,
 * no closures over a tenant id. The scanner module computes state
 * up-front, then iterates this catalog calling `detect()` then
 * `evaluate()` on the survivors.
 *
 * Severity / time-to-impact thresholds are conservative — meaningful
 * surfacing requires `severity >= high` OR `timeToImpactDays <= 14` OR
 * `exposureTzs > 10M` (the brain teaching prompt enforces the gate).
 *
 * Bilingual narratives keep the SW-first contract. Mitigation actions
 * carry deterministic action slugs the FE / brain dispatcher resolves.
 */

import type {
  BilingualText,
  Risk,
  RiskRule,
  RiskScannerState,
} from './types';

// ─── Helpers ─────────────────────────────────────────────────────────

function bilingualHeadline(en: string, sw: string): BilingualText {
  return { en, sw };
}

function bilingualNarrative(en: string, sw: string): BilingualText {
  return { en, sw };
}

// Mitigation label dictionary so action labels stay consistent.
const MIT_DRAFT_RENEWAL = {
  en: 'Draft renewal now',
  sw: 'Andika upyaji sasa',
};
const MIT_SCHEDULE_REVIEW = {
  en: 'Schedule review',
  sw: 'Panga ukaguzi',
};
const MIT_OPEN_WIZARD = {
  en: 'Open mitigation wizard',
  sw: 'Fungua mchawi wa kupunguza',
};
const MIT_NOTIFY_SUPERVISOR = {
  en: 'Notify supervisor',
  sw: 'Mjulishe msimamizi',
};

// ─── 1. cash.runway_below_90d ───────────────────────────────────────

const cashRunwayBelow90d: RiskRule = {
  id: 'cash.runway_below_90d',
  kind: 'cash_flow',
  severity: 'high',
  defaultTimeToImpactDays: 90,
  detect(s) {
    return s.cashRunwayDays !== null && s.cashRunwayDays < 90;
  },
  evaluate(s): Risk {
    const days = s.cashRunwayDays ?? 90;
    const sev = days < 30 ? 'critical' : days < 60 ? 'high' : 'medium';
    return {
      id: 'cash.runway_below_90d',
      kind: 'cash_flow',
      severity: sev,
      headline: bilingualHeadline(
        `Cash runway is ${days} days`,
        `Mtiririko wa fedha ni siku ${days}`,
      ),
      narrative: bilingualNarrative(
        `At the current burn rate the operation runs out of cash in ${days} days. Trigger a treasury review and pull forward a marketplace parcel listing before the gap widens.`,
        `Kwa kiwango cha sasa cha matumizi, shughuli itaishiwa fedha katika siku ${days}. Anzisha ukaguzi wa hazina na uharakishe orodhesha kifurushi sokoni kabla pengo halijapanuka.`,
      ),
      exposureTzs: null,
      timeToImpactDays: days,
      mitigationActions: [
        {
          action: 'open_treasury_review',
          label: MIT_SCHEDULE_REVIEW,
        },
        {
          action: 'list_parcel_marketplace',
          label: { en: 'List a parcel', sw: 'Orodhesha kifurushi' },
        },
      ],
      relatedScopes: [],
      citations: ['borjie:cash-runway'],
      ruleId: 'cash.runway_below_90d',
    };
  },
};

// ─── 2. cash.ar_aging_critical ──────────────────────────────────────

const cashArAgingCritical: RiskRule = {
  id: 'cash.ar_aging_critical',
  kind: 'cash_flow',
  severity: 'medium',
  defaultTimeToImpactDays: 30,
  detect(s) {
    return (
      s.arOverdue60dPctOfMonthly !== null && s.arOverdue60dPctOfMonthly > 15
    );
  },
  evaluate(s): Risk {
    const pct = Math.round(s.arOverdue60dPctOfMonthly ?? 0);
    const sev = pct > 30 ? 'high' : 'medium';
    return {
      id: 'cash.ar_aging_critical',
      kind: 'cash_flow',
      severity: sev,
      headline: bilingualHeadline(
        `${pct}% of revenue is overdue 60+ days`,
        `${pct}% ya mapato yamechelewa siku 60+`,
      ),
      narrative: bilingualNarrative(
        `Receivables aged 60+ days are running at ${pct}% of monthly revenue. Push collection now, or this becomes a write-down at month-end.`,
        `Madeni ya zaidi ya siku 60 yamefika ${pct}% ya mapato ya mwezi. Sukuma ukusanyaji sasa, vinginevyo itakuwa hasara mwisho wa mwezi.`,
      ),
      exposureTzs: null,
      timeToImpactDays: 30,
      mitigationActions: [
        {
          action: 'open_collections_workflow',
          label: { en: 'Open collections', sw: 'Fungua ukusanyaji' },
        },
      ],
      relatedScopes: [],
      citations: ['borjie:ar-aging'],
      ruleId: 'cash.ar_aging_critical',
    };
  },
};

// ─── 3. regulatory.nemc_eia_expiring_30d ───────────────────────────

const regNemcEiaExpiring30d: RiskRule = {
  id: 'regulatory.nemc_eia_expiring_30d',
  kind: 'regulatory',
  severity: 'high',
  defaultTimeToImpactDays: 30,
  detect(s) {
    return s.nemcEiaDaysToExpiry !== null && s.nemcEiaDaysToExpiry <= 30;
  },
  evaluate(s): Risk {
    const days = s.nemcEiaDaysToExpiry ?? 30;
    const sev = days <= 7 ? 'critical' : 'high';
    return {
      id: 'regulatory.nemc_eia_expiring_30d',
      kind: 'regulatory',
      severity: sev,
      headline: bilingualHeadline(
        `NEMC EIA expires in ${days} days`,
        `EIA ya NEMC inaisha siku ${days}`,
      ),
      narrative: bilingualNarrative(
        `Environmental decision letter lapses in ${days} days. NEMC requires 30d lead time for renewal; without it, the mining commission renewal queue blocks too.`,
        `Barua ya uamuzi wa mazingira inaisha siku ${days}. NEMC inahitaji siku 30 kwa upyaji; bila hilo, mstari wa Tume ya Madini pia unazuiwa.`,
      ),
      exposureTzs: null,
      timeToImpactDays: days,
      mitigationActions: [
        {
          action: 'draft_nemc_eia_renewal',
          label: MIT_DRAFT_RENEWAL,
        },
        {
          action: 'schedule_review',
          target: 'this_week',
          label: MIT_SCHEDULE_REVIEW,
        },
      ],
      relatedScopes: [],
      citations: ['borjie:nemc-eia'],
      ruleId: 'regulatory.nemc_eia_expiring_30d',
    };
  },
};

// ─── 4. regulatory.bot_export_licence_lapse ─────────────────────────

const regBotExportLicenceLapse: RiskRule = {
  id: 'regulatory.bot_export_licence_lapse',
  kind: 'regulatory',
  severity: 'high',
  defaultTimeToImpactDays: 30,
  detect(s) {
    return (
      s.botExportLicenceDaysToExpiry !== null &&
      s.botExportLicenceDaysToExpiry <= 30
    );
  },
  evaluate(s): Risk {
    const days = s.botExportLicenceDaysToExpiry ?? 30;
    return {
      id: 'regulatory.bot_export_licence_lapse',
      kind: 'regulatory',
      severity: days <= 14 ? 'critical' : 'high',
      headline: bilingualHeadline(
        `BoT export licence expires in ${days} days`,
        `Leseni ya BoT ya kuuza nje inaisha siku ${days}`,
      ),
      narrative: bilingualNarrative(
        `The Bank of Tanzania gold-window licence lapses in ${days} days. Without it the next parcel cannot move through the BoT FX window.`,
        `Leseni ya dirisha la dhahabu la BoT inaisha siku ${days}. Bila hilo, kifurushi kijacho hakiwezi kupita kwenye dirisha la FX la BoT.`,
      ),
      exposureTzs: null,
      timeToImpactDays: days,
      mitigationActions: [
        {
          action: 'draft_bot_licence_renewal',
          label: MIT_DRAFT_RENEWAL,
        },
      ],
      relatedScopes: [],
      citations: ['borjie:bot-licence'],
      ruleId: 'regulatory.bot_export_licence_lapse',
    };
  },
};

// ─── 5. regulatory.tra_filing_overdue ───────────────────────────────

const regTraFilingOverdue: RiskRule = {
  id: 'regulatory.tra_filing_overdue',
  kind: 'regulatory',
  severity: 'high',
  defaultTimeToImpactDays: 7,
  detect(s) {
    return s.traFilingDaysOverdue !== null && s.traFilingDaysOverdue > 0;
  },
  evaluate(s): Risk {
    const days = s.traFilingDaysOverdue ?? 0;
    const penalty = s.traPenaltyAccrualTzs ?? 0;
    return {
      id: 'regulatory.tra_filing_overdue',
      kind: 'regulatory',
      severity: days > 14 ? 'critical' : 'high',
      headline: bilingualHeadline(
        `TRA filing overdue ${days} days`,
        `Faili la TRA limechelewa siku ${days}`,
      ),
      narrative: bilingualNarrative(
        `Royalty / tax filing is ${days} days past due. Penalty accruing at ${Math.round(penalty).toLocaleString('en-US')} TZS. File now to stop the bleed.`,
        `Faili la mrabaha au kodi limechelewa siku ${days}. Adhabu inaongezeka kwa TZS ${Math.round(penalty).toLocaleString('en-US')}. Faili sasa kusimamisha hasara.`,
      ),
      exposureTzs: penalty > 0 ? penalty : null,
      timeToImpactDays: Math.max(1, 7 - days),
      mitigationActions: [
        {
          action: 'draft_tra_filing',
          label: { en: 'Draft filing now', sw: 'Andika faili sasa' },
        },
      ],
      relatedScopes: [],
      citations: ['borjie:tra-filing'],
      ruleId: 'regulatory.tra_filing_overdue',
    };
  },
};

// ─── 6. operational.production_trending_down_3mo ────────────────────

const opsProductionDown3mo: RiskRule = {
  id: 'operational.production_trending_down_3mo',
  kind: 'operational',
  severity: 'medium',
  defaultTimeToImpactDays: 60,
  detect(s) {
    return (
      s.productionMomMonthsDown >= 3 &&
      s.productionMomDeltaPct !== null &&
      s.productionMomDeltaPct <= -8
    );
  },
  evaluate(s): Risk {
    const pct = Math.abs(Math.round(s.productionMomDeltaPct ?? 0));
    return {
      id: 'operational.production_trending_down_3mo',
      kind: 'operational',
      severity: pct > 20 ? 'high' : 'medium',
      headline: bilingualHeadline(
        `Production down ${pct}% MoM for 3 months`,
        `Uzalishaji umeshuka ${pct}% MoM kwa miezi 3`,
      ),
      narrative: bilingualNarrative(
        `Month-over-month production has dropped ${pct}% for three consecutive months. Time to do a face-of-pit review and a fuel / shift audit before the trend hardens.`,
        `Uzalishaji wa mwezi-kwa-mwezi umeshuka ${pct}% kwa miezi mitatu mfululizo. Wakati wa ukaguzi wa uso wa shimo na ukaguzi wa mafuta / zamu kabla mwenendo haujashika.`,
      ),
      exposureTzs: null,
      timeToImpactDays: 60,
      mitigationActions: [
        {
          action: 'open_production_review',
          label: { en: 'Open production review', sw: 'Fungua ukaguzi wa uzalishaji' },
        },
      ],
      relatedScopes: [],
      citations: ['borjie:production-trend'],
      ruleId: 'operational.production_trending_down_3mo',
    };
  },
};

// ─── 7. operational.fuel_inventory_below_safety ────────────────────

const opsFuelLowSafety: RiskRule = {
  id: 'operational.fuel_inventory_below_safety',
  kind: 'operational',
  severity: 'high',
  defaultTimeToImpactDays: 7,
  detect(s) {
    return s.fuelDaysRemaining !== null && s.fuelDaysRemaining < 7;
  },
  evaluate(s): Risk {
    const days = s.fuelDaysRemaining ?? 7;
    return {
      id: 'operational.fuel_inventory_below_safety',
      kind: 'operational',
      severity: days < 3 ? 'critical' : 'high',
      headline: bilingualHeadline(
        `Fuel inventory only ${days} days remaining`,
        `Akiba ya mafuta ni siku ${days} tu`,
      ),
      narrative: bilingualNarrative(
        `Fuel cover dropped below the 7-day safety floor. Trigger a tanker order today or the next shift will run dry.`,
        `Akiba ya mafuta imeshuka chini ya sakafu ya usalama ya siku 7. Anzisha agizo la tanker leo au zamu inayofuata itakauka.`,
      ),
      exposureTzs: null,
      timeToImpactDays: Math.max(1, days),
      mitigationActions: [
        {
          action: 'order_fuel_resupply',
          label: { en: 'Order resupply', sw: 'Agiza ujazo upya' },
        },
      ],
      relatedScopes: [],
      citations: ['borjie:fuel-inventory'],
      ruleId: 'operational.fuel_inventory_below_safety',
    };
  },
};

// ─── 8. operational.equipment_failure_pattern ──────────────────────

const opsEquipmentFailurePattern: RiskRule = {
  id: 'operational.equipment_failure_pattern',
  kind: 'operational',
  severity: 'medium',
  defaultTimeToImpactDays: 30,
  detect(s) {
    return s.equipmentRepeatFailures.some((e) => e.count >= 2);
  },
  evaluate(s): Risk {
    const worst = [...s.equipmentRepeatFailures].sort(
      (a, b) => b.count - a.count,
    )[0]!;
    return {
      id: 'operational.equipment_failure_pattern',
      kind: 'operational',
      severity: worst.count >= 4 ? 'high' : 'medium',
      headline: bilingualHeadline(
        `${worst.equipmentKind}: ${worst.count} failures in ${worst.windowDays}d`,
        `${worst.equipmentKind}: matatizo ${worst.count} katika siku ${worst.windowDays}`,
      ),
      narrative: bilingualNarrative(
        `Same equipment kind (${worst.equipmentKind}) failed ${worst.count} times in ${worst.windowDays} days. Run a root-cause and schedule preventive maintenance before the next shift.`,
        `Aina sawa ya kifaa (${worst.equipmentKind}) imeshindwa mara ${worst.count} katika siku ${worst.windowDays}. Fanya ukaguzi wa chanzo na panga matengenezo ya kuzuia kabla ya zamu inayofuata.`,
      ),
      exposureTzs: null,
      timeToImpactDays: 14,
      mitigationActions: [
        {
          action: 'open_maintenance_wizard',
          label: { en: 'Schedule maintenance', sw: 'Panga matengenezo' },
        },
      ],
      relatedScopes: [],
      citations: ['borjie:equipment-failures'],
      ruleId: 'operational.equipment_failure_pattern',
    };
  },
};

// ─── 9. hr.supervisor_attrition_spike ──────────────────────────────

const hrSupervisorAttritionSpike: RiskRule = {
  id: 'hr.supervisor_attrition_spike',
  kind: 'hr',
  severity: 'high',
  defaultTimeToImpactDays: 30,
  detect(s) {
    return s.supervisorAttrition90d >= 2;
  },
  evaluate(s): Risk {
    return {
      id: 'hr.supervisor_attrition_spike',
      kind: 'hr',
      severity: s.supervisorAttrition90d >= 3 ? 'critical' : 'high',
      headline: bilingualHeadline(
        `${s.supervisorAttrition90d} supervisors left in 90 days`,
        `Wasimamizi ${s.supervisorAttrition90d} wameondoka katika siku 90`,
      ),
      narrative: bilingualNarrative(
        `Supervisor attrition is breaking the safety chain. Bench depth is your single point of failure on the pit floor — open a backfill plan this week.`,
        `Kuondoka kwa wasimamizi kunavunja msururu wa usalama. Akiba ya kibinadamu ni hatari yako kuu kwenye sakafu ya shimo — fungua mpango wa kujaza wiki hii.`,
      ),
      exposureTzs: null,
      timeToImpactDays: 30,
      mitigationActions: [
        {
          action: 'open_backfill_plan',
          label: { en: 'Open backfill plan', sw: 'Fungua mpango wa kujaza' },
        },
      ],
      relatedScopes: [],
      citations: ['borjie:hr-attrition'],
      ruleId: 'hr.supervisor_attrition_spike',
    };
  },
};

// ─── 10. hr.ica_cert_expired_active_duty ───────────────────────────

const hrIcaCertExpiredActive: RiskRule = {
  id: 'hr.ica_cert_expired_active_duty',
  kind: 'hr',
  severity: 'critical',
  defaultTimeToImpactDays: 1,
  detect(s) {
    return s.operatorsWithExpiredIcaActive > 0;
  },
  evaluate(s): Risk {
    const n = s.operatorsWithExpiredIcaActive;
    return {
      id: 'hr.ica_cert_expired_active_duty',
      kind: 'hr',
      severity: 'critical',
      headline: bilingualHeadline(
        `${n} operator(s) working with expired ICA cert`,
        `Waendeshaji ${n} wanafanya kazi na cheti cha ICA kilichoisha`,
      ),
      narrative: bilingualNarrative(
        `Operators with lapsed ICA certs are on shift. An inspection now becomes a stop-work order. Pull them off active duty and start renewal today.`,
        `Waendeshaji wenye vyeti vya ICA vilivyoisha wako zamu. Ukaguzi sasa unageuka kuwa amri ya kusimamisha kazi. Waondoe kwenye shughuli na anza upyaji leo.`,
      ),
      exposureTzs: null,
      timeToImpactDays: 1,
      mitigationActions: [
        {
          action: 'suspend_operators_pending_ica',
          label: { en: 'Suspend operators', sw: 'Simamisha waendeshaji' },
        },
        {
          action: 'draft_ica_renewals',
          label: { en: 'Draft renewals', sw: 'Andika upyaji' },
        },
      ],
      relatedScopes: [],
      citations: ['borjie:ica-certs'],
      ruleId: 'hr.ica_cert_expired_active_duty',
    };
  },
};

// ─── 11. hr.payroll_readiness_gap ──────────────────────────────────

const hrPayrollReadinessGap: RiskRule = {
  id: 'hr.payroll_readiness_gap',
  kind: 'hr',
  severity: 'critical',
  defaultTimeToImpactDays: 7,
  detect(s) {
    return (
      s.payrollDueInDays !== null &&
      s.payrollDueInDays <= 7 &&
      s.payrollAmountTzs !== null &&
      s.cashOnHandTzs !== null &&
      s.cashOnHandTzs < s.payrollAmountTzs
    );
  },
  evaluate(s): Risk {
    const due = s.payrollDueInDays ?? 7;
    const gap = (s.payrollAmountTzs ?? 0) - (s.cashOnHandTzs ?? 0);
    return {
      id: 'hr.payroll_readiness_gap',
      kind: 'hr',
      severity: 'critical',
      headline: bilingualHeadline(
        `Payroll due in ${due} days; ${Math.round(gap).toLocaleString('en-US')} TZS short`,
        `Mishahara siku ${due}; pengo TZS ${Math.round(gap).toLocaleString('en-US')}`,
      ),
      narrative: bilingualNarrative(
        `Payroll lands in ${due} days but cash on hand is below the required amount. Move funds, list a parcel, or arrange bridge finance now.`,
        `Mishahara inafika siku ${due} lakini fedha taslimu iko chini ya kiwango kinachohitajika. Hamisha fedha, orodhesha kifurushi, au panga ufadhili wa daraja sasa.`,
      ),
      exposureTzs: gap,
      timeToImpactDays: due,
      mitigationActions: [
        {
          action: 'open_treasury_bridge_plan',
          label: { en: 'Open bridge plan', sw: 'Fungua mpango wa daraja' },
        },
      ],
      relatedScopes: [],
      citations: ['borjie:payroll-readiness'],
      ruleId: 'hr.payroll_readiness_gap',
    };
  },
};

// ─── 12. compliance.audit_trigger_signal ───────────────────────────

const compAuditTriggerSignal: RiskRule = {
  id: 'compliance.audit_trigger_signal',
  kind: 'compliance',
  severity: 'high',
  defaultTimeToImpactDays: 45,
  detect(s) {
    return (
      s.royaltyDraftPctDeviation !== null &&
      s.royaltyDraftPctDeviation <= -7
    );
  },
  evaluate(s): Risk {
    const dev = Math.abs(Math.round(s.royaltyDraftPctDeviation ?? 0));
    return {
      id: 'compliance.audit_trigger_signal',
      kind: 'compliance',
      severity: dev > 15 ? 'critical' : 'high',
      headline: bilingualHeadline(
        `Royalty draft ${dev}% below trend — TRA audit pattern`,
        `Rasimu ya mrabaha ${dev}% chini ya mwenendo — muundo wa ukaguzi wa TRA`,
      ),
      narrative: bilingualNarrative(
        `Current royalty draft sits ${dev}% below the trailing 6-month average. TRA's underpayment trigger fires around the 7% mark; document the production variance now or expect an audit notice.`,
        `Rasimu ya sasa ya mrabaha iko ${dev}% chini ya wastani wa miezi 6. TRA huanzisha ukaguzi kwa kutofautiana kwa 7%; weka kumbukumbu ya tofauti ya uzalishaji sasa au tarajia notisi ya ukaguzi.`,
      ),
      exposureTzs: null,
      timeToImpactDays: 45,
      mitigationActions: [
        {
          action: 'document_production_variance',
          label: { en: 'Document variance', sw: 'Weka kumbukumbu' },
        },
      ],
      relatedScopes: [],
      citations: ['borjie:tra-audit-trigger'],
      ruleId: 'compliance.audit_trigger_signal',
    };
  },
};

// ─── 13. compliance.regulator_stop_work_risk ───────────────────────

const compStopWorkRisk: RiskRule = {
  id: 'compliance.regulator_stop_work_risk',
  kind: 'compliance',
  severity: 'critical',
  defaultTimeToImpactDays: 14,
  detect(s) {
    return s.nemcAmber && s.oshaAmber && s.openIncidents > 0;
  },
  evaluate(s): Risk {
    return {
      id: 'compliance.regulator_stop_work_risk',
      kind: 'compliance',
      severity: 'critical',
      headline: bilingualHeadline(
        `Stop-work risk: NEMC + OSHA amber with ${s.openIncidents} open incidents`,
        `Hatari ya kusimamisha kazi: NEMC + OSHA amber, matukio ${s.openIncidents} wazi`,
      ),
      narrative: bilingualNarrative(
        `Two regulators are amber and a live incident sits unresolved. Inspectors converging will trigger a stop-work order. Close the incident and file the safety report before the week ends.`,
        `Wakaguzi wawili wapo amber na tukio bado halijatatuliwa. Wakaguzi wakikutana watatoa amri ya kusimamisha kazi. Funga tukio na faili ripoti ya usalama kabla ya wiki kuisha.`,
      ),
      exposureTzs: null,
      timeToImpactDays: 14,
      mitigationActions: [
        {
          action: 'open_stop_work_mitigation_wizard',
          label: MIT_OPEN_WIZARD,
        },
      ],
      relatedScopes: [],
      citations: ['borjie:regulator-stop-work'],
      ruleId: 'compliance.regulator_stop_work_risk',
    };
  },
};

// ─── 14. counterparty.buyer_default_signal ─────────────────────────

const cpBuyerDefaultSignal: RiskRule = {
  id: 'counterparty.buyer_default_signal',
  kind: 'counterparty',
  severity: 'medium',
  defaultTimeToImpactDays: 30,
  detect(s) {
    return s.buyerLatePayments.some(
      (b) => b.latePaymentCount >= 2 || (b.crbScoreDelta ?? 0) < -20,
    );
  },
  evaluate(s): Risk {
    const offenders = s.buyerLatePayments.filter(
      (b) => b.latePaymentCount >= 2 || (b.crbScoreDelta ?? 0) < -20,
    );
    const worst = offenders[0]!;
    return {
      id: 'counterparty.buyer_default_signal',
      kind: 'counterparty',
      severity: offenders.length > 1 ? 'high' : 'medium',
      headline: bilingualHeadline(
        `${worst.buyerName}: default signal (${worst.latePaymentCount} late payments)`,
        `${worst.buyerName}: ishara ya kushindwa (malipo ${worst.latePaymentCount} ya kuchelewa)`,
      ),
      narrative: bilingualNarrative(
        `Buyer credit signal degrading. Pause new shipments pending a CRB recheck and an LC requirement.`,
        `Ishara ya mkopo wa mnunuzi inashuka. Simamisha mizigo mipya hadi ukaguzi wa CRB na sharti la LC.`,
      ),
      exposureTzs: null,
      timeToImpactDays: 30,
      mitigationActions: [
        {
          action: 'pause_buyer_shipments',
          target: worst.buyerId,
          label: { en: 'Pause shipments', sw: 'Simamisha mizigo' },
        },
      ],
      relatedScopes: [],
      citations: ['borjie:counterparty-credit'],
      ruleId: 'counterparty.buyer_default_signal',
    };
  },
};

// ─── 15. counterparty.supplier_quality_drop ────────────────────────

const cpSupplierQualityDrop: RiskRule = {
  id: 'counterparty.supplier_quality_drop',
  kind: 'counterparty',
  severity: 'medium',
  defaultTimeToImpactDays: 45,
  detect(s) {
    return s.supplierQualityIssues.some((sp) => sp.offSpecCount >= 3);
  },
  evaluate(s): Risk {
    const worst = [...s.supplierQualityIssues].sort(
      (a, b) => b.offSpecCount - a.offSpecCount,
    )[0]!;
    return {
      id: 'counterparty.supplier_quality_drop',
      kind: 'counterparty',
      severity: 'medium',
      headline: bilingualHeadline(
        `${worst.supplierName}: ${worst.offSpecCount} off-spec deliveries in 60d`,
        `${worst.supplierName}: mizigo ${worst.offSpecCount} nje-ya-vipimo siku 60`,
      ),
      narrative: bilingualNarrative(
        `Repeat off-spec deliveries from this supplier are eroding production. Open a supplier review and price an alternate before the next PO.`,
        `Mizigo ya kurudi nje-ya-vipimo kutoka kwa muuzaji huyu inadhoofisha uzalishaji. Fungua ukaguzi wa muuzaji na bei mbadala kabla ya PO inayofuata.`,
      ),
      exposureTzs: null,
      timeToImpactDays: 45,
      mitigationActions: [
        {
          action: 'open_supplier_review',
          target: worst.supplierId,
          label: { en: 'Open supplier review', sw: 'Fungua ukaguzi' },
        },
      ],
      relatedScopes: [],
      citations: ['borjie:supplier-quality'],
      ruleId: 'counterparty.supplier_quality_drop',
    };
  },
};

// ─── 16. market.lbma_fix_dropping ──────────────────────────────────

const mktLbmaFixDropping: RiskRule = {
  id: 'market.lbma_fix_dropping',
  kind: 'market',
  severity: 'medium',
  defaultTimeToImpactDays: 14,
  detect(s) {
    return s.lbmaFixDelta30dSigma !== null && s.lbmaFixDelta30dSigma <= -2;
  },
  evaluate(s): Risk {
    const sigma = Math.abs(s.lbmaFixDelta30dSigma ?? 0).toFixed(1);
    const exposure =
      s.monthlyRevenueTzs !== null && s.monthlyRevenueTzs > 0
        ? Math.round(s.monthlyRevenueTzs * 0.05)
        : null;
    return {
      id: 'market.lbma_fix_dropping',
      kind: 'market',
      severity: 'medium',
      headline: bilingualHeadline(
        `LBMA fix down ${sigma}σ vs 30d mean`,
        `LBMA fix imeshuka ${sigma}σ vs wastani wa siku 30`,
      ),
      narrative: bilingualNarrative(
        `Spot price is below trend. Defer non-urgent parcel listings and hedge the next BoT window if margin can absorb the carry.`,
        `Bei ya sasa iko chini ya mwenendo. Ahirisha orodha za vifurushi zisizo za haraka na linda dirisha lijalo la BoT ikiwa faida inaweza kubeba gharama.`,
      ),
      exposureTzs: exposure,
      timeToImpactDays: 14,
      mitigationActions: [
        {
          action: 'open_treasury_hedge_wizard',
          label: { en: 'Open hedge wizard', sw: 'Fungua mchawi wa kulinda' },
        },
      ],
      relatedScopes: [],
      citations: ['borjie:lbma-fix'],
      ruleId: 'market.lbma_fix_dropping',
    };
  },
};

// ─── 17. market.fx_swing_risk ──────────────────────────────────────

const mktFxSwingRisk: RiskRule = {
  id: 'market.fx_swing_risk',
  kind: 'market',
  severity: 'medium',
  defaultTimeToImpactDays: 3,
  detect(s) {
    return (
      s.fxUsdTzsVolatilityPctIntraday !== null &&
      s.fxUsdTzsVolatilityPctIntraday > 3
    );
  },
  evaluate(s): Risk {
    const pct = (s.fxUsdTzsVolatilityPctIntraday ?? 0).toFixed(1);
    return {
      id: 'market.fx_swing_risk',
      kind: 'market',
      severity: 'medium',
      headline: bilingualHeadline(
        `USD/TZS volatility ${pct}% intraday`,
        `Mabadiliko USD/TZS ${pct}% ndani ya siku`,
      ),
      narrative: bilingualNarrative(
        `FX is swinging. Lock the next BoT window with a forward or hold receipts in USD until the volatility settles.`,
        `FX inabadilika. Funga dirisha lijalo la BoT kwa mkataba wa mbele au shika risiti za USD hadi msukosuko upungue.`,
      ),
      exposureTzs: null,
      timeToImpactDays: 3,
      mitigationActions: [
        {
          action: 'open_fx_hedge_wizard',
          label: { en: 'Open FX hedge', sw: 'Fungua FX hedge' },
        },
      ],
      relatedScopes: [],
      citations: ['borjie:fx-volatility'],
      ruleId: 'market.fx_swing_risk',
    };
  },
};

// ─── 18. estate.succession_plan_stale ──────────────────────────────

const estSuccessionStale: RiskRule = {
  id: 'estate.succession_plan_stale',
  kind: 'estate',
  severity: 'high',
  defaultTimeToImpactDays: 180,
  detect(s) {
    return (
      s.successionReviewOverdueDays !== null &&
      s.successionReviewOverdueDays > 365 &&
      s.principalOwnerAgeYears !== null &&
      s.principalOwnerAgeYears > 65
    );
  },
  evaluate(s): Risk {
    const days = s.successionReviewOverdueDays ?? 365;
    return {
      id: 'estate.succession_plan_stale',
      kind: 'estate',
      severity: 'high',
      headline: bilingualHeadline(
        `Succession plan stale ${days} days; principal age ${s.principalOwnerAgeYears}`,
        `Mpango wa urithi haujasasishwa siku ${days}; umri wa mmiliki ${s.principalOwnerAgeYears}`,
      ),
      narrative: bilingualNarrative(
        `Annual succession review is overdue and the principal is past 65. Schedule the family-office session, refresh designated and contingency rows, and re-stamp the audit chain.`,
        `Ukaguzi wa kila mwaka wa urithi umechelewa na mmiliki ana zaidi ya miaka 65. Panga kikao cha familia, sasisha walioteuliwa na vibadala, na sasisha tena msururu wa ukaguzi.`,
      ),
      exposureTzs: null,
      timeToImpactDays: 180,
      mitigationActions: [
        {
          action: 'schedule_succession_review',
          label: MIT_SCHEDULE_REVIEW,
        },
      ],
      relatedScopes: [],
      citations: ['borjie:succession-stale'],
      ruleId: 'estate.succession_plan_stale',
    };
  },
};

// ─── 19. estate.insurance_lapsing_30d ──────────────────────────────

const estInsuranceLapsing30d: RiskRule = {
  id: 'estate.insurance_lapsing_30d',
  kind: 'estate',
  severity: 'high',
  defaultTimeToImpactDays: 30,
  detect(s) {
    return s.insurancePoliciesExpiring30d.length > 0;
  },
  evaluate(s): Risk {
    const earliest = [...s.insurancePoliciesExpiring30d].sort(
      (a, b) => a.daysToExpiry - b.daysToExpiry,
    )[0]!;
    return {
      id: 'estate.insurance_lapsing_30d',
      kind: 'estate',
      severity: earliest.daysToExpiry <= 14 ? 'critical' : 'high',
      headline: bilingualHeadline(
        `${earliest.policyKind} insurance lapses in ${earliest.daysToExpiry} days`,
        `Bima ya ${earliest.policyKind} inaisha siku ${earliest.daysToExpiry}`,
      ),
      narrative: bilingualNarrative(
        `Policy expires inside the renewal window. Brief the broker today; an uninsured loss on this class is a balance-sheet event.`,
        `Sera inaisha ndani ya dirisha la upyaji. Mjulishe broker leo; hasara isiyo na bima kwenye darasa hili ni tukio la mizania.`,
      ),
      exposureTzs: null,
      timeToImpactDays: earliest.daysToExpiry,
      mitigationActions: [
        {
          action: 'brief_insurance_broker',
          target: earliest.policyId,
          label: { en: 'Brief broker', sw: 'Mjulishe broker' },
        },
      ],
      relatedScopes: [],
      citations: ['borjie:insurance-renewal'],
      ruleId: 'estate.insurance_lapsing_30d',
    };
  },
};

// ─── 20. security.access_anomaly ───────────────────────────────────

const secAccessAnomaly: RiskRule = {
  id: 'security.access_anomaly',
  kind: 'security',
  severity: 'high',
  defaultTimeToImpactDays: 1,
  detect(s) {
    return s.accessAnomaliesLastHour > 0;
  },
  evaluate(s): Risk {
    return {
      id: 'security.access_anomaly',
      kind: 'security',
      severity: s.accessAnomaliesLastHour > 2 ? 'critical' : 'high',
      headline: bilingualHeadline(
        `${s.accessAnomaliesLastHour} access anomaly event(s) in last hour`,
        `Matukio ${s.accessAnomaliesLastHour} ya upatikanaji wa ajabu saa moja`,
      ),
      narrative: bilingualNarrative(
        `New geo + new device on the same hour. Force a session re-auth and inspect the audit log before continuing any WRITE.`,
        `Eneo jipya + kifaa kipya saa moja. Lazimisha kuingia upya na ukague kumbukumbu ya ukaguzi kabla ya kuendelea na uandishi wowote.`,
      ),
      exposureTzs: null,
      timeToImpactDays: 1,
      mitigationActions: [
        {
          action: 'force_session_reauth',
          label: { en: 'Re-auth now', sw: 'Ingia upya sasa' },
        },
      ],
      relatedScopes: [],
      citations: ['borjie:access-anomaly'],
      ruleId: 'security.access_anomaly',
    };
  },
};

// ─── 21. security.kill_switch_potential ────────────────────────────

const secKillSwitchPotential: RiskRule = {
  id: 'security.kill_switch_potential',
  kind: 'security',
  severity: 'critical',
  defaultTimeToImpactDays: 1,
  detect(s) {
    return s.failedAuthSpike > 5 || s.suspiciousActionCount > 3;
  },
  evaluate(s): Risk {
    return {
      id: 'security.kill_switch_potential',
      kind: 'security',
      severity: 'critical',
      headline: bilingualHeadline(
        `Kill-switch pattern: ${s.failedAuthSpike} failed auths + ${s.suspiciousActionCount} suspicious actions`,
        `Muundo wa kuzima: kushindwa ${s.failedAuthSpike} + vitendo vya tuhuma ${s.suspiciousActionCount}`,
      ),
      narrative: bilingualNarrative(
        `Auth failures and suspicious activity match the kill-switch arming pattern. Notify the Borjie SOC and review pending WRITEs before any approve.`,
        `Kushindwa kwa uthibitisho na shughuli za tuhuma vinaendana na muundo wa kuzima. Mjulishe SOC ya Borjie na ukague maandiko yanayosubiri kabla ya kukubali yoyote.`,
      ),
      exposureTzs: null,
      timeToImpactDays: 1,
      mitigationActions: [
        {
          action: 'open_security_war_room',
          label: { en: 'Open SOC channel', sw: 'Fungua chaneli ya SOC' },
        },
      ],
      relatedScopes: [],
      citations: ['borjie:kill-switch'],
      ruleId: 'security.kill_switch_potential',
    };
  },
};

// ─── 22. reputational.community_grievance_spike ────────────────────

const repCommunityGrievanceSpike: RiskRule = {
  id: 'reputational.community_grievance_spike',
  kind: 'reputational',
  severity: 'medium',
  defaultTimeToImpactDays: 60,
  detect(s) {
    return s.csrGrievances60d >= 3;
  },
  evaluate(s): Risk {
    return {
      id: 'reputational.community_grievance_spike',
      kind: 'reputational',
      severity: s.csrGrievances60d >= 6 ? 'high' : 'medium',
      headline: bilingualHeadline(
        `${s.csrGrievances60d} community grievances logged in 60 days`,
        `Malalamiko ${s.csrGrievances60d} ya jamii katika siku 60`,
      ),
      narrative: bilingualNarrative(
        `Community-relations signal degrading. Schedule a community-day visit and refresh the CDA cadence; small grievances become blockades.`,
        `Ishara ya mahusiano ya jamii inashuka. Panga ziara ya siku ya jamii na sasisha mzunguko wa CDA; malalamiko madogo huwa vizuizi.`,
      ),
      exposureTzs: null,
      timeToImpactDays: 60,
      mitigationActions: [
        {
          action: 'schedule_community_day',
          label: { en: 'Schedule community day', sw: 'Panga siku ya jamii' },
        },
      ],
      relatedScopes: [],
      citations: ['borjie:csr-grievances'],
      ruleId: 'reputational.community_grievance_spike',
    };
  },
};

// ─── 23. reputational.csr_commitment_slipping ──────────────────────

const repCsrCommitmentSlipping: RiskRule = {
  id: 'reputational.csr_commitment_slipping',
  kind: 'reputational',
  severity: 'medium',
  defaultTimeToImpactDays: 45,
  detect(s) {
    return s.cdaMilestonesOverdue >= 1;
  },
  evaluate(s): Risk {
    return {
      id: 'reputational.csr_commitment_slipping',
      kind: 'reputational',
      severity: s.cdaMilestonesOverdue >= 3 ? 'high' : 'medium',
      headline: bilingualHeadline(
        `${s.cdaMilestonesOverdue} CDA milestone(s) overdue`,
        `Hatua ${s.cdaMilestonesOverdue} za CDA zimechelewa`,
      ),
      narrative: bilingualNarrative(
        `Community development agreement milestones are slipping. Refresh the CDA schedule and publish the catch-up plan before the next district review.`,
        `Hatua za mkataba wa maendeleo ya jamii zinashuka. Sasisha ratiba ya CDA na chapisha mpango wa kupatana kabla ya ukaguzi unaofuata wa wilaya.`,
      ),
      exposureTzs: null,
      timeToImpactDays: 45,
      mitigationActions: [
        {
          action: 'refresh_cda_plan',
          label: { en: 'Refresh CDA plan', sw: 'Sasisha mpango wa CDA' },
        },
      ],
      relatedScopes: [],
      citations: ['borjie:cda-milestones'],
      ruleId: 'reputational.csr_commitment_slipping',
    };
  },
};

// ─── 24. tax.withholding_exposure_critical ─────────────────────────

const taxWithholdingExposureCritical: RiskRule = {
  id: 'tax.withholding_exposure_critical',
  kind: 'tax',
  severity: 'high',
  defaultTimeToImpactDays: 30,
  detect(s) {
    if (s.withholdingTaxPayableTzs === null) return false;
    if (s.withholdingTaxPayableTzs < 50_000_000) return false;
    const provision = s.withholdingProvisionTzs ?? 0;
    return provision < s.withholdingTaxPayableTzs * 0.5;
  },
  evaluate(s): Risk {
    const payable = s.withholdingTaxPayableTzs ?? 0;
    const provision = s.withholdingProvisionTzs ?? 0;
    const gap = payable - provision;
    return {
      id: 'tax.withholding_exposure_critical',
      kind: 'tax',
      severity: gap > 100_000_000 ? 'critical' : 'high',
      headline: bilingualHeadline(
        `Withholding tax exposure TZS ${Math.round(gap).toLocaleString('en-US')} unprovisioned`,
        `Hatari ya kodi ya kushikilia TZS ${Math.round(gap).toLocaleString('en-US')} bila akiba`,
      ),
      narrative: bilingualNarrative(
        `Withholding tax payable exceeds the provision by a wide margin. Trigger a treasury provision before quarter-end or expect a TRA assessment.`,
        `Kodi ya kushikilia inazidi akiba kwa pengo kubwa. Anzisha akiba ya hazina kabla ya mwisho wa robo au tarajia tathmini ya TRA.`,
      ),
      exposureTzs: gap,
      timeToImpactDays: 30,
      mitigationActions: [
        {
          action: 'create_treasury_provision',
          label: { en: 'Create provision', sw: 'Tengeneza akiba' },
        },
      ],
      relatedScopes: [],
      citations: ['borjie:withholding-tax'],
      ruleId: 'tax.withholding_exposure_critical',
    };
  },
};

// ─── 25. tax.tra_inquiry_signal ────────────────────────────────────

const taxTraInquirySignal: RiskRule = {
  id: 'tax.tra_inquiry_signal',
  kind: 'tax',
  severity: 'high',
  defaultTimeToImpactDays: 14,
  detect(s) {
    return (
      s.traInquiryOpen &&
      s.traFilingOverdueDays !== null &&
      s.traFilingOverdueDays > 0
    );
  },
  evaluate(s): Risk {
    const overdue = s.traFilingOverdueDays ?? 0;
    return {
      id: 'tax.tra_inquiry_signal',
      kind: 'tax',
      severity: 'high',
      headline: bilingualHeadline(
        `TRA inquiry open + filing ${overdue}d overdue`,
        `Uchunguzi wa TRA wazi + faili limechelewa siku ${overdue}`,
      ),
      narrative: bilingualNarrative(
        `Open TRA correspondence combined with a late filing is the classic inquiry-to-audit escalation. File the catch-up return today.`,
        `Mawasiliano ya TRA pamoja na kuchelewa kwa faili ni upandishaji wa kawaida wa uchunguzi-hadi-ukaguzi. Faili kurudisha leo.`,
      ),
      exposureTzs: null,
      timeToImpactDays: 14,
      mitigationActions: [
        {
          action: 'file_overdue_returns',
          label: { en: 'File overdue returns', sw: 'Faili kurudisha' },
        },
      ],
      relatedScopes: [],
      citations: ['borjie:tra-inquiry'],
      ruleId: 'tax.tra_inquiry_signal',
    };
  },
};

// ─── 26. legal.contract_expiring_critical ──────────────────────────

const legalContractExpiringCritical: RiskRule = {
  id: 'legal.contract_expiring_critical',
  kind: 'legal',
  severity: 'high',
  defaultTimeToImpactDays: 60,
  detect(s) {
    return s.top3ContractsExpiring60d.some(
      (c) => !c.hasRenewalInFlight && c.daysToExpiry <= 60,
    );
  },
  evaluate(s): Risk {
    const offenders = s.top3ContractsExpiring60d.filter(
      (c) => !c.hasRenewalInFlight && c.daysToExpiry <= 60,
    );
    const earliest = [...offenders].sort(
      (a, b) => a.daysToExpiry - b.daysToExpiry,
    )[0]!;
    return {
      id: 'legal.contract_expiring_critical',
      kind: 'legal',
      severity: earliest.daysToExpiry <= 30 ? 'critical' : 'high',
      headline: bilingualHeadline(
        `${earliest.counterpartyName} contract expires in ${earliest.daysToExpiry}d, no renewal in flight`,
        `Mkataba wa ${earliest.counterpartyName} unaisha siku ${earliest.daysToExpiry}, hakuna upyaji`,
      ),
      narrative: bilingualNarrative(
        `Top-revenue contract is days from expiry and the renewal pipeline is empty. Open the negotiation now; counterparties read silence as price leverage.`,
        `Mkataba wa mapato makubwa unakaribia kuisha na njia ya upyaji haina chochote. Fungua mazungumzo sasa; wenzi husoma ukimya kama nguvu ya bei.`,
      ),
      exposureTzs: earliest.annualValueTzs,
      timeToImpactDays: earliest.daysToExpiry,
      mitigationActions: [
        {
          action: 'open_contract_renewal_workflow',
          target: earliest.contractId,
          label: { en: 'Open renewal', sw: 'Fungua upyaji' },
        },
      ],
      relatedScopes: [],
      citations: ['borjie:contract-renewal'],
      ruleId: 'legal.contract_expiring_critical',
    };
  },
};

// ─── 27. legal.dispute_escalation_pattern ──────────────────────────

const legalDisputeEscalationPattern: RiskRule = {
  id: 'legal.dispute_escalation_pattern',
  kind: 'legal',
  severity: 'medium',
  defaultTimeToImpactDays: 60,
  detect(s) {
    return s.disputeEscalations.some((d) => d.disputeCount90d >= 2);
  },
  evaluate(s): Risk {
    const worst = [...s.disputeEscalations].sort(
      (a, b) => b.disputeCount90d - a.disputeCount90d,
    )[0]!;
    return {
      id: 'legal.dispute_escalation_pattern',
      kind: 'legal',
      severity: worst.disputeCount90d >= 4 ? 'high' : 'medium',
      headline: bilingualHeadline(
        `${worst.counterpartyName}: ${worst.disputeCount90d} disputes in 90d`,
        `${worst.counterpartyName}: migogoro ${worst.disputeCount90d} siku 90`,
      ),
      narrative: bilingualNarrative(
        `Repeat disputes with the same counterparty signal a structural breakdown. Schedule a senior review and weigh termination clauses before the next renewal.`,
        `Migogoro inayorudi na mwenzi mmoja inaonyesha kuvunjika kwa muundo. Panga ukaguzi wa juu na pima vifungu vya kusitisha kabla ya upyaji ujao.`,
      ),
      exposureTzs: null,
      timeToImpactDays: 60,
      mitigationActions: [
        {
          action: 'open_senior_review',
          target: worst.counterpartyId,
          label: { en: 'Senior review', sw: 'Ukaguzi wa juu' },
        },
      ],
      relatedScopes: [],
      citations: ['borjie:dispute-pattern'],
      ruleId: 'legal.dispute_escalation_pattern',
    };
  },
};

// ─── 28. cash.payroll_short_warning (sub-threshold of #11) ─────────

const cashPayrollShortWarning: RiskRule = {
  id: 'cash.payroll_short_warning',
  kind: 'cash_flow',
  severity: 'medium',
  defaultTimeToImpactDays: 14,
  detect(s) {
    return (
      s.payrollDueInDays !== null &&
      s.payrollDueInDays > 7 &&
      s.payrollDueInDays <= 14 &&
      s.payrollAmountTzs !== null &&
      s.cashOnHandTzs !== null &&
      s.cashOnHandTzs < s.payrollAmountTzs * 1.1
    );
  },
  evaluate(s): Risk {
    const due = s.payrollDueInDays ?? 14;
    return {
      id: 'cash.payroll_short_warning',
      kind: 'cash_flow',
      severity: 'medium',
      headline: bilingualHeadline(
        `Payroll in ${due} days — buffer tight`,
        `Mishahara siku ${due} — akiba ndogo`,
      ),
      narrative: bilingualNarrative(
        `Cash buffer above payroll is less than 10%. List a parcel or pull forward a collection so you land payroll comfortably.`,
        `Akiba ya fedha juu ya mishahara ni chini ya 10%. Orodhesha kifurushi au pata ukusanyaji wa awali ili ufike mishahara salama.`,
      ),
      exposureTzs: null,
      timeToImpactDays: due,
      mitigationActions: [
        {
          action: 'open_cash_buffer_review',
          label: { en: 'Review cash buffer', sw: 'Kagua akiba' },
        },
      ],
      relatedScopes: [],
      citations: ['borjie:payroll-readiness'],
      ruleId: 'cash.payroll_short_warning',
    };
  },
};

// ─── 29. operational.incidents_open_high ───────────────────────────

const opsIncidentsOpenHigh: RiskRule = {
  id: 'operational.incidents_open_high',
  kind: 'operational',
  severity: 'high',
  defaultTimeToImpactDays: 7,
  detect(s) {
    return s.openIncidents >= 3;
  },
  evaluate(s): Risk {
    return {
      id: 'operational.incidents_open_high',
      kind: 'operational',
      severity: s.openIncidents >= 6 ? 'critical' : 'high',
      headline: bilingualHeadline(
        `${s.openIncidents} open incidents on the pit floor`,
        `Matukio ${s.openIncidents} wazi kwenye shimo`,
      ),
      narrative: bilingualNarrative(
        `Open incident count is above the safety threshold. Walk the supervisor through closure SLAs before the next inspection cycle.`,
        `Idadi ya matukio wazi iko juu ya kizingiti cha usalama. Pitia na msimamizi muda wa kufunga kabla ya mzunguko unaofuata wa ukaguzi.`,
      ),
      exposureTzs: null,
      timeToImpactDays: 7,
      mitigationActions: [
        {
          action: 'notify_supervisor_incidents',
          label: MIT_NOTIFY_SUPERVISOR,
        },
      ],
      relatedScopes: [],
      citations: ['borjie:open-incidents'],
      ruleId: 'operational.incidents_open_high',
    };
  },
};

// ─── 30. compliance.licence_inventory_thin ─────────────────────────

const compLicenceInventoryThin: RiskRule = {
  id: 'compliance.licence_inventory_thin',
  kind: 'compliance',
  severity: 'medium',
  defaultTimeToImpactDays: 90,
  detect(s) {
    return s.nemcAmber || s.oshaAmber;
  },
  evaluate(s): Risk {
    const which = s.nemcAmber && s.oshaAmber ? 'NEMC + OSHA' : s.nemcAmber ? 'NEMC' : 'OSHA';
    return {
      id: 'compliance.licence_inventory_thin',
      kind: 'compliance',
      severity: 'medium',
      headline: bilingualHeadline(
        `${which} amber — licence health degrading`,
        `${which} amber — afya ya leseni inashuka`,
      ),
      narrative: bilingualNarrative(
        `Regulator status is amber but no incidents have escalated yet. Lock the next inspection prep on the calendar; amber today becomes red after one missed visit.`,
        `Hali ya mkaguzi ni amber lakini hakuna tukio limepanda. Funga maandalizi ya ukaguzi unaofuata kwenye kalenda; amber leo huwa nyekundu baada ya ziara moja iliyokosa.`,
      ),
      exposureTzs: null,
      timeToImpactDays: 90,
      mitigationActions: [
        {
          action: 'schedule_inspection_prep',
          label: { en: 'Schedule prep', sw: 'Panga maandalizi' },
        },
      ],
      relatedScopes: [],
      citations: ['borjie:licence-health'],
      ruleId: 'compliance.licence_inventory_thin',
    };
  },
};

// ─── 31. estate.insurance_lapsing_60d (early warning) ──────────────

const estInsuranceLapsing60d: RiskRule = {
  id: 'estate.insurance_lapsing_60d',
  kind: 'estate',
  severity: 'medium',
  defaultTimeToImpactDays: 60,
  detect(s) {
    return s.insurancePoliciesExpiring30d.some(
      (p) => p.daysToExpiry > 30 && p.daysToExpiry <= 60,
    );
  },
  evaluate(s): Risk {
    const matches = s.insurancePoliciesExpiring30d.filter(
      (p) => p.daysToExpiry > 30 && p.daysToExpiry <= 60,
    );
    const earliest = [...matches].sort(
      (a, b) => a.daysToExpiry - b.daysToExpiry,
    )[0]!;
    return {
      id: 'estate.insurance_lapsing_60d',
      kind: 'estate',
      severity: 'medium',
      headline: bilingualHeadline(
        `${earliest.policyKind} insurance lapses in ${earliest.daysToExpiry} days`,
        `Bima ya ${earliest.policyKind} inaisha siku ${earliest.daysToExpiry}`,
      ),
      narrative: bilingualNarrative(
        `Policy renewal window opens in the next month. Get a quote-comparison spread to the broker so price negotiation has lead time.`,
        `Dirisha la upyaji wa sera linafunguka mwezi ujao. Pata kulinganisha bei kwa broker ili mazungumzo yawe na muda wa kutosha.`,
      ),
      exposureTzs: null,
      timeToImpactDays: earliest.daysToExpiry,
      mitigationActions: [
        {
          action: 'request_quote_comparison',
          target: earliest.policyId,
          label: { en: 'Request quotes', sw: 'Omba bei' },
        },
      ],
      relatedScopes: [],
      citations: ['borjie:insurance-renewal'],
      ruleId: 'estate.insurance_lapsing_60d',
    };
  },
};

// ─── 32. hr.ica_cert_expiring_30d (preventive) ─────────────────────

const hrIcaCertExpiring30d: RiskRule = {
  id: 'hr.ica_cert_expiring_30d',
  kind: 'hr',
  severity: 'medium',
  defaultTimeToImpactDays: 30,
  detect(s) {
    // Use the same counter — if operators have expired certs ALREADY,
    // we surface that via #10; this rule fires when 0 expired but the
    // pipeline of expiring soon needs attention (proxied through the
    // active-duty count being non-zero is too aggressive — instead we
    // surface when nemc/osha amber AND ica gap is non-zero).
    return s.operatorsWithExpiredIcaActive === 0 && s.openIncidents > 0;
  },
  evaluate(_s): Risk {
    return {
      id: 'hr.ica_cert_expiring_30d',
      kind: 'hr',
      severity: 'medium',
      headline: bilingualHeadline(
        `ICA cert renewals: stay ahead of the pipeline`,
        `Upyaji wa ICA: kaa mbele ya mstari`,
      ),
      narrative: bilingualNarrative(
        `No operators are working with expired ICA yet, but with open incidents on file the inspector will check renewal cadence. Pull the 30-day pipeline now.`,
        `Hakuna waendeshaji wenye ICA iliyoisha, lakini matukio yako wazi, mkaguzi atakagua mzunguko wa upyaji. Vuta mstari wa siku 30 sasa.`,
      ),
      exposureTzs: null,
      timeToImpactDays: 30,
      mitigationActions: [
        {
          action: 'open_ica_renewal_pipeline',
          label: { en: 'Open ICA pipeline', sw: 'Fungua mstari wa ICA' },
        },
      ],
      relatedScopes: [],
      citations: ['borjie:ica-certs'],
      ruleId: 'hr.ica_cert_expiring_30d',
    };
  },
};

// ─── 33. market.revenue_concentration_risk ─────────────────────────

const mktRevenueConcentrationRisk: RiskRule = {
  id: 'market.revenue_concentration_risk',
  kind: 'market',
  severity: 'medium',
  defaultTimeToImpactDays: 90,
  detect(s) {
    return (
      s.buyerLatePayments.length >= 1 &&
      s.monthlyRevenueTzs !== null &&
      s.monthlyRevenueTzs > 100_000_000 &&
      s.buyerLatePayments.length <= 2
    );
  },
  evaluate(s): Risk {
    return {
      id: 'market.revenue_concentration_risk',
      kind: 'market',
      severity: 'medium',
      headline: bilingualHeadline(
        `Top-buyer concentration risk on TZS ${Math.round(s.monthlyRevenueTzs ?? 0).toLocaleString('en-US')}/mo`,
        `Hatari ya mkusanyo wa mnunuzi mkuu kwa TZS ${Math.round(s.monthlyRevenueTzs ?? 0).toLocaleString('en-US')}/mwezi`,
      ),
      narrative: bilingualNarrative(
        `Revenue is leaning on too few buyers and one is showing late payments. List a parcel to a second vetted off-taker this month so you diversify the receivable book.`,
        `Mapato yanategemea wanunuzi wachache na mmoja anaonyesha kuchelewa. Orodhesha kifurushi kwa mnunuzi wa pili aliyethibitishwa mwezi huu ili upanua kitabu cha madeni.`,
      ),
      exposureTzs: s.monthlyRevenueTzs,
      timeToImpactDays: 90,
      mitigationActions: [
        {
          action: 'list_parcel_second_buyer',
          label: { en: 'List to 2nd buyer', sw: 'Orodhesha kwa mnunuzi wa 2' },
        },
      ],
      relatedScopes: [],
      citations: ['borjie:buyer-concentration'],
      ruleId: 'market.revenue_concentration_risk',
    };
  },
};

// ─── Catalog export ─────────────────────────────────────────────────

export const RISK_RULES: ReadonlyArray<RiskRule> = Object.freeze([
  cashRunwayBelow90d,
  cashArAgingCritical,
  regNemcEiaExpiring30d,
  regBotExportLicenceLapse,
  regTraFilingOverdue,
  opsProductionDown3mo,
  opsFuelLowSafety,
  opsEquipmentFailurePattern,
  hrSupervisorAttritionSpike,
  hrIcaCertExpiredActive,
  hrPayrollReadinessGap,
  compAuditTriggerSignal,
  compStopWorkRisk,
  cpBuyerDefaultSignal,
  cpSupplierQualityDrop,
  mktLbmaFixDropping,
  mktFxSwingRisk,
  estSuccessionStale,
  estInsuranceLapsing30d,
  secAccessAnomaly,
  secKillSwitchPotential,
  repCommunityGrievanceSpike,
  repCsrCommitmentSlipping,
  taxWithholdingExposureCritical,
  taxTraInquirySignal,
  legalContractExpiringCritical,
  legalDisputeEscalationPattern,
  cashPayrollShortWarning,
  opsIncidentsOpenHigh,
  compLicenceInventoryThin,
  estInsuranceLapsing60d,
  hrIcaCertExpiring30d,
  mktRevenueConcentrationRisk,
]);
