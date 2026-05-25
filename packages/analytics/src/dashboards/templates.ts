/**
 * Pre-shipped SOTA dashboard templates.
 *
 * Each template is a function: `params` → `DashboardDef`. Templates are
 * tuned for property-management workflows; widgets emit cube queries
 * that the composition root resolves against the right cube definition.
 *
 * Templates:
 *   1. leasing-financial-performance — revenue, occupancy, rent roll
 *   2. maintenance-ops — ticket queue, MTTR, SLA breaches
 *   3. tenant-credit — credit score distribution, default rate
 *   4. portfolio-overview — KPIs across all four pillars
 */

import type { DashboardDef, WidgetDef } from '../types.js';
import {
  barChart,
  boxplotChart,
  funnelChart,
  gaugeChart,
  heatmapChart,
  lineChart,
  pieChart,
} from '../charts/index.js';

export interface ComposeFromTemplateParams {
  readonly tenantId: string;
  readonly defaultTimeRange?: DashboardDef['defaultTimeRange'];
  /** Optional name override — defaults to the template's canonical name. */
  readonly name?: string;
}

export type TemplateName =
  | 'leasing-financial-performance'
  | 'maintenance-ops'
  | 'tenant-credit'
  | 'portfolio-overview';

export const TEMPLATE_NAMES: readonly TemplateName[] = [
  'leasing-financial-performance',
  'maintenance-ops',
  'tenant-credit',
  'portfolio-overview',
];

export function composeFromTemplate(
  template: TemplateName,
  params: ComposeFromTemplateParams,
): DashboardDef {
  switch (template) {
    case 'leasing-financial-performance':
      return composeLeasingFinancial(params);
    case 'maintenance-ops':
      return composeMaintenanceOps(params);
    case 'tenant-credit':
      return composeTenantCredit(params);
    case 'portfolio-overview':
      return composePortfolioOverview(params);
  }
}

function baseDashboard(
  id: string,
  name: string,
  description: string,
  params: ComposeFromTemplateParams,
  widgets: readonly WidgetDef[],
): DashboardDef {
  return Object.freeze({
    id,
    name: params.name ?? name,
    description,
    tenantId: params.tenantId,
    layout: 'grid-12' as const,
    widgets,
    ...(params.defaultTimeRange ? { defaultTimeRange: params.defaultTimeRange } : {}),
  });
}

// ───────────────────── 1. Leasing & Financial ─────────────────────

function composeLeasingFinancial(params: ComposeFromTemplateParams): DashboardDef {
  const widgets: WidgetDef[] = [
    {
      id: 'kpi-gmv',
      title: 'Gross Rental Income',
      kind: 'kpi',
      query: {
        cube: 'leases',
        tenantId: params.tenantId,
        metrics: ['gmv'],
      },
      spec: { kind: 'kpi', metric: 'gmv', format: 'currency', comparison: { period: 'previous', showDelta: true } },
      position: { x: 0, y: 0, w: 3, h: 2 },
    },
    {
      id: 'kpi-occupancy',
      title: 'Occupancy Rate',
      kind: 'kpi',
      query: {
        cube: 'units',
        tenantId: params.tenantId,
        metrics: ['occupancy_pct'],
      },
      spec: { kind: 'kpi', metric: 'occupancy_pct', format: 'percent', threshold: { good: 95, warn: 85 } },
      position: { x: 3, y: 0, w: 3, h: 2 },
    },
    {
      id: 'kpi-arrears',
      title: 'Arrears (30d)',
      kind: 'kpi',
      query: {
        cube: 'payments',
        tenantId: params.tenantId,
        metrics: ['arrears_30d'],
      },
      spec: { kind: 'kpi', metric: 'arrears_30d', format: 'currency' },
      position: { x: 6, y: 0, w: 3, h: 2 },
    },
    {
      id: 'kpi-renewal',
      title: 'Renewal Rate',
      kind: 'kpi',
      query: {
        cube: 'leases',
        tenantId: params.tenantId,
        metrics: ['renewal_rate'],
      },
      spec: { kind: 'kpi', metric: 'renewal_rate', format: 'percent' },
      position: { x: 9, y: 0, w: 3, h: 2 },
    },
    {
      id: 'chart-revenue-trend',
      title: 'Revenue Trend',
      kind: 'chart',
      query: {
        cube: 'leases',
        tenantId: params.tenantId,
        metrics: ['gmv'],
        dimensions: ['month'],
        timeGrain: 'month',
      },
      spec: lineChart({ data: [], x: 'month', y: 'gmv' }),
      position: { x: 0, y: 2, w: 8, h: 4 },
    },
    {
      id: 'chart-status-share',
      title: 'Lease Status Share',
      kind: 'chart',
      query: {
        cube: 'leases',
        tenantId: params.tenantId,
        metrics: ['cnt'],
        dimensions: ['status'],
      },
      spec: pieChart({ data: [], category: 'status', value: 'cnt', innerRadius: 40 }),
      position: { x: 8, y: 2, w: 4, h: 4 },
    },
  ];
  return baseDashboard(
    'tpl-leasing-financial',
    'Leasing & Financial Performance',
    'Revenue, occupancy, arrears, and renewal KPIs with monthly trend.',
    params,
    widgets,
  );
}

// ───────────────────── 2. Maintenance Ops ─────────────────────

function composeMaintenanceOps(params: ComposeFromTemplateParams): DashboardDef {
  const widgets: WidgetDef[] = [
    {
      id: 'kpi-open-tickets',
      title: 'Open Tickets',
      kind: 'kpi',
      query: { cube: 'maintenance', tenantId: params.tenantId, metrics: ['open_count'] },
      spec: { kind: 'kpi', metric: 'open_count', format: 'number' },
      position: { x: 0, y: 0, w: 3, h: 2 },
    },
    {
      id: 'kpi-mttr',
      title: 'Mean Time To Resolve',
      kind: 'kpi',
      query: { cube: 'maintenance', tenantId: params.tenantId, metrics: ['mttr_ms'] },
      spec: { kind: 'kpi', metric: 'mttr_ms', format: 'duration_ms' },
      position: { x: 3, y: 0, w: 3, h: 2 },
    },
    {
      id: 'kpi-sla-breaches',
      title: 'SLA Breaches (7d)',
      kind: 'kpi',
      query: { cube: 'maintenance', tenantId: params.tenantId, metrics: ['sla_breaches'] },
      spec: { kind: 'kpi', metric: 'sla_breaches', format: 'number', threshold: { good: 0, warn: 3 } },
      position: { x: 6, y: 0, w: 3, h: 2 },
    },
    {
      id: 'gauge-csat',
      title: 'CSAT',
      kind: 'chart',
      query: { cube: 'maintenance', tenantId: params.tenantId, metrics: ['csat_score'] },
      spec: gaugeChart({ data: [], value: 0, min: 0, max: 5, label: 'CSAT' }),
      position: { x: 9, y: 0, w: 3, h: 2 },
    },
    {
      id: 'chart-ticket-funnel',
      title: 'Ticket Lifecycle Funnel',
      kind: 'chart',
      query: {
        cube: 'maintenance',
        tenantId: params.tenantId,
        metrics: ['count'],
        dimensions: ['stage'],
      },
      spec: funnelChart({ data: [], stage: 'stage', value: 'count' }),
      position: { x: 0, y: 2, w: 6, h: 4 },
    },
    {
      id: 'chart-heatmap-day-hour',
      title: 'Ticket Volume by Day × Hour',
      kind: 'chart',
      query: {
        cube: 'maintenance',
        tenantId: params.tenantId,
        metrics: ['count'],
        dimensions: ['day_of_week', 'hour'],
      },
      spec: heatmapChart({ data: [], x: 'hour', y: 'day_of_week', value: 'count' }),
      position: { x: 6, y: 2, w: 6, h: 4 },
    },
  ];
  return baseDashboard(
    'tpl-maintenance-ops',
    'Maintenance Operations',
    'Ticket queue health, MTTR, SLA breaches, CSAT, and demand heatmap.',
    params,
    widgets,
  );
}

// ───────────────────── 3. Tenant Credit ─────────────────────

function composeTenantCredit(params: ComposeFromTemplateParams): DashboardDef {
  const widgets: WidgetDef[] = [
    {
      id: 'kpi-default-rate',
      title: 'Default Rate (90d)',
      kind: 'kpi',
      query: { cube: 'tenants', tenantId: params.tenantId, metrics: ['default_rate_90d'] },
      spec: { kind: 'kpi', metric: 'default_rate_90d', format: 'percent' },
      position: { x: 0, y: 0, w: 4, h: 2 },
    },
    {
      id: 'kpi-avg-score',
      title: 'Average Credit Score',
      kind: 'kpi',
      query: { cube: 'tenants', tenantId: params.tenantId, metrics: ['avg_score'] },
      spec: { kind: 'kpi', metric: 'avg_score', format: 'number' },
      position: { x: 4, y: 0, w: 4, h: 2 },
    },
    {
      id: 'kpi-credit-band-mix',
      title: 'Prime / Subprime Ratio',
      kind: 'kpi',
      query: { cube: 'tenants', tenantId: params.tenantId, metrics: ['prime_ratio'] },
      spec: { kind: 'kpi', metric: 'prime_ratio', format: 'percent' },
      position: { x: 8, y: 0, w: 4, h: 2 },
    },
    {
      id: 'chart-score-distribution',
      title: 'Credit Score Distribution by Band',
      kind: 'chart',
      query: {
        cube: 'tenants',
        tenantId: params.tenantId,
        metrics: ['avg_score'],
        dimensions: ['band'],
      },
      spec: boxplotChart({ data: [], category: 'band', value: 'avg_score' }),
      position: { x: 0, y: 2, w: 6, h: 4 },
    },
    {
      id: 'chart-default-trend',
      title: 'Default Rate Trend',
      kind: 'chart',
      query: {
        cube: 'tenants',
        tenantId: params.tenantId,
        metrics: ['default_rate'],
        dimensions: ['month'],
        timeGrain: 'month',
      },
      spec: lineChart({ data: [], x: 'month', y: 'default_rate' }),
      position: { x: 6, y: 2, w: 6, h: 4 },
    },
  ];
  return baseDashboard(
    'tpl-tenant-credit',
    'Tenant Credit & Risk',
    'Credit-band distribution, default-rate trend, and risk KPIs.',
    params,
    widgets,
  );
}

// ───────────────────── 4. Portfolio Overview ─────────────────────

function composePortfolioOverview(params: ComposeFromTemplateParams): DashboardDef {
  const widgets: WidgetDef[] = [
    {
      id: 'kpi-noi',
      title: 'Net Operating Income',
      kind: 'kpi',
      query: { cube: 'portfolio', tenantId: params.tenantId, metrics: ['noi'] },
      spec: { kind: 'kpi', metric: 'noi', format: 'currency' },
      position: { x: 0, y: 0, w: 3, h: 2 },
    },
    {
      id: 'kpi-cap-rate',
      title: 'Portfolio Cap Rate',
      kind: 'kpi',
      query: { cube: 'portfolio', tenantId: params.tenantId, metrics: ['cap_rate'] },
      spec: { kind: 'kpi', metric: 'cap_rate', format: 'percent' },
      position: { x: 3, y: 0, w: 3, h: 2 },
    },
    {
      id: 'kpi-properties',
      title: 'Properties Under Management',
      kind: 'kpi',
      query: { cube: 'portfolio', tenantId: params.tenantId, metrics: ['property_count'] },
      spec: { kind: 'kpi', metric: 'property_count', format: 'number' },
      position: { x: 6, y: 0, w: 3, h: 2 },
    },
    {
      id: 'kpi-units',
      title: 'Units Under Management',
      kind: 'kpi',
      query: { cube: 'portfolio', tenantId: params.tenantId, metrics: ['unit_count'] },
      spec: { kind: 'kpi', metric: 'unit_count', format: 'number' },
      position: { x: 9, y: 0, w: 3, h: 2 },
    },
    {
      id: 'chart-asset-class-bar',
      title: 'Revenue by Asset Class',
      kind: 'chart',
      query: {
        cube: 'portfolio',
        tenantId: params.tenantId,
        metrics: ['gmv'],
        dimensions: ['asset_class'],
      },
      spec: barChart({ data: [], x: 'asset_class', y: 'gmv' }),
      position: { x: 0, y: 2, w: 6, h: 4 },
    },
    {
      id: 'chart-region-share',
      title: 'Portfolio Share by Region',
      kind: 'chart',
      query: {
        cube: 'portfolio',
        tenantId: params.tenantId,
        metrics: ['gmv'],
        dimensions: ['region'],
      },
      spec: pieChart({ data: [], category: 'region', value: 'gmv', innerRadius: 40 }),
      position: { x: 6, y: 2, w: 6, h: 4 },
    },
    {
      id: 'md-notes',
      title: 'Portfolio Notes',
      kind: 'markdown',
      spec: {
        kind: 'markdown',
        markdown: '## Portfolio overview\n\nThis dashboard rolls up the four core BORJIE pillars: leasing, maintenance, credit, and capital. Each KPI updates against the active reporting period.',
      },
      position: { x: 0, y: 6, w: 12, h: 2 },
    },
  ];
  return baseDashboard(
    'tpl-portfolio-overview',
    'Portfolio Overview',
    'Top-level KPIs across leasing, maintenance, credit, and capital.',
    params,
    widgets,
  );
}
