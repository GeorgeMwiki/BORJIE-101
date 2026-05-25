/**
 * `report.gather_kpis` — read tier.
 *
 * Pulls the week's KPIs across cashflow, occupancy, arrears,
 * maintenance, complaints. The data sources are abstracted behind a
 * port — production wires the warehouse adapters, tests inject
 * fixtures.
 */

export interface KpiCitation {
  readonly metric: string;
  readonly sourceTable: string;
  readonly sourceRowId: string;
  readonly capturedAtMs: number;
}

export interface CashflowKpis {
  readonly grossCollectedMinor: number;
  readonly netCollectedMinor: number;
  readonly arrearsBalanceMinor: number;
  readonly currency: string;
  readonly citation: KpiCitation;
}

export interface OccupancyKpis {
  readonly occupiedUnits: number;
  readonly totalUnits: number;
  readonly occupancyRate: number;
  readonly newSignsThisWeek: number;
  readonly movedOutThisWeek: number;
  readonly citation: KpiCitation;
}

export interface ArrearsKpis {
  readonly leasesInArrears: number;
  readonly newArrearsThisWeek: number;
  readonly curedThisWeek: number;
  readonly citation: KpiCitation;
}

export interface MaintenanceKpis {
  readonly openTickets: number;
  readonly closedThisWeek: number;
  readonly emergencyTicketsThisWeek: number;
  readonly avgResponseSeconds: number;
  readonly citation: KpiCitation;
}

export interface ComplaintKpis {
  readonly newComplaintsThisWeek: number;
  readonly criticalComplaintsThisWeek: number;
  readonly resolvedThisWeek: number;
  readonly citation: KpiCitation;
}

export interface PortfolioKpiSnapshot {
  readonly periodStartMs: number;
  readonly periodEndMs: number;
  readonly cashflow: CashflowKpis;
  readonly occupancy: OccupancyKpis;
  readonly arrears: ArrearsKpis;
  readonly maintenance: MaintenanceKpis;
  readonly complaints: ComplaintKpis;
}

export interface KpiDataPort {
  fetchCashflow(args: { readonly tenantId: string; readonly fromMs: number; readonly toMs: number }): Promise<CashflowKpis>;
  fetchOccupancy(args: { readonly tenantId: string; readonly fromMs: number; readonly toMs: number }): Promise<OccupancyKpis>;
  fetchArrears(args: { readonly tenantId: string; readonly fromMs: number; readonly toMs: number }): Promise<ArrearsKpis>;
  fetchMaintenance(args: { readonly tenantId: string; readonly fromMs: number; readonly toMs: number }): Promise<MaintenanceKpis>;
  fetchComplaints(args: { readonly tenantId: string; readonly fromMs: number; readonly toMs: number }): Promise<ComplaintKpis>;
}

export interface GatherKpisArgs {
  readonly port: KpiDataPort;
  readonly tenantId: string;
  readonly periodStartMs: number;
  readonly periodEndMs: number;
}

export async function gatherKpis(args: GatherKpisArgs): Promise<PortfolioKpiSnapshot> {
  const range = { tenantId: args.tenantId, fromMs: args.periodStartMs, toMs: args.periodEndMs };
  const [cashflow, occupancy, arrears, maintenance, complaints] = await Promise.all([
    args.port.fetchCashflow(range),
    args.port.fetchOccupancy(range),
    args.port.fetchArrears(range),
    args.port.fetchMaintenance(range),
    args.port.fetchComplaints(range),
  ]);
  return Object.freeze({
    periodStartMs: args.periodStartMs,
    periodEndMs: args.periodEndMs,
    cashflow,
    occupancy,
    arrears,
    maintenance,
    complaints,
  });
}
