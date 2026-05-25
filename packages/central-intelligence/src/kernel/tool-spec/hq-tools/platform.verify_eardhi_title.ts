/**
 * platform.verify_eardhi_title — verify a TZ title-deed against the
 * Ministry of Lands e-Ardhi gateway.
 *
 * Risk tier: `read`. The e-Ardhi endpoint is a server-to-server query;
 * no mutation, no end-user message. We expose tenant-reachability and
 * scope-gating but skip the four-eye gate so onboarding flows stay
 * fast.
 *
 * Required scopes:
 *   - platform:property:verify — minimum to call any property-records
 *     verification tool
 *   - tenant-reachability
 *
 * Domain note: the tool returns the raw `valid` flag + owner name +
 * encumbrances. The caller (onboarding workflow) decides what to do
 * with an encumbered title — e.g. block a listing if a court-order
 * encumbrance is present.
 */

import { z } from 'zod';
import {
  type HqToolContext,
  type HqToolExecutionResult,
  type HqToolSpec,
  callerCanReachTenant,
  callerHasAllScopes,
} from '../../risk-tier.js';
import { refusal, withHqTelemetry } from './shared.js';

// ─────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────

const TitleNumberSchema = z
  .string()
  .regex(
    /^[A-Z]{3}\/[0-9]{4}\/[0-9]{6}$/,
    'titleNumber must match the e-Ardhi format AAA/0000/000000',
  );

export const EncumbranceKindSchema = z.enum([
  'mortgage',
  'caveat',
  'lease',
  'court-order',
  'other',
]);

const EncumbranceOutputSchema = z.object({
  kind: EncumbranceKindSchema,
  noteRef: z.string(),
  registeredAt: z.string(),
  notes: z.string().optional(),
});

export const VerifyEardhiTitleInputSchema = z.object({
  tenantId: z.string().min(1).max(64),
  titleNumber: TitleNumberSchema,
});

export const VerifyEardhiTitleOutputSchema = z.object({
  tenantId: z.string(),
  titleNumber: z.string(),
  valid: z.boolean(),
  owner_name: z.string(),
  registered_at: z.string(),
  encumbrances: z.array(EncumbranceOutputSchema),
  verifiedAt: z.string(),
});

export type VerifyEardhiTitleInput = z.infer<typeof VerifyEardhiTitleInputSchema>;
export type VerifyEardhiTitleOutput = z.infer<typeof VerifyEardhiTitleOutputSchema>;

// ─────────────────────────────────────────────────────────────────────
// Port
// ─────────────────────────────────────────────────────────────────────

export interface EardhiTitlePort {
  verifyTitle(args: { readonly titleNumber: string }): Promise<
    | {
        readonly kind: 'ok';
        readonly valid: boolean;
        readonly owner_name: string;
        readonly registered_at: string;
        readonly encumbrances: ReadonlyArray<{
          readonly kind: 'mortgage' | 'caveat' | 'lease' | 'court-order' | 'other';
          readonly noteRef: string;
          readonly registeredAt: string;
          readonly notes?: string;
        }>;
      }
    | { readonly kind: 'not-found' }
    | { readonly kind: 'gateway-error'; readonly message: string }
  >;
}

export interface VerifyEardhiTitleDeps {
  readonly eardhi: EardhiTitlePort;
}

const REQUIRED_SCOPES: ReadonlyArray<string> = ['platform:property:verify'];

export function createVerifyEardhiTitleTool(
  deps: VerifyEardhiTitleDeps,
): HqToolSpec<VerifyEardhiTitleInput, VerifyEardhiTitleOutput> {
  return {
    name: 'platform.verify_eardhi_title',
    riskTier: 'read',
    description:
      'Verify a TZ title-deed against the e-Ardhi gateway. READ tier; no approval. Returns owner / registration / encumbrances.',
    inputSchema: VerifyEardhiTitleInputSchema,
    outputSchema: VerifyEardhiTitleOutputSchema,
    requiredScopes: REQUIRED_SCOPES,
    approvalRequired: false,
    async execute(
      input: VerifyEardhiTitleInput,
      ctx: HqToolContext,
    ): Promise<HqToolExecutionResult<VerifyEardhiTitleOutput>> {
      return withHqTelemetry({
        toolName: 'platform.verify_eardhi_title',
        riskTier: 'read',
        approvalRequired: false,
        costEstimateUsd: null,
        tenantId: input.tenantId,
        ctx,
        input,
        body: async () => {
          if (!callerHasAllScopes(ctx.caller, REQUIRED_SCOPES)) {
            return refusal(
              'OUT_OF_SCOPE',
              'caller lacks platform:property:verify scope',
            );
          }
          if (!callerCanReachTenant(ctx.caller, input.tenantId)) {
            return refusal(
              'OUT_OF_SCOPE',
              `caller cannot reach tenant ${input.tenantId}`,
            );
          }
          let result:
            | {
                readonly kind: 'ok';
                readonly valid: boolean;
                readonly owner_name: string;
                readonly registered_at: string;
                readonly encumbrances: ReadonlyArray<{
                  readonly kind:
                    | 'mortgage'
                    | 'caveat'
                    | 'lease'
                    | 'court-order'
                    | 'other';
                  readonly noteRef: string;
                  readonly registeredAt: string;
                  readonly notes?: string;
                }>;
              }
            | { readonly kind: 'not-found' }
            | { readonly kind: 'gateway-error'; readonly message: string };
          try {
            result = await deps.eardhi.verifyTitle({
              titleNumber: input.titleNumber,
            });
          } catch (err) {
            return {
              kind: 'failed',
              message:
                err instanceof Error
                  ? `eardhi-port-failed: ${err.message}`
                  : 'eardhi-port-failed: unknown error',
            };
          }
          if (result.kind === 'gateway-error') {
            return { kind: 'failed', message: `eardhi-gateway: ${result.message}` };
          }
          if (result.kind === 'not-found') {
            return {
              kind: 'ok',
              output: {
                tenantId: input.tenantId,
                titleNumber: input.titleNumber,
                valid: false,
                owner_name: '',
                registered_at: '',
                encumbrances: [],
                verifiedAt: ctx.clock().toISOString(),
              },
            };
          }
          return {
            kind: 'ok',
            output: {
              tenantId: input.tenantId,
              titleNumber: input.titleNumber,
              valid: result.valid,
              owner_name: result.owner_name,
              registered_at: result.registered_at,
              encumbrances: result.encumbrances.map((e) => ({
                kind: e.kind,
                noteRef: e.noteRef,
                registeredAt: e.registeredAt,
                ...(e.notes !== undefined ? { notes: e.notes } : {}),
              })),
              verifiedAt: ctx.clock().toISOString(),
            },
          };
        },
      });
    },
  };
}
