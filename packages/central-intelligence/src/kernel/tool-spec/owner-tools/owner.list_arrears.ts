/**
 * owner.list_arrears — list of tenants currently in arrears for the
 * caller's properties, with days overdue + amount due.
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
 * ISO-4217 currency code — any 3 upper-case letters. The arrears
 * service resolves the per-row currency from the underlying ledger;
 * we accept any well-formed code at this boundary so a new compliance
 * plugin doesn't have to touch the owner-tool contract.
 */
const CurrencyCodeSchema = z
  .string()
  .regex(/^[A-Z]{3}$/, 'ISO-4217 currency code (3 upper-case letters)');

export const ListArrearsInputSchema = z.object({
  tenantId: z.string().min(1).max(64),
  minDaysOverdue: z.number().int().min(0).max(365).optional(),
  limit: z.number().int().min(1).max(200).optional(),
});

export const ListArrearsRowSchema = z.object({
  unitId: z.string(),
  unitLabel: z.string(),
  tenantName: z.string(),
  daysOverdue: z.number().int().nonnegative(),
  amountDueMinorUnits: z.number().int().nonnegative(),
  currency: CurrencyCodeSchema,
  lastPaymentAt: z.string().nullable(),
});

export const ListArrearsOutputSchema = z.object({
  rows: z.array(ListArrearsRowSchema),
  totalReturned: z.number().int().nonnegative(),
  totalAmountMinorUnits: z.number().int().nonnegative(),
  currency: CurrencyCodeSchema,
});

export type ListArrearsInput = z.infer<typeof ListArrearsInputSchema>;
export type ListArrearsOutput = z.infer<typeof ListArrearsOutputSchema>;
export type ListArrearsRow = z.infer<typeof ListArrearsRowSchema>;

export interface ArrearsServicePort {
  listArrears(args: {
    readonly tenantId: string;
    readonly minDaysOverdue: number;
    readonly limit: number;
  }): Promise<ListArrearsOutput>;
}

export interface ListArrearsDeps {
  readonly arrears: ArrearsServicePort;
}

const REQUIRED_SCOPES: ReadonlyArray<string> = ['owner:arrears:read'];

export function createListArrearsTool(
  deps: ListArrearsDeps,
): OwnerToolSpec<ListArrearsInput, ListArrearsOutput> {
  return {
    name: 'owner.list_arrears',
    riskTier: 'read',
    description:
      'List tenants currently in arrears for the caller-owned tenant. Returns unit, days overdue, amount due, and last payment timestamp. Tenant-scoped; never crosses owners.',
    inputSchema: ListArrearsInputSchema,
    outputSchema: ListArrearsOutputSchema,
    requiredScopes: REQUIRED_SCOPES,
    approvalRequired: false,
    async execute(
      input: ListArrearsInput,
      ctx: HqToolContext,
    ): Promise<HqToolExecutionResult<ListArrearsOutput>> {
      return withOwnerTelemetry({
        toolName: 'owner.list_arrears',
        riskTier: 'read',
        tenantId: input.tenantId,
        ctx,
        input,
        body: async () => {
          if (!ownerCanReachTenant(ctx.caller.scopes, input.tenantId)) {
            return ownerRefusal(
              'OUT_OF_SCOPE',
              `caller cannot read arrears for tenant ${input.tenantId}`,
            );
          }
          const raw = await deps.arrears.listArrears({
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
