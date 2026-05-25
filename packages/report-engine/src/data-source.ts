/**
 * In-memory data source adapter — used by tests and as a reference
 * implementation. Production composition roots wire a real adapter
 * that delegates to the payments-ledger / occupancy / KPI repositories.
 *
 * RULE: never construct SQL from LLM output. The adapter dispatches
 * `dataSource` keys to typed repository methods; if a key is unknown,
 * it returns a placeholder narrative section so the report can still
 * render (with a clear "[data unavailable]" marker) rather than fail
 * the whole document.
 */

import type {
  ReportDataAdapter,
  ResolvedReportSection,
  ReportSectionKind,
} from './types.js';

/** Adapter for `dataSource` keys → resolved sections. */
export interface DataSourceHandler {
  readonly resolve: (input: {
    readonly tenantId: string;
    readonly params: Readonly<Record<string, unknown>>;
  }) => Promise<Omit<ResolvedReportSection, 'section_id' | 'title' | 'kind'> & {
    readonly kind?: ReportSectionKind;
  }>;
}

/** Build a configurable in-memory adapter. */
export class InMemoryReportDataAdapter implements ReportDataAdapter {
  private readonly handlers: Map<string, DataSourceHandler>;

  constructor(handlers?: Record<string, DataSourceHandler>) {
    this.handlers = new Map(Object.entries(handlers ?? {}));
  }

  register(dataSource: string, handler: DataSourceHandler): void {
    this.handlers.set(dataSource, handler);
  }

  async resolve(input: {
    readonly tenantId: string;
    readonly dataSource: string;
    readonly params: Readonly<Record<string, unknown>>;
  }): Promise<ResolvedReportSection> {
    const handler = this.handlers.get(input.dataSource);
    if (!handler) {
      return {
        section_id: input.dataSource,
        title: input.dataSource,
        kind: 'narrative',
        narrative: `[data unavailable: ${input.dataSource}]`,
      };
    }
    const resolved = await handler.resolve({
      tenantId: input.tenantId,
      params: input.params,
    });
    return {
      section_id: input.dataSource,
      title: input.dataSource,
      kind: resolved.kind ?? 'narrative',
      ...(resolved.narrative !== undefined ? { narrative: resolved.narrative } : {}),
      ...(resolved.table !== undefined ? { table: resolved.table } : {}),
      ...(resolved.chart !== undefined ? { chart: resolved.chart } : {}),
      ...(resolved.kpi_grid !== undefined ? { kpi_grid: resolved.kpi_grid } : {}),
    };
  }
}

/**
 * Seed an in-memory adapter with placeholder handlers for the seven
 * built-in templates' data-source keys. Useful for smoke tests +
 * dev environments without a payments-ledger connection.
 */
export function createDevDataAdapter(): InMemoryReportDataAdapter {
  const adapter = new InMemoryReportDataAdapter();

  adapter.register('payments-ledger.revenue.month_summary', {
    resolve: async () => ({
      kind: 'narrative',
      narrative:
        'Portfolio gross revenue was strong this month with growth across all asset classes. ' +
        'Collections improved 4.2% versus prior month, driven by higher on-time payment rates.',
    }),
  });
  adapter.register('payments-ledger.revenue.by_property', {
    resolve: async () => ({
      kind: 'table',
      table: {
        headers: ['Property', 'Units', 'Revenue', 'Var %'],
        rows: [
          ['TRC Plaza', 24, 32400, '+3.2%'],
          ['Mwanza Heights', 18, 22500, '+1.8%'],
          ['Dar Apartments', 36, 48000, '+5.1%'],
        ],
      },
    }),
  });
  adapter.register('payments-ledger.revenue.trend_12m', {
    resolve: async () => ({
      kind: 'chart',
      chart: {
        title: '12-Month Revenue Trend',
        spec: { mark: 'line', encoding: { x: 'month', y: 'revenue' } },
      },
    }),
  });
  adapter.register('payments-ledger.revenue.variance', {
    resolve: async () => ({
      kind: 'table',
      table: {
        headers: ['Line item', 'Plan', 'Actual', 'Variance'],
        rows: [
          ['Rent', 100000, 102300, '+2.3%'],
          ['Service charge', 20000, 19200, '-4.0%'],
          ['Late fees', 1500, 2400, '+60%'],
        ],
      },
    }),
  });
  adapter.register('occupancy.portfolio.summary', {
    resolve: async () => ({
      kind: 'narrative',
      narrative:
        'Portfolio occupancy stands at 93.4%, in line with the healthy range for residential. ' +
        'Vacancy is concentrated in two units pending refurbishment.',
    }),
  });
  adapter.register('occupancy.by_property', {
    resolve: async () => ({
      kind: 'table',
      table: {
        headers: ['Property', 'Total', 'Occupied', 'Rate'],
        rows: [
          ['TRC Plaza', 24, 23, '95.8%'],
          ['Mwanza Heights', 18, 17, '94.4%'],
          ['Dar Apartments', 36, 33, '91.6%'],
        ],
      },
    }),
  });
  adapter.register('occupancy.vacancy_aging', {
    resolve: async () => ({
      kind: 'table',
      table: {
        headers: ['Unit', 'Days vacant', 'Cause'],
        rows: [
          ['TRC Plaza 4B', 8, 'Lease end'],
          ['Mwanza 12', 23, 'Refurb'],
          ['Dar 27', 41, 'Refurb'],
        ],
      },
    }),
  });
  adapter.register('payments-ledger.arrears.summary', {
    resolve: async () => ({
      kind: 'narrative',
      narrative:
        'Arrears stand at 4.1% of the rent roll. The 90+ bucket remains the primary risk; ' +
        'two cases are now in the legal queue.',
    }),
  });
  adapter.register('payments-ledger.arrears.buckets', {
    resolve: async () => ({
      kind: 'table',
      table: {
        headers: ['Bucket', 'Amount', 'Count'],
        rows: [
          ['0-30', 12000, 14],
          ['31-60', 7500, 6],
          ['61-90', 4200, 3],
          ['90+', 9800, 4],
        ],
      },
    }),
  });
  adapter.register('payments-ledger.arrears.top_offenders', {
    resolve: async () => ({
      kind: 'table',
      table: {
        headers: ['Tenant', 'Balance', 'Oldest'],
        rows: [
          ['Tenant A', 3200, '92 days'],
          ['Tenant B', 2100, '67 days'],
          ['Tenant C', 1800, '45 days'],
        ],
      },
    }),
  });
  adapter.register('inspections.condition.summary', {
    resolve: async () => ({
      kind: 'narrative',
      narrative:
        'Overall building condition is rated 3.8 / 5 across the portfolio. ' +
        'Roof and exterior trim are the highest-priority items for the next 12 months.',
    }),
  });
  adapter.register('inspections.condition.components', {
    resolve: async () => ({
      kind: 'table',
      table: {
        headers: ['Component', 'Rating', 'Action'],
        rows: [
          ['Roof', '2.5', 'Replace 2026'],
          ['HVAC', '3.5', 'Service 2026'],
          ['Lifts', '4.0', 'Service 2027'],
        ],
      },
    }),
  });
  adapter.register('inspections.capex_forecast', {
    resolve: async () => ({
      kind: 'chart',
      chart: {
        title: '5-Year Capex Forecast',
        spec: { mark: 'bar', encoding: { x: 'year', y: 'capex' } },
      },
    }),
  });
  adapter.register('strategy.context', {
    resolve: async () => ({
      kind: 'narrative',
      narrative:
        'Q3 follows a strong Q2; the focus is on consolidating gains while building ' +
        'capacity for two new acquisitions in early Q4.',
    }),
  });
  adapter.register('kpi.snapshot', {
    resolve: async () => ({
      kind: 'kpi_grid',
      kpi_grid: {
        metrics: [
          { label: 'Occupancy', value: '93.4%', delta: '+1.2pp' },
          { label: 'NOI', value: '78.2k', delta: '+4.1%' },
          { label: 'Collections', value: '96.7%', delta: '+0.5pp' },
        ],
      },
    }),
  });
  adapter.register('strategy.priorities', {
    resolve: async () => ({
      kind: 'narrative',
      narrative:
        'Top three: complete refurbishments at Mwanza and Dar; close on the Mbeya acquisition; ' +
        'roll out the new tenant onboarding flow.',
    }),
  });
  adapter.register('strategy.financial_plan', {
    resolve: async () => ({
      kind: 'table',
      table: {
        headers: ['Line', 'Q3 Plan', 'Q3 Actual', 'Var'],
        rows: [
          ['Revenue', 320000, 326400, '+2.0%'],
          ['Op-Ex', 195000, 199500, '+2.3%'],
          ['NOI', 125000, 126900, '+1.5%'],
        ],
      },
    }),
  });
  adapter.register('strategy.risks', {
    resolve: async () => ({
      kind: 'table',
      table: {
        headers: ['Risk', 'Likelihood', 'Impact', 'Mitigation'],
        rows: [
          ['FX volatility', 'M', 'M', 'Hedge 50% of USD flow'],
          ['Refurb delay', 'H', 'M', 'Penalty clauses'],
          ['Tenant churn', 'L', 'H', 'Retention program'],
        ],
      },
    }),
  });
  adapter.register('board.agenda', {
    resolve: async () => ({
      kind: 'narrative',
      narrative:
        '1. Approve minutes. 2. Financial review. 3. Operations update. 4. Compliance & risk. ' +
        '5. Strategy session. 6. Resolutions.',
    }),
  });
  adapter.register('payments-ledger.statements.summary', {
    resolve: async () => ({
      kind: 'table',
      table: {
        headers: ['Period', 'Revenue', 'Op-Ex', 'NOI'],
        rows: [
          ['Q1', 305000, 188000, 117000],
          ['Q2', 318000, 192000, 126000],
          ['Q3', 326400, 199500, 126900],
        ],
      },
    }),
  });
  adapter.register('operations.summary', {
    resolve: async () => ({
      kind: 'narrative',
      narrative:
        'Maintenance backlog cleared to 12 open tickets, the lowest in 18 months. ' +
        'Average ticket resolution is now 36 hours.',
    }),
  });
  adapter.register('compliance.summary', {
    resolve: async () => ({
      kind: 'table',
      table: {
        headers: ['Item', 'Status', 'Due'],
        rows: [
          ['Fire safety audit', 'Passed', '—'],
          ['Annual tax filing', 'In progress', '2026-06-30'],
          ['Building permit renewal', 'Pending', '2026-09-15'],
        ],
      },
    }),
  });
  adapter.register('board.resolutions', {
    resolve: async () => ({
      kind: 'narrative',
      narrative:
        'Proposed: approve Q3 financials; approve Mbeya acquisition; appoint new compliance officer.',
    }),
  });
  adapter.register('customer.statement.header', {
    resolve: async () => ({
      kind: 'narrative',
      narrative: 'Customer statement covering the period 2026-04-01 to 2026-04-30.',
    }),
  });
  adapter.register('customer.statement.transactions', {
    resolve: async () => ({
      kind: 'table',
      table: {
        headers: ['Date', 'Reference', 'Description', 'Amount'],
        rows: [
          ['2026-04-01', 'INV-001', 'Monthly rent', 1500],
          ['2026-04-05', 'PMT-001', 'Payment received', -1500],
          ['2026-04-15', 'INV-002', 'Service charge', 180],
        ],
      },
    }),
  });
  adapter.register('customer.statement.closing', {
    resolve: async () => ({
      kind: 'narrative',
      narrative: 'Closing balance owed: 180.',
    }),
  });

  return adapter;
}
