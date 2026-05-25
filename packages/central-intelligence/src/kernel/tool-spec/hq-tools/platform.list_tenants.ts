/**
 * platform.list_tenants — paginated list of tenants with status, MRR,
 * last-active timestamp.
 *
 * Risk tier: read.
 *
 * Identity-scoped: the executor reduces the page to tenants the caller
 * actually has scope on. A platform-wide admin (`platform:*`) sees all
 * tenants; a tenant-scoped caller sees only their own.
 */

import { z } from 'zod';
import {
  type HqToolContext,
  type HqToolExecutionResult,
  type HqToolSpec,
  callerCanReachTenant,
  callerHasAnyScope,
} from '../../risk-tier.js';
import { refusal, withHqTelemetry } from './shared.js';

export const ListTenantsInputSchema = z.object({
  filter: z.enum(['active', 'churned', 'all']).optional(),
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().min(1).max(200).optional(),
});

export const ListTenantsOutputSchema = z.object({
  rows: z.array(
    z.object({
      tenantId: z.string(),
      slug: z.string(),
      name: z.string(),
      status: z.enum(['active', 'churned', 'pending', 'suspended']),
      mrrUsdCents: z.number().int().nonnegative(),
      lastActiveAt: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
  nextCursor: z.string().nullable(),
  totalReturned: z.number().int().nonnegative(),
});

export type ListTenantsInput = z.infer<typeof ListTenantsInputSchema>;
export type ListTenantsOutput = z.infer<typeof ListTenantsOutputSchema>;

export interface TenantsServicePort {
  listTenants(args: {
    readonly filter: 'active' | 'churned' | 'all';
    readonly limit: number;
    readonly cursor: string | null;
  }): Promise<ListTenantsOutput>;
}

export interface ListTenantsDeps {
  readonly tenantsService: TenantsServicePort;
}

const REQUIRED_SCOPES: ReadonlyArray<string> = ['platform:tenants:read'];

export function createListTenantsTool(deps: ListTenantsDeps): HqToolSpec<
  ListTenantsInput,
  ListTenantsOutput
> {
  return {
    name: 'platform.list_tenants',
    riskTier: 'read',
    description:
      'Paginated list of platform tenants. Returns status, MRR, last-active timestamp. Read-only; identity-scoped — caller only sees tenants their scopes reach.',
    inputSchema: ListTenantsInputSchema,
    outputSchema: ListTenantsOutputSchema,
    requiredScopes: REQUIRED_SCOPES,
    approvalRequired: false,
    async execute(
      input: ListTenantsInput,
      ctx: HqToolContext,
    ): Promise<HqToolExecutionResult<ListTenantsOutput>> {
      return withHqTelemetry({
        toolName: 'platform.list_tenants',
        riskTier: 'read',
        approvalRequired: false,
        costEstimateUsd: null,
        tenantId: null,
        ctx,
        input,
        body: async () => {
          if (!callerHasAnyScope(ctx.caller, REQUIRED_SCOPES)) {
            return refusal(
              'OUT_OF_SCOPE',
              'caller lacks platform:tenants:read scope',
            );
          }
          const raw = await deps.tenantsService.listTenants({
            filter: input.filter ?? 'active',
            limit: input.limit ?? 25,
            cursor: input.cursor ?? null,
          });
          // Identity-scoped filtering — the caller only sees rows
          // whose tenantId their scopes reach. Avoids leaking the
          // existence of out-of-scope tenants.
          const filteredRows = raw.rows.filter((r) =>
            callerCanReachTenant(ctx.caller, r.tenantId),
          );
          return {
            kind: 'ok',
            output: {
              rows: filteredRows,
              nextCursor: raw.nextCursor,
              totalReturned: filteredRows.length,
            },
          };
        },
      });
    },
  };
}
