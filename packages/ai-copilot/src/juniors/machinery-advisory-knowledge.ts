/**
 * Mining-asset knowledge pack — the deterministic engine behind the
 * Machinery & Equipment Advisory junior.
 *
 * Every function here is PURE: no I/O, no Date.now, no env reads, no
 * mutation. Each computation is grounded in
 * `Docs/research/mining-machinery-advisory.md` and returns the
 * `evidence_id` of the dossier section it relies on, so the Auditor's
 * empty-evidence-chain rejection always has a real provenance record to
 * cite even before the LLM port adds narrative.
 *
 * Coverage (one knowledge pack, five capability areas):
 *   - Reliability KPIs (ISO 14224): MTBF / MTTR / availability, P-F.
 *   - Failure-mode crib sheet + ISO 14224 failure taxonomy (diagnosis).
 *   - Maintenance-strategy selector (RTF / preventive / CBM / PdM).
 *   - Equipment selection & sizing (9:1 rule, t = 9.0·S^1.1, fill
 *     factor, loader/truck counts, drill-fleet rule, genset load band).
 *   - Lease-vs-buy utilisation breakeven + WGC AISC treatment.
 *   - TCO-weighted procurement scorer (never sticker price).
 *
 * Dossier evidence ids are stable strings of the form `mma:§N.M` so the
 * Wire phase and the Auditor can resolve them deterministically.
 */

// ─────────────────────────────────────────────────────────────────────
// Dossier evidence-id registry (single source of truth for citations)
// ─────────────────────────────────────────────────────────────────────

export const MMA_EVIDENCE = {
  operatingFrame: 'mma:§0:asset-manager-operating-frame',
  iso14224: 'mma:§0:iso-14224-failure-taxonomy',
  iso55000: 'mma:§0:iso-55000-2024',
  conditionMonitoring: 'mma:§1.1:four-cm-techniques',
  oilAnalysis: 'mma:§1.2:sos-fluid-analysis',
  telematicsPdm: 'mma:§1.3:telematics-ai-pdm',
  dataOverload: 'mma:§1.3:event-alarm-alert-isa-18.2',
  failureCrib: 'mma:§1.4:failure-mode-crib-sheet',
  rcmLogic: 'mma:§2.1:rcm-function-first',
  strategySelector: 'mma:§2.2:four-maintenance-strategies',
  pfInterval: 'mma:§2.3:p-f-interval',
  reliabilityKpis: 'mma:§2.4:mtbf-mttr-availability',
  criticalitySpares: 'mma:§2.5:criticality-and-spares',
  oemIntervals: 'mma:§2.6:oem-service-intervals',
  loaderTruckMatch: 'mma:§3.1:loader-truck-9to1-match',
  openPitSizing: 'mma:§3.2:open-pit-sizing-formulas',
  gensetSizing: 'mma:§3.3:genset-load-band',
  drillSelection: 'mma:§3.4:drill-selection',
  comminutionSelection: 'mma:§3.5:gravity-cil-selection',
  newUsedRebuilt: 'mma:§3.7:new-vs-used-vs-rebuilt',
  leaseSpecies: 'mma:§4.1:operating-vs-finance-lease',
  leaseDecision: 'mma:§4.2:lease-vs-buy-criteria',
  residualBuyout: 'mma:§4.3:residual-buyout-tco',
  aiscTreatment: 'mma:§4.4:wgc-lease-into-aisc',
  utilisationBreakeven: 'mma:§4.5:utilisation-breakeven',
  tcoNotSticker: 'mma:§5.1:tco-not-sticker-price',
  rfqDiscipline: 'mma:§5.2:rfq-tender-discipline',
  localContent: 'mma:§5.3:local-content-preference',
  aftermarketLeadtime: 'mma:§5.4:aftermarket-leadtime-spares',
  tzAsmContext: 'mma:§6:tanzania-asm-context',
} as const;

export type MmaEvidenceId = (typeof MMA_EVIDENCE)[keyof typeof MMA_EVIDENCE];

// ─────────────────────────────────────────────────────────────────────
// ISO 14224 failure taxonomy + per-asset-class failure-mode crib sheet
// (Dossier §1.4 + §0). Used by the diagnosis mode to seed the LLM with
// the candidate failure modes for the asset class under review.
// ─────────────────────────────────────────────────────────────────────

export type AssetClass =
  | 'haul_truck'
  | 'excavator'
  | 'loader'
  | 'dozer'
  | 'drill_rig'
  | 'crusher'
  | 'sag_mill'
  | 'ball_mill'
  | 'conveyor'
  | 'slurry_pump'
  | 'genset'
  | 'gold_room'
  | 'weighbridge';

export interface FailureMode {
  readonly mode: string;
  readonly typical_cause: string;
  readonly detect_via: ReadonlyArray<string>;
  readonly evidence_id: MmaEvidenceId;
}

const MOBILE_FLEET_MODES: ReadonlyArray<FailureMode> = [
  {
    mode: 'engine: injector degradation / combustion imbalance',
    typical_cause: 'fuel-injector wear; >1yr-stored diesel ~50% water/algae risk',
    detect_via: ['SOS oil/fuel analysis', 'telematics', 'pre-OEM-fault-code trend'],
    evidence_id: MMA_EVIDENCE.telematicsPdm,
  },
  {
    mode: 'cooling: radiator blockage',
    typical_cause: '>40% of engine failures trace to cooling; coolant degradation',
    detect_via: ['coolant analysis (glycol/SCA/pH)', 'coolant-temp vs ambient+load trend'],
    evidence_id: MMA_EVIDENCE.oilAnalysis,
  },
  {
    mode: 'drivetrain / final-drive / wheel-motor wear',
    typical_cause: 'bearing wear, lube contamination',
    detect_via: ['SOS', 'vibration analysis (mm/s)'],
    evidence_id: MMA_EVIDENCE.conditionMonitoring,
  },
  {
    mode: 'hydraulics: leaks / contamination',
    typical_cause: 'seal wear, ISO 4406 particle-count drift',
    detect_via: ['oil analysis (ISO 4406)', 'telematics pressure trend'],
    evidence_id: MMA_EVIDENCE.oilAnalysis,
  },
];

const CRIB_SHEET: Record<AssetClass, ReadonlyArray<FailureMode>> = {
  haul_truck: MOBILE_FLEET_MODES,
  excavator: MOBILE_FLEET_MODES,
  loader: MOBILE_FLEET_MODES,
  dozer: MOBILE_FLEET_MODES,
  drill_rig: [
    {
      mode: 'compressor / engine fuel-burn drift',
      typical_cause: 'air-volume mismatch to application; filter loading',
      detect_via: ['compressor-management telemetry', 'fuel-burn trend'],
      evidence_id: MMA_EVIDENCE.drillSelection,
    },
  ],
  crusher: [
    {
      mode: 'bearing / lube failure; misalignment; mechanical looseness',
      typical_cause: 'overheating lube oil, wrong viscosity, unstable base',
      detect_via: ['vibration analysis', 'lube-oil temperature + SOS'],
      evidence_id: MMA_EVIDENCE.failureCrib,
    },
    {
      mode: 'liner / mantle over-wear; choking',
      typical_cause: 'operating outside choke feed, wrong CSS, abrasive feed, loose mantle bolt',
      detect_via: ['CSS measurement', 'liner-profile inspection', 'mantle-bolt torque check'],
      evidence_id: MMA_EVIDENCE.failureCrib,
    },
  ],
  sag_mill: [
    {
      mode: 'trunnion-bearing oil-film collapse / emulsification',
      typical_cause: 'cooling-water loss; contamination causes ~18% of SAG-circuit shutdowns',
      detect_via: ['bearing-oil analysis (water/emulsion)', 'bearing-temp trend', 'lube-flow interlock'],
      evidence_id: MMA_EVIDENCE.failureCrib,
    },
    {
      mode: 'ring-gear/pinion misalignment; gear cracks',
      typical_cause: 'misalignment progresses to tooth breakage',
      detect_via: ['audible clatter', 'vibration analysis', 'gear-crack inspection'],
      evidence_id: MMA_EVIDENCE.failureCrib,
    },
    {
      mode: 'liner-bolt / backing-plate looseness',
      typical_cause: 'bolt torque not re-checked after first 24h of new-liner operation',
      detect_via: ['post-24h bolt-torque check', 'shell-weld inspection'],
      evidence_id: MMA_EVIDENCE.failureCrib,
    },
  ],
  ball_mill: [
    {
      mode: 'ball-charge segregation; slurry wash under liner',
      typical_cause: 'media migration; missing/damaged rubber backing',
      detect_via: ['charge-level survey', 'liner-backing inspection'],
      evidence_id: MMA_EVIDENCE.failureCrib,
    },
  ],
  conveyor: [
    {
      mode: 'belt mistracking; idler-bearing seizure; pulley-lagging wear; belt slip',
      typical_cause: 'misaligned/damaged idlers, material build-up, poor sealing',
      detect_via: ['idler-bearing temp/vibration', 'tracking inspection', 'lagging-wear inspection'],
      evidence_id: MMA_EVIDENCE.failureCrib,
    },
  ],
  slurry_pump: [
    {
      mode: 'throatbush wear (shortest-lived wet-end part)',
      typical_cause: 'hydraulic recirculation at impeller/throatbush gap',
      detect_via: ['impeller/throatbush gap measurement', 'efficiency-at-duty-point trend'],
      evidence_id: MMA_EVIDENCE.failureCrib,
    },
  ],
  genset: [
    {
      mode: 'wet-stacking',
      typical_cause: 'chronic <30-40% load; unburned fuel clogs exhaust',
      detect_via: ['load-factor trend', 'exhaust-deposit inspection'],
      evidence_id: MMA_EVIDENCE.failureCrib,
    },
    {
      mode: 'injector wear / high fuel burn / life loss',
      typical_cause: 'dirty filters, low-quality diesel, sustained >90% load',
      detect_via: ['fuel-burn g/kWh trend', 'filter dP', 'load-factor trend'],
      evidence_id: MMA_EVIDENCE.gensetSizing,
    },
  ],
  gold_room: [
    {
      mode: 'metallurgical-balance discrepancy (stripped != poured)',
      typical_cause: 'triage: weightometer/weighbridge calibration -> GIC -> sampling/assay -> theft last',
      detect_via: ['weekly stripped-vs-poured reconciliation', 'monthly metallurgical balance'],
      evidence_id: MMA_EVIDENCE.failureCrib,
    },
  ],
  weighbridge: [
    {
      mode: 'calibration drift',
      typical_cause: 'legal-metrology (OIML R76/R134) drift undermines royalty + met balance',
      detect_via: ['OIML calibration certificate check', 'reconciliation discrepancy trend'],
      evidence_id: MMA_EVIDENCE.failureCrib,
    },
  ],
};

export function failureModesFor(assetClass: AssetClass): ReadonlyArray<FailureMode> {
  return CRIB_SHEET[assetClass] ?? MOBILE_FLEET_MODES;
}

// ─────────────────────────────────────────────────────────────────────
// Reliability KPIs — ISO 14224 (Dossier §2.4)
// ─────────────────────────────────────────────────────────────────────

export interface ReliabilityKpis {
  readonly mtbf_hours: number;
  readonly mttr_hours: number;
  readonly availability: number; // 0..1
  readonly evidence_id: MmaEvidenceId;
}

/**
 * MTBF = operating time / failures; MTTR = repair downtime / failures;
 * Availability = MTBF / (MTBF + MTTR). Returns availability = 1 when
 * there were zero failures and zero repair downtime in the window.
 */
export function computeReliabilityKpis(args: {
  readonly operating_hours: number;
  readonly repair_downtime_hours: number;
  readonly failures: number;
}): ReliabilityKpis {
  const failures = Math.max(0, Math.floor(args.failures));
  const opHours = Math.max(0, args.operating_hours);
  const repairHours = Math.max(0, args.repair_downtime_hours);
  if (failures === 0) {
    return {
      mtbf_hours: opHours,
      mttr_hours: 0,
      availability: 1,
      evidence_id: MMA_EVIDENCE.reliabilityKpis,
    };
  }
  const mtbf = opHours / failures;
  const mttr = repairHours / failures;
  const denom = mtbf + mttr;
  return {
    mtbf_hours: round2(mtbf),
    mttr_hours: round2(mttr),
    availability: denom > 0 ? round4(mtbf / denom) : 1,
    evidence_id: MMA_EVIDENCE.reliabilityKpis,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Maintenance-strategy selector — RCM four-strategy table (Dossier §2.2)
// ─────────────────────────────────────────────────────────────────────

export type MaintenanceStrategy =
  | 'run_to_failure'
  | 'preventive'
  | 'condition_based'
  | 'predictive';

export interface StrategyVerdict {
  readonly strategy: MaintenanceStrategy;
  readonly reason: string;
  readonly evidence_ids: ReadonlyArray<MmaEvidenceId>;
}

/**
 * Function-first RCM selection. Criticality is the consequence axis;
 * measurability is whether degradation is detectable (the CBM/PdM gate).
 *   - low criticality + cheap/redundant -> deliberate run-to-failure
 *   - high criticality + measurable + high value/mobile -> predictive
 *   - measurable degradation -> condition-based
 *   - known wear-out, not measurable -> preventive (greater of hr/calendar)
 */
export function selectMaintenanceStrategy(args: {
  readonly criticality: 'A' | 'B' | 'C';
  readonly degradation_measurable: boolean;
  readonly high_value_or_mobile: boolean;
}): StrategyVerdict {
  if (args.criticality === 'C' && !args.high_value_or_mobile) {
    return {
      strategy: 'run_to_failure',
      reason: 'Low criticality, cheap/redundant: deliberate run-to-failure (consequence trivial).',
      evidence_ids: [MMA_EVIDENCE.strategySelector, MMA_EVIDENCE.rcmLogic],
    };
  }
  if (args.criticality === 'A' && args.degradation_measurable && args.high_value_or_mobile) {
    return {
      strategy: 'predictive',
      reason: 'Class-A, measurable degradation, high-value/mobile: model RUL on telematics + SOS + vibration.',
      evidence_ids: [MMA_EVIDENCE.strategySelector, MMA_EVIDENCE.pfInterval, MMA_EVIDENCE.telematicsPdm],
    };
  }
  if (args.degradation_measurable) {
    return {
      strategy: 'condition_based',
      reason: 'Measurable degradation on rotating plant: act inside the P-F interval (CBM threshold).',
      evidence_ids: [MMA_EVIDENCE.strategySelector, MMA_EVIDENCE.pfInterval],
    };
  }
  return {
    strategy: 'preventive',
    reason: 'Known wear-out, not condition-measurable: time/usage PM at the greater of hour-vs-calendar interval.',
    evidence_ids: [MMA_EVIDENCE.strategySelector, MMA_EVIDENCE.oemIntervals],
  };
}

// ─────────────────────────────────────────────────────────────────────
// Equipment selection & sizing (Dossier §3.1–§3.3)
// ─────────────────────────────────────────────────────────────────────

export interface LoaderTruckMatch {
  readonly recommended_truck_payload_t: number; // 9.0 * S^1.1
  readonly nine_to_one_payload_t: number; // 9 * bucket tons
  readonly passes_to_fill: number;
  readonly fill_factor_ok: boolean;
  readonly note: string;
  readonly evidence_ids: ReadonlyArray<MmaEvidenceId>;
}

/**
 * 9:1 pass-match. `loader_dipper_yd3` feeds the algebraic form
 * `t = 9.0 * S^1.1`; `bucket_payload_t` (if known) feeds the simpler 9x
 * tonnage rule and the pass count. Fill factor target band is 80–95%.
 */
export function matchLoaderToTruck(args: {
  readonly loader_dipper_yd3: number;
  readonly bucket_payload_t: number;
  readonly target_truck_payload_t: number;
  readonly observed_fill_factor: number; // 0..1
}): LoaderTruckMatch {
  const recommended = round2(9.0 * Math.pow(Math.max(0, args.loader_dipper_yd3), 1.1));
  const nineToOne = round2(9 * Math.max(0, args.bucket_payload_t));
  const perPass = Math.max(args.bucket_payload_t * args.observed_fill_factor, 0.0001);
  const passes = round1(args.target_truck_payload_t / perPass);
  const fillOk = args.observed_fill_factor >= 0.8 && args.observed_fill_factor <= 0.95;
  return {
    recommended_truck_payload_t: recommended,
    nine_to_one_payload_t: nineToOne,
    passes_to_fill: passes,
    fill_factor_ok: fillOk,
    note: fillOk
      ? 'Fill factor inside the 80-95% target band.'
      : 'Fill factor outside 80-95% target band: re-check bucket fill and dump-height clearance.',
    evidence_ids: [MMA_EVIDENCE.loaderTruckMatch],
  };
}

export interface FleetSizing {
  readonly loaders: number;
  readonly trucks: number;
  readonly drills: number;
  readonly evidence_ids: ReadonlyArray<MmaEvidenceId>;
}

/**
 * Open-pit truck-shovel fleet sizing (Dossier §3.2). Loader/truck counts
 * are caller-supplied per-machine productivities (the dossier's formula
 * inputs collapse to productivity once density/efficiency are folded in);
 * the drill count uses the published tpd rule of thumb.
 */
export function sizeFleet(args: {
  readonly daily_tonnage_tpd: number;
  readonly loader_productivity_tph: number;
  readonly truck_productivity_tph: number;
  readonly working_hours_per_day: number;
}): FleetSizing {
  const hours = Math.max(1, args.working_hours_per_day);
  const dailyLoaderCap = Math.max(args.loader_productivity_tph * hours, 0.0001);
  const dailyTruckCap = Math.max(args.truck_productivity_tph * hours, 0.0001);
  const tpd = Math.max(0, args.daily_tonnage_tpd);
  return {
    loaders: Math.max(1, Math.ceil(tpd / dailyLoaderCap)),
    trucks: Math.max(1, Math.ceil(tpd / dailyTruckCap)),
    drills: drillFleetRule(tpd),
    evidence_ids: [MMA_EVIDENCE.openPitSizing],
  };
}

function drillFleetRule(tpd: number): number {
  if (tpd > 60_000) return 4;
  if (tpd >= 60_000) return 3;
  if (tpd < 60_000 && tpd > 25_000) return 3;
  return 2; // >=2 drills <=25,000 tpd
}

export interface GensetSizing {
  readonly recommended_rating_kw: number;
  readonly load_band_ok: boolean;
  readonly verdict: 'wet_stacking_risk' | 'life_loss_risk' | 'healthy';
  readonly note: string;
  readonly evidence_ids: ReadonlyArray<MmaEvidenceId>;
}

/**
 * Genset load-band check (Dossier §3.3). Prime sets are happiest at
 * 70-80% load (continuous 70-100%); chronic <30-40% risks wet-stacking;
 * sustained >90% shortens engine life. Recommends a rating that lands the
 * expected load at ~75% for prime / leaves 20-30% margin for standby.
 */
export function sizeGenset(args: {
  readonly expected_load_kw: number;
  readonly rating_kw: number;
  readonly duty: 'prime' | 'standby';
}): GensetSizing {
  const load = Math.max(0, args.expected_load_kw);
  const rating = Math.max(load, args.rating_kw, 0.0001);
  const lf = load / rating;
  const targetLf = args.duty === 'prime' ? 0.75 : 0.7;
  const recommended = round1(load / targetLf);
  let verdict: GensetSizing['verdict'] = 'healthy';
  if (lf < 0.4) verdict = 'wet_stacking_risk';
  else if (lf > 0.9) verdict = 'life_loss_risk';
  const bandOk = lf >= 0.4 && lf <= 0.9;
  return {
    recommended_rating_kw: recommended,
    load_band_ok: bandOk,
    verdict,
    note:
      verdict === 'wet_stacking_risk'
        ? 'Load <40%: wet-stacking risk; downsize or add base load.'
        : verdict === 'life_loss_risk'
          ? 'Load >90% sustained: engine-life loss; upsize for margin.'
          : 'Load inside the healthy band.',
    evidence_ids: [MMA_EVIDENCE.gensetSizing],
  };
}

// ─────────────────────────────────────────────────────────────────────
// Lease-vs-buy — utilisation breakeven + AISC treatment (Dossier §4)
// ─────────────────────────────────────────────────────────────────────

export interface LeaseVsBuyResult {
  readonly verdict: 'buy_finance' | 'lease' | 'breakeven';
  readonly breakeven_hours_per_year: number;
  readonly own_cost_per_hour: number;
  readonly rental_cost_per_hour: number;
  readonly aisc_note: string;
  readonly evidence_ids: ReadonlyArray<MmaEvidenceId>;
}

/**
 * Utilisation breakeven (Dossier §4.5). Ownership wins above the
 * breakeven hours/yr because rental's per-hour premium only pays off when
 * the machine sits idle enough of the year. All amounts are
 * currency-agnostic (caller passes a consistent currency); never
 * hard-codes TZS/USD. The AISC note reflects the post-2019 WGC treatment
 * folding lease principal+financing into AISC (Dossier §4.4).
 */
export function leaseVsBuy(args: {
  readonly purchase_price: number;
  readonly economic_life_years: number;
  readonly residual_value: number;
  readonly annual_owning_fixed_cost: number; // insurance, interest, etc.
  readonly operating_cost_per_hour: number; // fuel+lube+tyres+parts+labour
  readonly rental_rate_per_hour: number; // all-in rental
  readonly expected_hours_per_year: number;
}): LeaseVsBuyResult {
  const life = Math.max(1, args.economic_life_years);
  const annualDepreciation = (Math.max(0, args.purchase_price) - Math.max(0, args.residual_value)) / life;
  const annualOwningFixed = annualDepreciation + Math.max(0, args.annual_owning_fixed_cost);
  const hrs = Math.max(args.expected_hours_per_year, 0.0001);
  const ownPerHour = annualOwningFixed / hrs + Math.max(0, args.operating_cost_per_hour);
  const rentPerHour = Math.max(0, args.rental_rate_per_hour);

  // Breakeven hours: annualOwningFixed / (rentPerHour - (rentPerHour rental
  // is all-in so compare against owning fixed only vs rental premium over
  // operating). Rental premium per hour above own operating cost:
  const rentalPremium = rentPerHour - Math.max(0, args.operating_cost_per_hour);
  const breakevenHours = rentalPremium > 0 ? round1(annualOwningFixed / rentalPremium) : Number.POSITIVE_INFINITY;

  const verdict: LeaseVsBuyResult['verdict'] =
    ownPerHour < rentPerHour ? 'buy_finance' : ownPerHour > rentPerHour ? 'lease' : 'breakeven';

  return {
    verdict,
    breakeven_hours_per_year: Number.isFinite(breakevenHours) ? breakevenHours : 0,
    own_cost_per_hour: round2(ownPerHour),
    rental_cost_per_hour: round2(rentPerHour),
    aisc_note:
      'Per WGC post-2019 guidance, the principal + financing component of lease cash payments now lands in AISC; ' +
      'sustaining capex from a purchase also lands in AISC. The financing structure moves the reported per-ounce cost.',
    evidence_ids: [
      MMA_EVIDENCE.utilisationBreakeven,
      MMA_EVIDENCE.leaseDecision,
      MMA_EVIDENCE.aiscTreatment,
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────
// Procurement — TCO-weighted RFQ scorer (Dossier §5)
// ─────────────────────────────────────────────────────────────────────

export interface SupplierBid {
  readonly supplier_id: string;
  readonly sticker_price: number;
  readonly est_lifetime_fuel_cost: number;
  readonly est_lifetime_parts_cost: number;
  readonly parts_lead_time_days: number;
  readonly warranty_months: number;
  readonly in_country_dealer: boolean;
  readonly local_content_pct: number; // 0..100
}

export interface TcoScore {
  readonly supplier_id: string;
  readonly tco: number; // lower is better (currency-agnostic)
  readonly score: number; // 0..100 composite, higher is better
  readonly flags: ReadonlyArray<string>;
}

export interface ProcurementRanking {
  readonly ranked: ReadonlyArray<TcoScore>;
  readonly winner_id: string | null;
  readonly evidence_ids: ReadonlyArray<MmaEvidenceId>;
}

/**
 * Rank suppliers on TCO, never on sticker price (Dossier §5.1). TCO =
 * sticker + lifetime fuel + lifetime parts. The composite score also
 * rewards short parts lead-time (the African long-pole, §5.4), warranty
 * length (12-24mo, §5.2), in-country dealer presence (§5.4) and
 * local-content % (§5.3). All money inputs share the caller's currency.
 */
export function rankSuppliersByTco(bids: ReadonlyArray<SupplierBid>): ProcurementRanking {
  if (bids.length === 0) {
    return { ranked: [], winner_id: null, evidence_ids: [MMA_EVIDENCE.tcoNotSticker] };
  }
  const withTco = bids.map((b) => ({
    bid: b,
    tco: Math.max(0, b.sticker_price) + Math.max(0, b.est_lifetime_fuel_cost) + Math.max(0, b.est_lifetime_parts_cost),
  }));
  const maxTco = Math.max(...withTco.map((x) => x.tco), 1);

  const scored: ReadonlyArray<TcoScore> = withTco.map(({ bid, tco }) => {
    const flags: string[] = [];
    // 60% TCO (inverted), 15% lead-time, 10% warranty, 10% dealer, 5% local-content.
    const tcoScore = (1 - tco / maxTco) * 60;
    const leadScore = clamp01(1 - bid.parts_lead_time_days / 120) * 15;
    const warrantyScore = clamp01(bid.warranty_months / 24) * 10;
    const dealerScore = bid.in_country_dealer ? 10 : 0;
    const localScore = clamp01(bid.local_content_pct / 100) * 5;
    if (bid.parts_lead_time_days > 90) flags.push('long parts lead-time (African TCO killer)');
    if (bid.warranty_months < 12) flags.push('warranty below 12-month floor');
    if (!bid.in_country_dealer) flags.push('no in-country dealer presence');
    return {
      supplier_id: bid.supplier_id,
      tco: round2(tco),
      score: round1(tcoScore + leadScore + warrantyScore + dealerScore + localScore),
      flags,
    };
  });

  const ranked = [...scored].sort((a, b) => b.score - a.score);
  return {
    ranked,
    winner_id: ranked.length > 0 ? ranked[0]!.supplier_id : null,
    evidence_ids: [
      MMA_EVIDENCE.tcoNotSticker,
      MMA_EVIDENCE.rfqDiscipline,
      MMA_EVIDENCE.localContent,
      MMA_EVIDENCE.aftermarketLeadtime,
    ],
  };
}

// ─────────────────────────────────────────────────────────────────────
// Pure numeric helpers
// ─────────────────────────────────────────────────────────────────────

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}
