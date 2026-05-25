/**
 * platform.list_users — paginated list of users across tenants.
 *
 * Risk tier: read.
 *
 * Identity-scoped: a tenant-scoped admin only sees users on their own
 * tenants; a platform admin sees all. When `tenantId` is supplied, the
 * tool refuses if the caller cannot reach that tenant.
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

export const UserRoleSchema = z.enum([
  'tenant_resident',
  'owner',
  'manager',
  'org_admin',
  'platform_admin',
  'support',
]);

export const ListUsersInputSchema = z.object({
  tenantId: z.string().min(1).max(64).optional(),
  role: UserRoleSchema.optional(),
  limit: z.number().int().min(1).max(100).optional(),
  cursor: z.string().min(1).max(200).optional(),
});

export const ListUsersOutputSchema = z.object({
  rows: z.array(
    z.object({
      userId: z.string(),
      tenantId: z.string().nullable(),
      email: z.string().email(),
      role: UserRoleSchema,
      status: z.enum(['active', 'invited', 'suspended', 'deactivated']),
      lastLoginAt: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
  nextCursor: z.string().nullable(),
  totalReturned: z.number().int().nonnegative(),
});

export type ListUsersInput = z.infer<typeof ListUsersInputSchema>;
export type ListUsersOutput = z.infer<typeof ListUsersOutputSchema>;

export interface UsersServicePort {
  listUsers(args: {
    readonly tenantId: string | null;
    readonly role: z.infer<typeof UserRoleSchema> | null;
    readonly limit: number;
    readonly cursor: string | null;
  }): Promise<ListUsersOutput>;
}

export interface ListUsersDeps {
  readonly usersService: UsersServicePort;
}

const REQUIRED_SCOPES: ReadonlyArray<string> = ['platform:users:read'];

export function createListUsersTool(deps: ListUsersDeps): HqToolSpec<
  ListUsersInput,
  ListUsersOutput
> {
  return {
    name: 'platform.list_users',
    riskTier: 'read',
    description:
      'Paginated list of users. Optional tenant + role filter. Identity-scoped — caller only sees users on tenants their scopes reach.',
    inputSchema: ListUsersInputSchema,
    outputSchema: ListUsersOutputSchema,
    requiredScopes: REQUIRED_SCOPES,
    approvalRequired: false,
    async execute(
      input: ListUsersInput,
      ctx: HqToolContext,
    ): Promise<HqToolExecutionResult<ListUsersOutput>> {
      return withHqTelemetry({
        toolName: 'platform.list_users',
        riskTier: 'read',
        approvalRequired: false,
        costEstimateUsd: null,
        tenantId: input.tenantId ?? null,
        ctx,
        input,
        body: async () => {
          if (!callerHasAnyScope(ctx.caller, REQUIRED_SCOPES)) {
            return refusal('OUT_OF_SCOPE', 'caller lacks platform:users:read scope');
          }
          if (input.tenantId && !callerCanReachTenant(ctx.caller, input.tenantId)) {
            return refusal(
              'OUT_OF_SCOPE',
              `caller cannot reach tenant ${input.tenantId}`,
            );
          }
          const raw = await deps.usersService.listUsers({
            tenantId: input.tenantId ?? null,
            role: input.role ?? null,
            limit: input.limit ?? 25,
            cursor: input.cursor ?? null,
          });
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
