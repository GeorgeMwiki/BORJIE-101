/**
 * platform.verify_nida — verify a TZ citizen via the NIDA biometric
 * gateway.
 *
 * Risk tier: `read`. The NIDA endpoint itself does not mutate; it
 * returns an identity-verification result. We classify as `read` so the
 * call doesn't pay the four-eye approval cost on every onboarding,
 * while still being subject to scope-gating + tenant-reachability.
 *
 * Why "read" and not "external-comm": NIDA does not deliver a message
 * to the end user; it answers a server-to-server query. The call is
 * audited via the standard tool-audit trail (no sovereign-ledger
 * persistence — that surface is reserved for destroy / billing /
 * external-comm).
 *
 * Required scopes:
 *   - platform:kyc:read — minimum to call any KYC verification tool
 *   - tenant-reachability — caller must be able to reach `tenantId`
 *
 * Privacy:
 *   - The biometric hash never leaves the device as a raw template.
 *     The schema-layer regex (`^[a-f0-9]{64}$`) makes a raw template
 *     impossible to submit.
 *   - We deliberately do NOT log the hash to the sovereign-ledger.
 *     The standard tool-audit trail only stores the input HASH (sha256
 *     of the call payload), not the raw biometric.
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

const NidaNumberSchema = z
  .string()
  .regex(
    /^[0-9]{20}$|^[0-9]{8}-[0-9]{4}-[0-9]{6}-[0-9]{2}$/,
    'nidaNumber must be 20 digits (with or without 8-4-6-2 hyphens)',
  );

const BiometricHashSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, 'biometricHash must be SHA-256 hex (64 lowercase hex chars)');

export const VerifyNidaInputSchema = z.object({
  tenantId: z.string().min(1).max(64),
  nidaNumber: NidaNumberSchema,
  biometricHash: BiometricHashSchema,
  /** Onboarding flow that triggered the check — for audit segmentation. */
  purposeCode: z.enum(['tenant-kyc', 'owner-kyc', 'guarantor-kyc']),
});

export const VerifyNidaOutputSchema = z.object({
  tenantId: z.string(),
  verified: z.boolean(),
  /** Empty string when verified is false (no NIDA payload to attach). */
  name: z.string(),
  /** Empty string when verified is false. */
  dob: z.string(),
  photo_match_score: z.number().min(0).max(1),
  verifiedAt: z.string(),
});

export type VerifyNidaInput = z.infer<typeof VerifyNidaInputSchema>;
export type VerifyNidaOutput = z.infer<typeof VerifyNidaOutputSchema>;

// ─────────────────────────────────────────────────────────────────────
// Port
// ─────────────────────────────────────────────────────────────────────

/**
 * Narrow port the tool calls. The composition root binds this to the
 * `createNidaAdapter().verifyIdentity` method with the real auth +
 * fetch. Tests inject a stub directly.
 */
export interface NidaVerificationPort {
  verifyIdentity(args: {
    readonly nidaNumber: string;
    readonly biometricHash: string;
  }): Promise<
    | { readonly kind: 'ok'; readonly verified: boolean; readonly name: string; readonly dob: string; readonly photo_match_score: number }
    | { readonly kind: 'unverified'; readonly reason: string }
    | { readonly kind: 'gateway-error'; readonly message: string }
  >;
}

export interface VerifyNidaDeps {
  readonly nida: NidaVerificationPort;
}

const REQUIRED_SCOPES: ReadonlyArray<string> = ['platform:kyc:read'];

export function createVerifyNidaTool(
  deps: VerifyNidaDeps,
): HqToolSpec<VerifyNidaInput, VerifyNidaOutput> {
  return {
    name: 'platform.verify_nida',
    riskTier: 'read',
    description:
      'Verify a Tanzanian citizen against the NIDA biometric gateway. READ tier; no approval required. Returns verified / name / dob / photo_match_score.',
    inputSchema: VerifyNidaInputSchema,
    outputSchema: VerifyNidaOutputSchema,
    requiredScopes: REQUIRED_SCOPES,
    approvalRequired: false,
    async execute(
      input: VerifyNidaInput,
      ctx: HqToolContext,
    ): Promise<HqToolExecutionResult<VerifyNidaOutput>> {
      return withHqTelemetry({
        toolName: 'platform.verify_nida',
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
              'caller lacks platform:kyc:read scope',
            );
          }
          if (!callerCanReachTenant(ctx.caller, input.tenantId)) {
            return refusal(
              'OUT_OF_SCOPE',
              `caller cannot reach tenant ${input.tenantId}`,
            );
          }
          let result:
            | { readonly kind: 'ok'; readonly verified: boolean; readonly name: string; readonly dob: string; readonly photo_match_score: number }
            | { readonly kind: 'unverified'; readonly reason: string }
            | { readonly kind: 'gateway-error'; readonly message: string };
          try {
            result = await deps.nida.verifyIdentity({
              nidaNumber: input.nidaNumber,
              biometricHash: input.biometricHash,
            });
          } catch (err) {
            return {
              kind: 'failed',
              message:
                err instanceof Error
                  ? `nida-port-failed: ${err.message}`
                  : 'nida-port-failed: unknown error',
            };
          }
          if (result.kind === 'gateway-error') {
            return { kind: 'failed', message: `nida-gateway: ${result.message}` };
          }
          if (result.kind === 'unverified') {
            return {
              kind: 'ok',
              output: {
                tenantId: input.tenantId,
                verified: false,
                name: '',
                dob: '',
                photo_match_score: 0,
                verifiedAt: ctx.clock().toISOString(),
              },
            };
          }
          return {
            kind: 'ok',
            output: {
              tenantId: input.tenantId,
              verified: result.verified,
              name: result.name,
              dob: result.dob,
              photo_match_score: result.photo_match_score,
              verifiedAt: ctx.clock().toISOString(),
            },
          };
        },
      });
    },
  };
}
