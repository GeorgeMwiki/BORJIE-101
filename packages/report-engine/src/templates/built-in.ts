/**
 * Platform built-in report templates — TS-mirror of the seven rows
 * seeded by migration 0208_report_templates.sql.
 *
 * Keeping this list in code (in addition to the DB seed) means the
 * orchestrator can boot and render without a database round-trip in
 * tests / dev. The DB is the source of truth in production, but the
 * `BUILT_IN_TEMPLATES` map is the local fallback (tested for parity
 * with the SQL seed via the package's unit tests).
 *
 * The keys here MUST stay in lock-step with the seed in migration
 * 0208. The unit tests in `__tests__/built-in-templates.test.ts`
 * enforce that.
 */

import type { ReportTemplate } from '../types.js';

function tmpl(
  id: string,
  slug: string,
  displayNameEn: string,
  displayNameSw: string | null,
  sections: readonly ReportTemplate['sections'][number][],
  outputFormats: readonly ReportTemplate['outputFormats'][number][] = [
    'pdf',
    'docx',
    'pptx',
  ],
): ReportTemplate {
  return {
    id,
    tenantId: null,
    slug,
    displayNameEn,
    displayNameSw,
    sections,
    outputFormats,
    isBuiltIn: true,
  };
}

export const BUILT_IN_TEMPLATES: Readonly<Record<string, ReportTemplate>> = {
  monthly_revenue: tmpl(
    'tmpl_monthly_revenue',
    'monthly_revenue',
    'Monthly Revenue Report',
    'Ripoti ya Mapato ya Mwezi',
    [
      {
        section_id: 'summary',
        title: 'Executive Summary',
        data_source: 'payments-ledger.revenue.month_summary',
        kind: 'narrative',
      },
      {
        section_id: 'by_property',
        title: 'Revenue by Property',
        data_source: 'payments-ledger.revenue.by_property',
        kind: 'table',
      },
      {
        section_id: 'trend_chart',
        title: '12-Month Revenue Trend',
        data_source: 'payments-ledger.revenue.trend_12m',
        kind: 'chart',
      },
      {
        section_id: 'variance',
        title: 'Variance vs Plan',
        data_source: 'payments-ledger.revenue.variance',
        kind: 'table',
      },
    ],
  ),

  occupancy_report: tmpl(
    'tmpl_occupancy_report',
    'occupancy_report',
    'Occupancy Report',
    'Ripoti ya Ujazo',
    [
      {
        section_id: 'summary',
        title: 'Portfolio Occupancy Summary',
        data_source: 'occupancy.portfolio.summary',
        kind: 'narrative',
      },
      {
        section_id: 'by_property',
        title: 'Occupancy by Property',
        data_source: 'occupancy.by_property',
        kind: 'table',
      },
      {
        section_id: 'vacancy_aging',
        title: 'Vacancy Aging',
        data_source: 'occupancy.vacancy_aging',
        kind: 'table',
      },
    ],
  ),

  arrears_aging: tmpl(
    'tmpl_arrears_aging',
    'arrears_aging',
    'Arrears Aging Report',
    'Ripoti ya Madeni',
    [
      {
        section_id: 'summary',
        title: 'Arrears Summary',
        data_source: 'payments-ledger.arrears.summary',
        kind: 'narrative',
      },
      {
        section_id: 'buckets',
        title: 'Aging Buckets (0-30 / 31-60 / 61-90 / 90+)',
        data_source: 'payments-ledger.arrears.buckets',
        kind: 'table',
      },
      {
        section_id: 'top_offenders',
        title: 'Top 20 Outstanding Tenants',
        data_source: 'payments-ledger.arrears.top_offenders',
        kind: 'table',
      },
    ],
  ),

  condition_survey: tmpl(
    'tmpl_condition_survey',
    'condition_survey',
    'Property Condition Survey',
    'Ripoti ya Hali ya Mali',
    [
      {
        section_id: 'summary',
        title: 'Condition Overview',
        data_source: 'inspections.condition.summary',
        kind: 'narrative',
      },
      {
        section_id: 'components',
        title: 'Component-Level Findings',
        data_source: 'inspections.condition.components',
        kind: 'table',
      },
      {
        section_id: 'capex_forecast',
        title: '5-Year Capex Forecast',
        data_source: 'inspections.capex_forecast',
        kind: 'chart',
      },
    ],
  ),

  q3_strategy: tmpl(
    'tmpl_q3_strategy',
    'q3_strategy',
    'Q3 Strategy Document',
    'Hati ya Mkakati wa Robo ya Tatu',
    [
      {
        section_id: 'intro',
        title: 'Strategic Context',
        data_source: 'strategy.context',
        kind: 'narrative',
      },
      {
        section_id: 'kpis',
        title: 'Current KPIs',
        data_source: 'kpi.snapshot',
        kind: 'kpi_grid',
      },
      {
        section_id: 'priorities',
        title: 'Quarter Priorities',
        data_source: 'strategy.priorities',
        kind: 'narrative',
      },
      {
        section_id: 'financial_plan',
        title: 'Financial Plan',
        data_source: 'strategy.financial_plan',
        kind: 'table',
      },
      {
        section_id: 'risks',
        title: 'Top 5 Risks',
        data_source: 'strategy.risks',
        kind: 'table',
      },
    ],
  ),

  board_pack: tmpl(
    'tmpl_board_pack',
    'board_pack',
    'Board Pack',
    'Pakiti ya Bodi',
    [
      {
        section_id: 'agenda',
        title: 'Agenda',
        data_source: 'board.agenda',
        kind: 'narrative',
      },
      {
        section_id: 'financials',
        title: 'Financial Statements',
        data_source: 'payments-ledger.statements.summary',
        kind: 'table',
      },
      {
        section_id: 'operations',
        title: 'Operations Update',
        data_source: 'operations.summary',
        kind: 'narrative',
      },
      {
        section_id: 'compliance',
        title: 'Compliance & Risk',
        data_source: 'compliance.summary',
        kind: 'table',
      },
      {
        section_id: 'resolutions',
        title: 'Proposed Resolutions',
        data_source: 'board.resolutions',
        kind: 'narrative',
      },
    ],
  ),

  customer_statement: tmpl(
    'tmpl_customer_statement',
    'customer_statement',
    'Customer Statement',
    'Hati ya Mteja',
    [
      {
        section_id: 'header',
        title: 'Statement Header',
        data_source: 'customer.statement.header',
        kind: 'narrative',
      },
      {
        section_id: 'transactions',
        title: 'Transactions',
        data_source: 'customer.statement.transactions',
        kind: 'table',
      },
      {
        section_id: 'balance',
        title: 'Closing Balance',
        data_source: 'customer.statement.closing',
        kind: 'narrative',
      },
    ],
    ['pdf', 'docx'],
  ),
};

/** In-memory template store backed by the built-in map. Used by tests. */
export class InMemoryReportTemplateStore {
  private readonly platformBuiltIns: Readonly<Record<string, ReportTemplate>>;
  private readonly tenantOverrides = new Map<string, ReportTemplate>();

  constructor(
    platformBuiltIns: Readonly<Record<string, ReportTemplate>> = BUILT_IN_TEMPLATES,
  ) {
    this.platformBuiltIns = platformBuiltIns;
  }

  async findBySlug(input: {
    readonly tenantId: string;
    readonly slug: string;
  }): Promise<ReportTemplate | null> {
    const key = `${input.tenantId}:${input.slug}`;
    const override = this.tenantOverrides.get(key);
    if (override) return override;
    return this.platformBuiltIns[input.slug] ?? null;
  }

  async listForTenant(
    _tenantId: string,
  ): Promise<ReadonlyArray<ReportTemplate>> {
    const platformRows = Object.values(this.platformBuiltIns);
    const tenantRows = Array.from(this.tenantOverrides.entries())
      .filter(([key]) => key.startsWith(`${_tenantId}:`))
      .map(([, value]) => value);
    return [...platformRows, ...tenantRows];
  }

  registerTenantOverride(template: ReportTemplate): void {
    if (template.tenantId == null) {
      throw new Error('registerTenantOverride requires tenantId set');
    }
    this.tenantOverrides.set(`${template.tenantId}:${template.slug}`, template);
  }
}
