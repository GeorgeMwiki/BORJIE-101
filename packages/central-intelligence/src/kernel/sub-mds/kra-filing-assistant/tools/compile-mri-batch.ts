/**
 * `kra.compile_mri_batch` — read tier.
 *
 * Gathers the owner's rental-income records for a period (single
 * owner, never cross-owner) and produces a compiled batch ready
 * for validation. Returns line-by-line entries plus aggregate totals.
 */

export interface RentalIncomeRecord {
  readonly ownerId: string;
  readonly tenantId: string;
  readonly tenantName: string;
  readonly tenantKraPin?: string;
  readonly propertyId: string;
  readonly propertyAddress: string;
  readonly receivedAtMs: number;
  readonly grossRentMinor: number;
  readonly withholdingMinor: number;
  readonly currency: string;
}

export interface CompileMriBatchArgs {
  readonly ownerId: string;
  readonly ownerKraPin: string;
  readonly periodYear: number;
  readonly periodMonth: number;
  readonly records: ReadonlyArray<RentalIncomeRecord>;
}

export interface CompiledMriLine {
  readonly tenantId: string;
  readonly tenantName: string;
  readonly tenantKraPin?: string;
  readonly propertyAddress: string;
  readonly grossRentMinor: number;
  readonly withholdingMinor: number;
  readonly currency: string;
  readonly receivedAtMs: number;
}

export interface CompiledMriBatch {
  readonly ownerId: string;
  readonly ownerKraPin: string;
  readonly period: { readonly year: number; readonly month: number };
  readonly lines: ReadonlyArray<CompiledMriLine>;
  readonly totals: {
    readonly grossRentMinor: number;
    readonly withholdingMinor: number;
    readonly lineCount: number;
    readonly tenantCount: number;
    readonly propertyCount: number;
  };
  readonly outOfScope: ReadonlyArray<{
    readonly recordOwnerId: string;
    readonly reason: 'cross-owner' | 'wrong-period';
  }>;
}

export function compileMriBatch(args: CompileMriBatchArgs): CompiledMriBatch {
  const lines: CompiledMriLine[] = [];
  const outOfScope: { recordOwnerId: string; reason: 'cross-owner' | 'wrong-period' }[] = [];
  const tenants = new Set<string>();
  const props = new Set<string>();
  let totalGross = 0;
  let totalWh = 0;

  const periodStart = Date.UTC(args.periodYear, args.periodMonth - 1, 1);
  const periodEnd = Date.UTC(args.periodYear, args.periodMonth, 1);

  for (const r of args.records) {
    if (r.ownerId !== args.ownerId) {
      outOfScope.push({ recordOwnerId: r.ownerId, reason: 'cross-owner' });
      continue;
    }
    if (r.receivedAtMs < periodStart || r.receivedAtMs >= periodEnd) {
      outOfScope.push({ recordOwnerId: r.ownerId, reason: 'wrong-period' });
      continue;
    }
    const line: CompiledMriLine = {
      tenantId: r.tenantId,
      tenantName: r.tenantName,
      ...(r.tenantKraPin ? { tenantKraPin: r.tenantKraPin } : {}),
      propertyAddress: r.propertyAddress,
      grossRentMinor: r.grossRentMinor,
      withholdingMinor: r.withholdingMinor,
      currency: r.currency,
      receivedAtMs: r.receivedAtMs,
    };
    lines.push(line);
    tenants.add(r.tenantId);
    props.add(r.propertyId);
    totalGross += r.grossRentMinor;
    totalWh += r.withholdingMinor;
  }

  return Object.freeze({
    ownerId: args.ownerId,
    ownerKraPin: args.ownerKraPin,
    period: Object.freeze({ year: args.periodYear, month: args.periodMonth }),
    lines: Object.freeze(lines),
    totals: Object.freeze({
      grossRentMinor: totalGross,
      withholdingMinor: totalWh,
      lineCount: lines.length,
      tenantCount: tenants.size,
      propertyCount: props.size,
    }),
    outOfScope: Object.freeze(outOfScope),
  });
}
