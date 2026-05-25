/**
 * platform.create_tenant — provision a new tenant (+ owner user + default
 * plan).
 *
 * Risk tier: mutate.
 *
 * Rollback: deletes the freshly created tenant + owner user. Because
 * the tool is composed of TWO writes (tenant row + owner-user row),
 * the rollback fans out to both. The tenant service is expected to
 * be transactional so the rollback either succeeds fully or the
 * compensation is idempotent on retry.
 *
 * No four-eye approval — admin can directly create tenants. Every call
 * lands in the deterministic tool audit trail.
 */

import { z } from 'zod';
import {
  type HqToolContext,
  type HqToolExecutionResult,
  type HqToolSpec,
  callerHasAnyScope,
} from '../../risk-tier.js';
import { refusal, withHqTelemetry } from './shared.js';

export const CreateTenantInputSchema = z.object({
  slug: z
    .string()
    .min(2)
    .max(48)
    .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, 'slug must be kebab-case alphanumeric'),
  name: z.string().min(1).max(120),
  ownerEmail: z.string().email().max(254),
  plan: z.enum(['starter', 'pro', 'enterprise']).optional(),
});

export const CreateTenantOutputSchema = z.object({
  tenantId: z.string(),
  slug: z.string(),
  name: z.string(),
  plan: z.enum(['starter', 'pro', 'enterprise']),
  ownerUserId: z.string(),
  ownerEmail: z.string().email(),
  createdAt: z.string(),
});

export type CreateTenantInput = z.infer<typeof CreateTenantInputSchema>;
export type CreateTenantOutput = z.infer<typeof CreateTenantOutputSchema>;

export interface CreateTenantPort {
  provisionTenant(args: {
    readonly slug: string;
    readonly name: string;
    readonly ownerEmail: string;
    readonly plan: 'starter' | 'pro' | 'enterprise';
  }): Promise<CreateTenantOutput>;
  rollbackTenantProvision(args: {
    readonly tenantId: string;
    readonly ownerUserId: string;
  }): Promise<void>;
  slugExists(slug: string): Promise<boolean>;
}

export interface CreateTenantDeps {
  readonly tenantsService: CreateTenantPort;
}

const REQUIRED_SCOPES: ReadonlyArray<string> = ['platform:tenants:write'];

export function createCreateTenantTool(
  deps: CreateTenantDeps,
): HqToolSpec<CreateTenantInput, CreateTenantOutput> {
  return {
    name: 'platform.create_tenant',
    riskTier: 'mutate',
    description:
      'Provision a new tenant with an owner user on the chosen plan (default: starter). Reversible via rollback.',
    inputSchema: CreateTenantInputSchema,
    outputSchema: CreateTenantOutputSchema,
    requiredScopes: REQUIRED_SCOPES,
    approvalRequired: false,
    rollback: async (output, _ctx) => {
      await deps.tenantsService.rollbackTenantProvision({
        tenantId: output.tenantId,
        ownerUserId: output.ownerUserId,
      });
    },
    async execute(
      input: CreateTenantInput,
      ctx: HqToolContext,
    ): Promise<HqToolExecutionResult<CreateTenantOutput>> {
      return withHqTelemetry({
        toolName: 'platform.create_tenant',
        riskTier: 'mutate',
        approvalRequired: false,
        costEstimateUsd: null,
        tenantId: null,
        ctx,
        input,
        body: async () => {
          if (!callerHasAnyScope(ctx.caller, REQUIRED_SCOPES)) {
            return refusal(
              'OUT_OF_SCOPE',
              'caller lacks platform:tenants:write scope',
            );
          }
          const slugTaken = await deps.tenantsService.slugExists(input.slug);
          if (slugTaken) {
            return refusal(
              'ALREADY_APPLIED',
              `tenant slug "${input.slug}" is already in use`,
            );
          }
          const created = await deps.tenantsService.provisionTenant({
            slug: input.slug,
            name: input.name,
            ownerEmail: input.ownerEmail,
            plan: input.plan ?? 'starter',
          });
          return { kind: 'ok', output: created };
        },
      });
    },
  };
}
