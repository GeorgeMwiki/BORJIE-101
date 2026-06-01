/**
 * owner.list_outstanding — list of operators currently in outstanding
 * royalties for the caller's sites, with days overdue + amount due.
 *
 * Risk tier: read.
 *
 * Tenant-scoped: the executor refuses any call whose `tenantId` is not
 * one the caller's scopes reach. Owner tools NEVER list across tenants.
 */

import { z } from 'zod';
import type {
  HqToolContext,
  HqToolExecutionResult,
} from '../../risk-tier.js';
import { ownerCanReachTenant, ownerRefusal, withOwnerTelemetry } from './shared.js';
import type { OwnerToolSpec } from './types.js';

/**
 * ISO-4217 currency code — any 3 upper-case letters. The outstanding
 * service resolves the per-row currency from the underlying ledger;
 * we accept any well-formed code at this boundary so a new compliance
 * plugin doesn't have to touch the owner-tool contract.
 */
const CurrencyCodeSchema = z
  .string()
  .regex(/^[A-Z]{3}$/, 'ISO-4217 currency code (3 upper-case letters)');

export const ListOutstandingInputSchema = z.object({
  tenantId: z.string().min(1).max(64),
  minDaysOverdue: z.number().int().min(0).max(365).optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

export const ListOutstandingRowSchema = z.object({
  siteId: z.string(),
  siteLabel: z.string(),
  operatorName: z.string(),
  daysOverdue: z.number().int().nonnegative(),
  amountDueMinorUnits: z.number().int().nonnegative(),
  currency: CurrencyCodeSchema,
  lastPaymentAt: z.string().nullable(),
});

export const ListOutstandingOutputSchema = z.object({
  rows: z.array(ListOutstandingRowSchema),
  totalReturned: z.number().int().nonnegative(),
  totalAmountMinorUnits: z.number().int().nonnegative(),
  currency: CurrencyCodeSchema,
});

export type ListOutstandingInput = z.infer<typeof ListOutstandingInputSchema>;
export type ListOutstandingOutput = z.infer<typeof ListOutstandingOutputSchema>;
export type ListOutstandingRow = z.infer<typeof ListOutstandingRowSchema>;

export interface OutstandingServicePort {
  listOutstanding(args: {
    readonly tenantId: string;
    readonly minDaysOverdue: number;
    readonly limit: number;
  }): Promise<ListOutstandingOutput>;
}

export interface ListOutstandingDeps {
  readonly outstanding: OutstandingServicePort;
}

const REQUIRED_SCOPES: ReadonlyArray<string> = ['owner:outstanding:read'];

export function createListOutstandingTool(
  deps: ListOutstandingDeps,
): OwnerToolSpec<ListOutstandingInput, ListOutstandingOutput> {
  return {
    name: 'owner.list_outstanding',
    riskTier: 'read',
    description:
      'List operators currently in outstanding royalties for the caller-owned tenant. Returns site, days overdue, amount due, and last payment timestamp. Tenant-scoped; never crosses owners.',
    inputSchema: ListOutstandingInputSchema,
    outputSchema: ListOutstandingOutputSchema,
    requiredScopes: REQUIRED_SCOPES,
    approvalRequired: false,
    async execute(
      input: ListOutstandingInput,
      ctx: HqToolContext,
    ): Promise<HqToolExecutionResult<ListOutstandingOutput>> {
      return withOwnerTelemetry({
        toolName: 'owner.list_outstanding',
        riskTier: 'read',
        tenantId: input.tenantId,
        ctx,
        input,
        body: async () => {
          if (!ownerCanReachTenant(ctx.caller.scopes, input.tenantId)) {
            return ownerRefusal(
              'OUT_OF_SCOPE',
              `caller cannot read outstanding royalties for tenant ${input.tenantId}`,
            );
          }
          const raw = await deps.outstanding.listOutstanding({
            tenantId: input.tenantId,
            minDaysOverdue: input.minDaysOverdue ?? 1,
            limit: input.limit ?? 50,
          });
          return { kind: 'ok', output: raw };
        },
      });
    },
  };
}
