/**
 * platform.create_user — add a user to an existing tenant.
 *
 * Risk tier: mutate.
 *
 * Rollback: deactivates the user. We deliberately avoid hard-delete on
 * compensation because the audit trail must survive — the user row is
 * marked `deactivated` and any pending invite is revoked.
 */

import { z } from 'zod';
import {
  type HqToolContext,
  type HqToolExecutionResult,
  type HqToolSpec,
  callerCanReachTenant,
  callerHasAnyScope,
} from '../../risk-tier.js';
import { UserRoleSchema } from './platform.list_users.js';
import { refusal, withHqTelemetry } from './shared.js';

export const CreateUserInputSchema = z.object({
  tenantId: z.string().min(1).max(64),
  email: z.string().email().max(254),
  role: UserRoleSchema,
  sendInvite: z.boolean().optional(),
  displayName: z.string().min(1).max(120).optional(),
});

export const CreateUserOutputSchema = z.object({
  userId: z.string(),
  tenantId: z.string(),
  email: z.string().email(),
  role: UserRoleSchema,
  status: z.enum(['active', 'invited']),
  invitedAt: z.string().nullable(),
  createdAt: z.string(),
});

export type CreateUserInput = z.infer<typeof CreateUserInputSchema>;
export type CreateUserOutput = z.infer<typeof CreateUserOutputSchema>;

export interface CreateUserPort {
  tenantExists(tenantId: string): Promise<boolean>;
  emailExistsOnTenant(args: {
    readonly tenantId: string;
    readonly email: string;
  }): Promise<boolean>;
  createUser(args: {
    readonly tenantId: string;
    readonly email: string;
    readonly role: z.infer<typeof UserRoleSchema>;
    readonly sendInvite: boolean;
    readonly displayName: string | null;
  }): Promise<CreateUserOutput>;
  deactivateUser(userId: string): Promise<void>;
}

export interface CreateUserDeps {
  readonly usersService: CreateUserPort;
}

const REQUIRED_SCOPES: ReadonlyArray<string> = ['platform:users:write'];

export function createCreateUserTool(
  deps: CreateUserDeps,
): HqToolSpec<CreateUserInput, CreateUserOutput> {
  return {
    name: 'platform.create_user',
    riskTier: 'mutate',
    description:
      'Add a user to an existing tenant with a chosen role; optionally sends an invite email. Reversible via rollback (deactivates the created user).',
    inputSchema: CreateUserInputSchema,
    outputSchema: CreateUserOutputSchema,
    requiredScopes: REQUIRED_SCOPES,
    approvalRequired: false,
    rollback: async (output, _ctx) => {
      await deps.usersService.deactivateUser(output.userId);
    },
    async execute(
      input: CreateUserInput,
      ctx: HqToolContext,
    ): Promise<HqToolExecutionResult<CreateUserOutput>> {
      return withHqTelemetry({
        toolName: 'platform.create_user',
        riskTier: 'mutate',
        approvalRequired: false,
        costEstimateUsd: null,
        tenantId: input.tenantId,
        ctx,
        input,
        body: async () => {
          if (!callerHasAnyScope(ctx.caller, REQUIRED_SCOPES)) {
            return refusal(
              'OUT_OF_SCOPE',
              'caller lacks platform:users:write scope',
            );
          }
          if (!callerCanReachTenant(ctx.caller, input.tenantId)) {
            return refusal(
              'OUT_OF_SCOPE',
              `caller cannot reach tenant ${input.tenantId}`,
            );
          }
          if (!(await deps.usersService.tenantExists(input.tenantId))) {
            return refusal(
              'TENANT_NOT_FOUND',
              `tenant ${input.tenantId} does not exist`,
            );
          }
          if (
            await deps.usersService.emailExistsOnTenant({
              tenantId: input.tenantId,
              email: input.email,
            })
          ) {
            return refusal(
              'ALREADY_APPLIED',
              `user with email ${input.email} already exists on tenant ${input.tenantId}`,
            );
          }
          const created = await deps.usersService.createUser({
            tenantId: input.tenantId,
            email: input.email,
            role: input.role,
            sendInvite: input.sendInvite ?? true,
            displayName: input.displayName ?? null,
          });
          return { kind: 'ok', output: created };
        },
      });
    },
  };
}
