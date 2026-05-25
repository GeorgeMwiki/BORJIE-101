/**
 * Invoice rollup from per-call AaaS metrics into a per-tenant period
 * invoice. Handles all three pricing models including subscription
 * overage.
 */

import type {
  AaaSCallMetric,
  AaaSEndpoint,
  Invoice,
  InvoiceLine,
} from '../types.js';

export interface AgentInvoiceForPeriodArgs {
  readonly tenantId: string;
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly metrics: ReadonlyArray<AaaSCallMetric>;
  readonly endpoints: ReadonlyArray<AaaSEndpoint>;
  readonly taxRatePct?: number;
  readonly now?: () => Date;
}

export function agentInvoiceForPeriod(
  args: AgentInvoiceForPeriodArgs,
): Invoice {
  const now = (args.now ?? (() => new Date()))();
  const lines: InvoiceLine[] = [];

  const endpointsById = new Map(args.endpoints.map((e) => [e.endpointId, e]));
  const metricsByEndpoint = new Map<string, AaaSCallMetric[]>();

  // Filter to this tenant + period
  const inPeriod = args.metrics.filter((m) => {
    if (m.tenantId !== args.tenantId) return false;
    const t = new Date(m.capturedAt).getTime();
    return (
      t >= args.periodStart.getTime() && t < args.periodEnd.getTime()
    );
  });

  for (const m of inPeriod) {
    const list = metricsByEndpoint.get(m.endpointId) ?? [];
    list.push(m);
    metricsByEndpoint.set(m.endpointId, list);
  }

  for (const [endpointId, ms] of metricsByEndpoint.entries()) {
    const endpoint = endpointsById.get(endpointId);
    if (!endpoint) continue;
    const line = makeLine(endpoint, ms);
    if (line) lines.push(line);
  }

  // Subscription endpoints with no calls still incur the monthly base
  for (const endpoint of args.endpoints) {
    if (
      endpoint.pricing.model === 'per_subscription' &&
      !metricsByEndpoint.has(endpoint.endpointId)
    ) {
      lines.push({
        endpointId: endpoint.endpointId,
        agentId: endpoint.agentId,
        description: `Monthly subscription (no usage)`,
        units: 0,
        unitPriceUsdCents: endpoint.pricing.monthlyUsdCents ?? 0,
        subtotalUsdCents: endpoint.pricing.monthlyUsdCents ?? 0,
      });
    }
  }

  const subtotal = lines.reduce(
    (acc, l) => acc + l.subtotalUsdCents,
    0,
  );
  const taxRate = args.taxRatePct ?? 0;
  const tax = Math.round(subtotal * (taxRate / 100));
  const total = subtotal + tax;

  return {
    invoiceId: `inv-${args.tenantId}-${args.periodStart.getTime()}`,
    tenantId: args.tenantId,
    periodStart: args.periodStart.toISOString(),
    periodEnd: args.periodEnd.toISOString(),
    lineItems: lines,
    subtotalUsdCents: subtotal,
    taxUsdCents: tax,
    totalUsdCents: total,
    currency: 'USD',
    generatedAt: now.toISOString(),
  };
}

function makeLine(
  endpoint: AaaSEndpoint,
  metrics: ReadonlyArray<AaaSCallMetric>,
): InvoiceLine | null {
  switch (endpoint.pricing.model) {
    case 'per_call': {
      const units = metrics.reduce((a, m) => a + m.units, 0);
      const subtotal = metrics.reduce((a, m) => a + m.costUsdCents, 0);
      return {
        endpointId: endpoint.endpointId,
        agentId: endpoint.agentId,
        description: `Per-call usage (${metrics.length} calls)`,
        units,
        unitPriceUsdCents: endpoint.pricing.unitPriceUsdCents,
        subtotalUsdCents: subtotal,
      };
    }
    case 'per_outcome': {
      const units = metrics.reduce((a, m) => a + m.units, 0);
      const subtotal = metrics.reduce((a, m) => a + m.costUsdCents, 0);
      return {
        endpointId: endpoint.endpointId,
        agentId: endpoint.agentId,
        description: `Per-outcome usage (${metrics.length} resolutions)`,
        units,
        unitPriceUsdCents: endpoint.pricing.unitPriceUsdCents,
        subtotalUsdCents: subtotal,
      };
    }
    case 'per_subscription': {
      const monthly = endpoint.pricing.monthlyUsdCents ?? 0;
      const includedUnits = endpoint.pricing.includedUnits ?? 0;
      const overageUnitPrice =
        endpoint.pricing.overageUnitPriceUsdCents ?? 0;
      const totalUnits = metrics.reduce((a, m) => a + m.units, 0);
      const overageUnits = Math.max(0, totalUnits - includedUnits);
      const overageCost = overageUnits * overageUnitPrice;
      const subtotal = monthly + overageCost;
      const overageDesc =
        overageUnits > 0
          ? ` + ${overageUnits} overage units @ ${overageUnitPrice}c`
          : '';
      return {
        endpointId: endpoint.endpointId,
        agentId: endpoint.agentId,
        description: `Subscription monthly base${overageDesc}`,
        units: totalUnits,
        unitPriceUsdCents: monthly,
        subtotalUsdCents: subtotal,
      };
    }
  }
}
