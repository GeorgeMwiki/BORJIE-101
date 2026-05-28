/**
 * Domain signal graph — typed, frozen, statically declared.
 *
 * Source of truth (doc): `Docs/DESIGN/DOMAIN_SIGNAL_GRAPH.md`.
 * Source of truth (nodes): `Docs/DESIGN/DOMAIN_DEPTH_MANIFEST.md` via
 * `services/api-gateway/src/services/domain-depth/`.
 *
 * Each edge encodes a known causal or correlational link between two
 * sub-areas across (or within) the 14 owner-os domains. The graph is
 * consumed by:
 *
 *   - correlation-engine.ts (which OTHER domains the asked-about state
 *     touches RIGHT NOW)
 *   - causation-tracer.ts (walk UPSTREAM from a symptom to surface root
 *     causes)
 *   - comparison-framework.ts (which baselines apply per metric)
 *   - insight-emitter.ts (compose non-obvious opportunities, risks,
 *     anomalies, trends)
 *
 * The graph is frozen at module load. Mutating it at runtime is a hard
 * failure. To grow the graph: add the edge here AND in the doc, then
 * the `signal-graph.test.ts` referential-integrity test passes.
 */

import type { DomainId } from '../domain-depth/types';

export type SignalEdgeKind = 'causal' | 'correlational' | 'composite';
export type SignalEdgeDirection = 'forward' | 'bidirectional';

/**
 * A single graph edge.
 *
 *   - `from` / `to` are dotted ids: `<domain>.<sub_area>`. Both ends MUST
 *     exist in the domain-depth manifest.
 *   - `strength` is 0..1 — calibrated against telemetry or industry
 *     baseline (see the doc for the rationale per edge).
 *   - `lagDays` is the typical observed lag from `from` move to `to`
 *     move. Same-day = 0.
 */
export interface SignalEdge {
  readonly from: string;
  readonly to: string;
  readonly kind: SignalEdgeKind;
  readonly direction: SignalEdgeDirection;
  readonly strength: number;
  readonly lagDays: number;
  readonly rationale: string;
}

/** Reverse-engineer a domain id from a dotted sub-area id. */
export function domainOf(subAreaId: string): DomainId | undefined {
  const dot = subAreaId.indexOf('.');
  if (dot < 0) return undefined;
  const head = subAreaId.slice(0, dot);
  return DOMAINS.has(head as DomainId) ? (head as DomainId) : undefined;
}

const DOMAINS: ReadonlySet<DomainId> = new Set<DomainId>([
  'compliance',
  'finance',
  'operations',
  'hr',
  'marketing',
  'risk',
  'treasury',
  'geology',
  'marketplace',
  'licences',
  'holdings',
  'subsidiaries',
  'succession',
  'asset-register',
]);

// ─────────────────────────────────────────────────────────────────────
// Edge list (90 edges; target ≥ 60 per spec).
// ─────────────────────────────────────────────────────────────────────

export const SIGNAL_EDGES: ReadonlyArray<SignalEdge> = Object.freeze([
  // Compliance internal cascades
  edge('compliance.environmental', 'compliance.mining_licences', 'causal', 'forward', 0.9, 0,
    'Lapsed NEMC EIA blocks Mining Commission renewal (Mining Act 2010 s.43 + EMA 2004 s.81).'),
  edge('compliance.tax', 'compliance.banking_fx', 'causal', 'forward', 0.85, 7,
    'Late TRA royalty freezes BoT gold-window settlement until receipt is presented.'),
  edge('compliance.tax', 'compliance.trade_registration', 'causal', 'forward', 0.6, 30,
    'TRA defaulters list flows to BRELA annual-return review and can trigger a director query.'),
  edge('compliance.workplace_safety', 'compliance.workforce_certifications', 'causal', 'forward', 0.7, 14,
    'OSHA incident reopens NACTVET equipment-operator certification checks.'),
  edge('compliance.aml_kyc', 'compliance.banking_fx', 'causal', 'forward', 0.8, 0,
    'FIU red flag suspends BoT gold-window settlement instantly.'),
  edge('compliance.customs', 'compliance.banking_fx', 'composite', 'forward', 0.75, 1,
    'Missing ASYCUDA documentation blocks USD repatriation against the same parcel.'),
  edge('compliance.labour', 'compliance.workplace_safety', 'correlational', 'forward', 0.55, 30,
    'Unresolved labour grievances correlate with rising near-miss incidents.'),
  edge('compliance.local_content', 'compliance.mining_licences', 'causal', 'forward', 0.7, 90,
    'Failing 2018 Local Content Regulations triggers Mining Commission notice that can escalate to suspension.'),

  // Compliance → Finance / Treasury / Risk
  edge('compliance.tax', 'finance.tax_provisioning', 'causal', 'forward', 0.95, 0,
    'Royalty draft IS the provisioning line; missing the draft = wrong P&L.'),
  edge('compliance.tax', 'treasury.cash_position', 'causal', 'forward', 0.6, 15,
    'A penalty (5% + interest) on late royalty drains cash by cut-off + 15d.'),
  edge('compliance.banking_fx', 'treasury.fx_hedging', 'causal', 'forward', 0.85, 0,
    'Loss of gold-window access forces an unhedged USD position.'),
  edge('compliance.banking_fx', 'finance.fx_exposure', 'causal', 'forward', 0.9, 0,
    'Same incident on the finance ledger view.'),
  edge('compliance.environmental', 'risk.environmental_risk', 'causal', 'forward', 0.9, 0,
    'An amber NEMC EIA pushes the environmental-risk register off green.'),
  edge('compliance.mining_licences', 'risk.regulatory_risk', 'causal', 'forward', 0.85, 0,
    'Imminent licence expiry raises the regulator-risk score.'),
  edge('compliance.aml_kyc', 'risk.cyber_risk', 'correlational', 'forward', 0.4, 30,
    'AML failures correlate with KYC document leaks (cyber exposure).'),
  edge('compliance.insurance', 'risk.insurance_gap', 'causal', 'bidirectional', 0.95, 0,
    'Same data point on two views; bidirectional because the gap is read both ways.'),

  // Operations → Finance / Compliance / Risk
  edge('operations.production', 'finance.profit_loss', 'causal', 'forward', 0.95, 30,
    'Production tonnage feeds revenue line on the next monthly close.'),
  edge('operations.production', 'compliance.tax', 'causal', 'forward', 0.9, 15,
    'Tonnage drives the royalty draft per TRA monthly cadence.'),
  edge('operations.fuel', 'operations.production', 'causal', 'forward', 0.85, 5,
    'Fuel stock-out cancels haulage shifts within a week.'),
  edge('operations.fuel', 'finance.opex', 'causal', 'forward', 0.95, 30,
    'Fuel is the largest opex line; price moves hit P&L next close.'),
  edge('operations.equipment_availability', 'operations.production', 'causal', 'forward', 0.85, 1,
    'A primary-plant breakdown trims throughput immediately.'),
  edge('operations.shifts_crew', 'operations.production', 'causal', 'forward', 0.85, 1,
    'Absenteeism and understaffed shifts cut tonnage same-day.'),
  edge('operations.incident_log', 'compliance.workplace_safety', 'causal', 'forward', 0.95, 0,
    'Every recorded incident lands on the OSHA register automatically.'),
  edge('operations.incident_log', 'risk.operational_risk', 'causal', 'forward', 0.9, 7,
    'Repeat incidents at a site raise the operational-risk score within a week.'),
  edge('operations.tailings_storage', 'compliance.environmental', 'causal', 'forward', 0.95, 0,
    'A tailings dam approaching freeboard triggers the NEMC quarterly filing line.'),
  edge('operations.tailings_storage', 'risk.environmental_risk', 'causal', 'forward', 0.95, 0,
    'Same incident on the risk register view.'),
  edge('operations.maintenance', 'operations.equipment_availability', 'causal', 'forward', 0.8, 14,
    'Skipped planned maintenance correlates with breakdowns two weeks later.'),
  edge('operations.haulage', 'operations.production', 'causal', 'forward', 0.7, 0,
    'Queue at the crusher caps daily mill feed same-shift.'),

  // HR → Operations / Compliance / Finance / Risk
  edge('hr.shifts_attendance', 'operations.shifts_crew', 'causal', 'bidirectional', 0.9, 0,
    'Same headcount; biometric data flows both ways.'),
  edge('hr.shifts_attendance', 'operations.production', 'causal', 'forward', 0.8, 1,
    'Absenteeism trims shift output the next day.'),
  edge('hr.certifications_expiring', 'compliance.workforce_certifications', 'causal', 'bidirectional', 0.95, 0,
    'Mirror sub-area on two domain panels.'),
  edge('hr.statutory_contributions', 'compliance.labour', 'causal', 'forward', 0.95, 0,
    'NSSF / WCF default IS a labour breach.'),
  edge('hr.statutory_contributions', 'finance.opex', 'causal', 'forward', 0.95, 30,
    'Statutory hits payroll opex next close.'),
  edge('hr.payroll_readiness', 'treasury.cash_position', 'causal', 'forward', 0.85, 1,
    'Payroll day is the largest single cash outflow.'),
  edge('hr.safety_incidents', 'operations.incident_log', 'causal', 'bidirectional', 0.9, 0,
    'Mirror sub-area, different domain panel.'),
  edge('hr.open_grievances', 'risk.human_capital_risk', 'causal', 'forward', 0.7, 14,
    'Unresolved grievances raise the union-action probability.'),
  edge('hr.leavers_exit', 'operations.production', 'causal', 'forward', 0.5, 30,
    'Voluntary attrition (esp. supervisors) trims output over a month.'),
  edge('hr.leavers_exit', 'operations.shifts_crew', 'causal', 'forward', 0.7, 14,
    'Same lever, faster signal on the shifts panel.'),

  // Geology → Operations / Finance / Risk / Marketplace
  edge('geology.drill_programme', 'geology.mineral_resource', 'causal', 'forward', 0.85, 90,
    'Drilling extends the resource statement on the next annual update.'),
  edge('geology.assay_backlog', 'operations.production', 'causal', 'forward', 0.6, 30,
    'Pending assays delay grade-control decisions.'),
  edge('geology.grade_control', 'operations.production', 'causal', 'forward', 0.8, 0,
    'Real grade vs plan changes the daily mill feed.'),
  edge('geology.grade_control', 'compliance.tax', 'causal', 'forward', 0.7, 15,
    'Mine-call factor shifts royalty per parcel.'),
  edge('geology.geotechnical', 'risk.environmental_risk', 'causal', 'forward', 0.85, 30,
    'Pit-slope instability raises tailings and environmental risk.'),
  edge('geology.hydrology', 'operations.tailings_storage', 'causal', 'forward', 0.8, 14,
    'Rising water table raises tailings pond level.'),
  edge('geology.resource_depletion', 'risk.geological_risk', 'causal', 'forward', 0.95, 365,
    'Extraction > additions on the annual = depleting reserve.'),
  edge('geology.grade_control', 'marketplace.price_benchmarks', 'correlational', 'forward', 0.5, 7,
    'Grade-up parcels list at LBMA-fix premium.'),

  // Treasury → Finance / Compliance / Marketplace / Risk
  edge('treasury.cash_position', 'finance.cash_flow', 'causal', 'bidirectional', 0.95, 0,
    'Same number on two views.'),
  edge('treasury.fx_hedging', 'finance.fx_exposure', 'causal', 'bidirectional', 0.95, 0,
    'Mirror.'),
  edge('treasury.bot_gold_window', 'marketplace.export_documentation', 'causal', 'forward', 0.85, 0,
    'No window approval = no export shipment.'),
  edge('treasury.bot_gold_window', 'compliance.banking_fx', 'causal', 'bidirectional', 0.9, 0,
    'Mutual entanglement of window state and BoT compliance.'),
  edge('treasury.debt_service', 'risk.financial_risk', 'causal', 'forward', 0.85, 30,
    'A missed coupon raises counterparty credit risk.'),
  edge('treasury.working_capital_lines', 'finance.working_capital', 'causal', 'bidirectional', 0.9, 0,
    'Mirror.'),

  // Marketplace → Compliance / Finance / Treasury / Risk
  edge('marketplace.active_listings', 'finance.profit_loss', 'causal', 'forward', 0.7, 14,
    'List-to-cash 14d → revenue lands on next close.'),
  edge('marketplace.bids_received', 'marketplace.settlement_velocity', 'correlational', 'forward', 0.6, 7,
    'Strong bid stack shortens list-to-cash.'),
  edge('marketplace.buyer_vetting', 'compliance.aml_kyc', 'causal', 'bidirectional', 0.95, 0,
    'Mirror sub-area.'),
  edge('marketplace.chain_of_custody', 'compliance.customs', 'causal', 'forward', 0.95, 0,
    'ASYCUDA filing requires the chain hash.'),
  edge('marketplace.export_documentation', 'compliance.customs', 'causal', 'bidirectional', 0.95, 0,
    'Same data on two views.'),
  edge('marketplace.price_benchmarks', 'finance.profit_loss', 'causal', 'forward', 0.85, 1,
    'LBMA fix moves the revenue figure on the next parcel.'),
  edge('marketplace.price_benchmarks', 'treasury.fx_hedging', 'causal', 'forward', 0.85, 1,
    'LBMA fix drives the hedge.'),
  edge('marketplace.dispute_refund_log', 'risk.counterparty_risk', 'causal', 'forward', 0.7, 30,
    'Dispute rate up = counterparty credit risk up.'),

  // Risk → enterprise feedback loops
  edge('risk.commodity_price', 'finance.profit_loss', 'causal', 'forward', 0.95, 30,
    'Gold/gem price swing hits revenue line.'),
  edge('risk.currency_risk', 'treasury.fx_hedging', 'causal', 'bidirectional', 0.9, 0,
    'The hedge IS the response to currency risk.'),
  edge('risk.counterparty_risk', 'marketplace.buyer_vetting', 'causal', 'forward', 0.7, 30,
    'Buyer downgrade triggers a vetting reopen.'),
  edge('risk.cyber_risk', 'compliance.data_protection', 'causal', 'forward', 0.8, 0,
    'A breach kicks the 72-hour PDPA notification clock.'),
  edge('risk.geopolitical', 'compliance.aml_kyc', 'correlational', 'forward', 0.6, 14,
    'Regional sanctions surge raises KYC flags.'),

  // Marketing → Reputation / Risk / Marketplace
  edge('marketing.community_sentiment', 'risk.reputational_risk', 'causal', 'forward', 0.8, 7,
    'Community grievance volume up = reputational risk up.'),
  edge('marketing.community_sentiment', 'compliance.local_content', 'correlational', 'forward', 0.6, 30,
    'CDA performance correlates with community sentiment.'),
  edge('marketing.counterparty_perception', 'marketplace.bids_received', 'correlational', 'forward', 0.5, 30,
    'Buyer NPS correlates with bid intensity.'),
  edge('marketing.pr_crisis_log', 'risk.reputational_risk', 'causal', 'forward', 0.9, 0,
    'Mirror with intensity.'),
  edge('marketing.investor_communications', 'treasury.bank_relationships', 'correlational', 'forward', 0.5, 30,
    'Strong board pack correlates with covenant headroom.'),

  // Holdings / Subsidiaries / Succession — corporate edges
  edge('holdings.beneficial_ownership', 'compliance.trade_registration', 'causal', 'forward', 0.9, 0,
    'BRELA wants UBO filings current.'),
  edge('holdings.inter_company_loans', 'compliance.tax', 'causal', 'forward', 0.7, 30,
    'Transfer-pricing documentation flows into TRA filing.'),
  edge('subsidiaries.statutory_filings', 'compliance.trade_registration', 'causal', 'forward', 0.9, 0,
    'Mirror per entity.'),
  edge('subsidiaries.tax_filings', 'compliance.tax', 'causal', 'forward', 0.95, 0,
    'Mirror per entity at group view.'),
  edge('subsidiaries.active_disputes', 'risk.regulatory_risk', 'causal', 'forward', 0.7, 30,
    'Open litigation raises the regulator score.'),
  edge('succession.key_role_coverage', 'risk.human_capital_risk', 'causal', 'forward', 0.85, 90,
    'Empty bench = key-person risk amber.'),
  edge('succession.ownership_transition', 'holdings.beneficial_ownership', 'causal', 'forward', 0.9, 0,
    'A share transfer requires a UBO filing.'),
  edge('succession.estate_planning', 'holdings.group_structure', 'causal', 'forward', 0.6, 180,
    'Estate event triggers a group restructure on the 6-month horizon.'),

  // Asset register — fixed asset edges
  edge('asset-register.fixed_assets', 'finance.capex', 'causal', 'bidirectional', 0.95, 0,
    'Same number on two views.'),
  edge('asset-register.heavy_mobile_equipment', 'operations.equipment_availability', 'causal', 'bidirectional', 0.85, 0,
    'Same fleet on two views.'),
  edge('asset-register.ore_stockpile', 'finance.working_capital', 'causal', 'forward', 0.9, 0,
    'Stockpile valuation IS working capital.'),
  edge('asset-register.consumables_stock', 'operations.fuel', 'causal', 'forward', 0.9, 7,
    'Fuel inventory on the asset side; opex on the ops side.'),
  edge('asset-register.insured_asset_reconciliation', 'compliance.insurance', 'causal', 'forward', 0.95, 0,
    'Reconciliation gap = policy gap.'),
  edge('asset-register.bullion_dore_inventory', 'marketplace.export_documentation', 'causal', 'forward', 0.85, 0,
    'Stock waiting on a TRA export certificate.'),

  // Long-lag environmental + climate edges
  edge('risk.environmental_risk', 'operations.production', 'causal', 'forward', 0.6, 90,
    'A flood / drought trims a quarter of production.'),
  edge('geology.hydrology', 'risk.environmental_risk', 'causal', 'forward', 0.85, 30,
    'Hydrology surprise raises the environmental risk score within a month.'),
  edge('compliance.environmental', 'marketing.community_sentiment', 'correlational', 'forward', 0.5, 60,
    'A clean EIA refresh lifts village sentiment.'),

  // Composite chains
  edge('hr.leavers_exit', 'operations.production', 'composite', 'forward', 0.6, 30,
    'Composite chain: leavers → shifts → production. Effective strength 0.7*0.85.'),
  edge('compliance.tax', 'marketplace.export_documentation', 'composite', 'forward', 0.72, 7,
    'Composite chain: late royalty → banking_fx freeze → export blocked.'),
  edge('risk.commodity_price', 'finance.profit_loss', 'composite', 'forward', 0.81, 30,
    'Composite chain: spot price → LBMA-priced revenue → next close.'),
]);

// ─────────────────────────────────────────────────────────────────────
// Helpers (small, pure)
// ─────────────────────────────────────────────────────────────────────

function edge(
  from: string,
  to: string,
  kind: SignalEdgeKind,
  direction: SignalEdgeDirection,
  strength: number,
  lagDays: number,
  rationale: string,
): SignalEdge {
  return Object.freeze({ from, to, kind, direction, strength, lagDays, rationale });
}

/** Return all edges where `nodeId` is the `from` side (outbound). */
export function outboundEdges(nodeId: string): ReadonlyArray<SignalEdge> {
  return SIGNAL_EDGES.filter(
    (e) => e.from === nodeId || (e.direction === 'bidirectional' && e.to === nodeId),
  );
}

/** Return all edges where `nodeId` is the `to` side (inbound — upstream). */
export function inboundEdges(nodeId: string): ReadonlyArray<SignalEdge> {
  return SIGNAL_EDGES.filter(
    (e) => e.to === nodeId || (e.direction === 'bidirectional' && e.from === nodeId),
  );
}

/** Return outbound edges grouped by the target's domain (best per domain). */
export function topTouchesForNode(
  nodeId: string,
  limit = 3,
): ReadonlyArray<SignalEdge> {
  const candidates = outboundEdges(nodeId);
  const bestPerDomain = new Map<DomainId, SignalEdge>();
  for (const e of candidates) {
    const targetNode = e.from === nodeId ? e.to : e.from;
    const domain = domainOf(targetNode);
    if (!domain) continue;
    const existing = bestPerDomain.get(domain);
    if (!existing || existing.strength < e.strength) {
      bestPerDomain.set(domain, e);
    }
  }
  return Object.freeze(
    Array.from(bestPerDomain.values())
      .sort((a, b) => b.strength - a.strength)
      .slice(0, limit),
  );
}

/** Set of every node referenced by any edge. */
export function referencedNodes(): ReadonlySet<string> {
  const set = new Set<string>();
  for (const e of SIGNAL_EDGES) {
    set.add(e.from);
    set.add(e.to);
  }
  return set;
}
