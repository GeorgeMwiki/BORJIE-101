/**
 * owner.financial_summary — KPI grid + monthly cashflow series for the
 * caller's portfolio over a rolling window.
 *
 * Risk tier: read.
 *
 * The output is shaped so the gateway can emit two render-block
 * UiParts in sequence (kpi-grid + chart-vega) without any post-
 * processing — the brain returns the structured payload and the
 * gateway's render-block translator does the AG-UI wrapping.
 */

import { z } from 'zod';
import type {
  HqToolContext,
  HqToolExecutionResult,
} from '../../risk-tier.js';
import { ownerCanReachTenant, ownerRefusal, withOwnerTelemetry } from './shared.js';
import type { OwnerToolSpec } from './types.js';

/**
 * ISO-4217 currency code — any 3 upper-case letters. The default is
 * resolved per-tenant via the optional `currencyResolver` port (see
 * `FinancialSummaryDeps`); we accept any well-formed code at this
 * boundary so a new compliance plugin doesn't have to touch the
 * owner-tool contract.
 */
const CurrencyCodeSchema = z
  .string()
  .regex(/^[A-Z]{3}$/, 'ISO-4217 currency code (3 upper-case letters)');

export const FinancialSummaryInputSchema = z.object({
  tenantId: z.string().min(1).max(64),
  windowMonths: z.number().int().min(1).max(24).optional(),
  currency: CurrencyCodeSchema.optional(),
});

export const FinancialSummaryOutputSchema = z.object({
  windowMonths: z.number().int().min(1).max(24),
  currency: CurrencyCodeSchema,
  totalCollectedMinorUnits: z.number().int().nonnegative(),
  totalBilledMinorUnits: z.number().int().nonnegative(),
  collectionRate: z.number().min(0).max(1),
  outstandingMinorUnits: z.number().int().nonnegative(),
  monthly: z.array(
    z.object({
      month: z.string(), // YYYY-MM
      collectedMinorUnits: z.number().int().nonnegative(),
      billedMinorUnits: z.number().int().nonnegative(),
    }),
  ),
});

export type FinancialSummaryInput = z.infer<typeof FinancialSummaryInputSchema>;
export type FinancialSummaryOutput = z.infer<typeof FinancialSummaryOutputSchema>;

export interface FinancialSummaryServicePort {
  summariseFinancials(args: {
    readonly tenantId: string;
    readonly windowMonths: number;
    readonly currency: string; // ISO-4217
  }): Promise<FinancialSummaryOutput>;
}

/**
 * Resolves the display currency for a tenant — wraps the
 * `currency_preferences` service. The composition root supplies the
 * implementation; tests may omit it (legacy `'KES'` literal fallback
 * preserved for back-compat).
 */
export interface OwnerCurrencyResolverPort {
  resolveForTenant(tenantId: string): Promise<string>;
}

export interface FinancialSummaryDeps {
  readonly financials: FinancialSummaryServicePort;
  readonly currencyResolver?: OwnerCurrencyResolverPort;
}

const REQUIRED_SCOPES: ReadonlyArray<string> = ['owner:financials:read'];

export function createFinancialSummaryTool(
  deps: FinancialSummaryDeps,
): OwnerToolSpec<FinancialSummaryInput, FinancialSummaryOutput> {
  return {
    name: 'owner.financial_summary',
    riskTier: 'read',
    description:
      'KPI grid + monthly cashflow series for the caller-owned tenant over a rolling window (default 12 months). Returns collected / billed / outstanding totals plus per-month series.',
    inputSchema: FinancialSummaryInputSchema,
    outputSchema: FinancialSummaryOutputSchema,
    requiredScopes: REQUIRED_SCOPES,
    approvalRequired: false,
    async execute(
      input: FinancialSummaryInput,
      ctx: HqToolContext,
    ): Promise<HqToolExecutionResult<FinancialSummaryOutput>> {
      return withOwnerTelemetry({
        toolName: 'owner.financial_summary',
        riskTier: 'read',
        tenantId: input.tenantId,
        ctx,
        input,
        body: async () => {
          if (!ownerCanReachTenant(ctx.caller.scopes, input.tenantId)) {
            return ownerRefusal(
              'OUT_OF_SCOPE',
              `caller cannot read financials for tenant ${input.tenantId}`,
            );
          }
          const resolvedCurrency =
            input.currency ??
            (deps.currencyResolver
              ? await deps.currencyResolver.resolveForTenant(input.tenantId)
              : 'KES');
          const out = await deps.financials.summariseFinancials({
            tenantId: input.tenantId,
            windowMonths: input.windowMonths ?? 12,
            currency: resolvedCurrency,
          });
          return { kind: 'ok', output: out };
        },
      });
    },
  };
}
