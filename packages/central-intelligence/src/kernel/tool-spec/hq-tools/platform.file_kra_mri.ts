/**
 * platform.file_kra_mri — initiate a KRA Monthly Rental Income (MRI)
 * filing Temporal workflow.
 *
 * Risk tier: `external-comm`. A KRA submission reaches an external
 * regulator and carries reputational + legal risk. Four-eye approval +
 * sovereign-ledger persisted.
 *
 * Phase D D10 — extended to also drive the KE eRITS (Electronic Rental
 * Income Tax Submission) batch workflow. Inputs are a discriminated
 * union on `jurisdiction`:
 *   - default / 'TZ' -> existing single-entity MRI flow
 *   - 'KE'           -> new multi-owner eRITS batch flow
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

const KraTaxPeriodMonthSchema = z
  .string()
  .regex(
    /^20\d{2}-(0[1-9]|1[0-2])$/,
    'taxPeriodMonth must be YYYY-MM with year in 2000-2099',
  );

const KraTinSchema = z
  .string()
  .regex(/^[0-9]{9}$|^[0-9]{3}-[0-9]{3}-[0-9]{3}$/, 'entityTin must be a 9-digit KRA TIN');

const KraPinSchema = z
  .string()
  .regex(/^A[0-9]{9}[A-Z]$/, 'kraPin must be 11 chars: A + 9 digits + letter');

const KraReturnPayloadSchema = z.object({
  entityTin: KraTinSchema,
  grossRent: z.number().int().nonnegative(),
  deductibleExpenses: z.number().int().nonnegative(),
  taxableIncome: z.number().int().nonnegative(),
  taxDue: z.number().int().nonnegative(),
});

const KraEritsOwnerRecordSchema = z.object({
  ownerId: z.string().min(1).max(64),
  kraPin: KraPinSchema,
  rentalAmountCents: z.number().int().nonnegative(),
  deductibleCents: z.number().int().nonnegative(),
});

export type KraEritsOwnerRecord = z.infer<typeof KraEritsOwnerRecordSchema>;

const TzMriInputShape = z.object({
  jurisdiction: z.literal('TZ').optional(),
  tenantId: z.string().min(1).max(64),
  taxPeriodMonth: KraTaxPeriodMonthSchema,
  returnPayload: KraReturnPayloadSchema,
  initiatedByUserId: z.string().min(1).max(120),
});

const KeEritsInputShape = z.object({
  jurisdiction: z.literal('KE'),
  tenantId: z.string().min(1).max(64),
  taxPeriodMonth: KraTaxPeriodMonthSchema,
  initiatedByUserId: z.string().min(1).max(120),
  owners: z.array(KraEritsOwnerRecordSchema).min(1).max(5000),
});

export const FileKraMriInputSchema = z.union([TzMriInputShape, KeEritsInputShape]);

export const FileKraMriOutputSchema = z.object({
  tenantId: z.string(),
  taxPeriodMonth: z.string(),
  workflowId: z.string(),
  runId: z.string(),
  status: z.enum(['started']),
  jurisdiction: z.enum(['TZ', 'KE']),
  entityTin: z.string(),
  ownerCount: z.number().int().nonnegative(),
  startedAt: z.string(),
});

export type FileKraMriInput = z.infer<typeof FileKraMriInputSchema>;
export type FileKraMriOutput = z.infer<typeof FileKraMriOutputSchema>;

export interface KraMriFilingWorkflowDispatcherPort {
  start(args: {
    readonly tenantId: string;
    readonly taxPeriodMonth: string;
    readonly returnPayload: z.infer<typeof KraReturnPayloadSchema>;
    readonly initiatedByUserId: string;
  }): Promise<{ workflowId: string; runId: string }>;
  requestRetraction(args: {
    readonly workflowId: string;
    readonly reason: string;
  }): Promise<void>;
}

export interface KraEritsFilingWorkflowDispatcherPort {
  start(args: {
    readonly tenantId: string;
    readonly taxPeriodMonth: string;
    readonly initiatedByUserId: string;
    readonly owners: ReadonlyArray<KraEritsOwnerRecord>;
  }): Promise<{ workflowId: string; runId: string }>;
  requestRetraction(args: {
    readonly workflowId: string;
    readonly reason: string;
  }): Promise<void>;
}

export interface FileKraMriDeps {
  readonly kraMriDispatcher: KraMriFilingWorkflowDispatcherPort;
  readonly kraEritsDispatcher?: KraEritsFilingWorkflowDispatcherPort;
}

const REQUIRED_SCOPES: ReadonlyArray<string> = [
  'platform:kra:write',
  'platform:ops:write',
];

export function createFileKraMriTool(
  deps: FileKraMriDeps,
): HqToolSpec<FileKraMriInput, FileKraMriOutput> {
  return {
    name: 'platform.file_kra_mri',
    riskTier: 'external-comm',
    description:
      'Initiate a KRA Monthly Rental Income filing Temporal workflow. EXTERNAL-COMM tier; four-eye approval. Supports both TZ MRI and KE eRITS (Phase D D10).',
    inputSchema: FileKraMriInputSchema,
    outputSchema: FileKraMriOutputSchema,
    requiredScopes: REQUIRED_SCOPES,
    approvalRequired: true,
    rollback: async (output, _ctx) => {
      if (output.jurisdiction === 'KE' && deps.kraEritsDispatcher) {
        await deps.kraEritsDispatcher.requestRetraction({
          workflowId: output.workflowId,
          reason: `automated retraction of ${output.workflowId}`,
        });
        return;
      }
      await deps.kraMriDispatcher.requestRetraction({
        workflowId: output.workflowId,
        reason: `automated retraction of ${output.workflowId}`,
      });
    },
    async execute(
      input: FileKraMriInput,
      ctx: HqToolContext,
    ): Promise<HqToolExecutionResult<FileKraMriOutput>> {
      return withHqTelemetry({
        toolName: 'platform.file_kra_mri',
        riskTier: 'external-comm',
        approvalRequired: true,
        costEstimateUsd: null,
        tenantId: input.tenantId,
        ctx,
        input,
        body: async () => {
          if (!callerHasAllScopes(ctx.caller, REQUIRED_SCOPES)) {
            return refusal('OUT_OF_SCOPE', 'caller lacks platform:kra:write + platform:ops:write scopes');
          }
          if (!callerCanReachTenant(ctx.caller, input.tenantId)) {
            return refusal('OUT_OF_SCOPE', `caller cannot reach tenant ${input.tenantId}`);
          }
          if ('jurisdiction' in input && input.jurisdiction === 'KE') {
            if (!deps.kraEritsDispatcher) {
              return refusal('NOT_IMPLEMENTED', 'KE eRITS dispatcher not wired into composition root');
            }
            for (const o of input.owners) {
              if (o.deductibleCents > o.rentalAmountCents) {
                return refusal(
                  'INVARIANT_VIOLATION',
                  `owner ${o.ownerId}: deductibleCents (${o.deductibleCents}) exceeds rentalAmountCents (${o.rentalAmountCents})`,
                );
              }
            }
            let started: { workflowId: string; runId: string };
            try {
              started = await deps.kraEritsDispatcher.start({
                tenantId: input.tenantId,
                taxPeriodMonth: input.taxPeriodMonth,
                initiatedByUserId: input.initiatedByUserId,
                owners: input.owners,
              });
            } catch (err) {
              return {
                kind: 'failed',
                message:
                  err instanceof Error
                    ? `kra-erits-dispatcher-failed: ${err.message}`
                    : 'kra-erits-dispatcher-failed: unknown error',
              };
            }
            return {
              kind: 'ok',
              output: {
                tenantId: input.tenantId,
                taxPeriodMonth: input.taxPeriodMonth,
                workflowId: started.workflowId,
                runId: started.runId,
                status: 'started',
                jurisdiction: 'KE',
                entityTin: '',
                ownerCount: input.owners.length,
                startedAt: ctx.clock().toISOString(),
              },
            };
          }
          const expectedTaxable =
            input.returnPayload.grossRent - input.returnPayload.deductibleExpenses;
          if (expectedTaxable !== input.returnPayload.taxableIncome) {
            return refusal(
              'INVARIANT_VIOLATION',
              `taxableIncome ${input.returnPayload.taxableIncome} != grossRent(${input.returnPayload.grossRent}) - deductibleExpenses(${input.returnPayload.deductibleExpenses}) = ${expectedTaxable}`,
            );
          }
          const expectedTax = Math.round(expectedTaxable * 0.10);
          if (Math.abs(input.returnPayload.taxDue - expectedTax) > 1) {
            return refusal(
              'INVARIANT_VIOLATION',
              `taxDue ${input.returnPayload.taxDue} != round(taxableIncome * 0.10) = ${expectedTax}`,
            );
          }
          let started: { workflowId: string; runId: string };
          try {
            started = await deps.kraMriDispatcher.start({
              tenantId: input.tenantId,
              taxPeriodMonth: input.taxPeriodMonth,
              returnPayload: input.returnPayload,
              initiatedByUserId: input.initiatedByUserId,
            });
          } catch (err) {
            return {
              kind: 'failed',
              message:
                err instanceof Error
                  ? `kra-mri-dispatcher-failed: ${err.message}`
                  : 'kra-mri-dispatcher-failed: unknown error',
            };
          }
          return {
            kind: 'ok',
            output: {
              tenantId: input.tenantId,
              taxPeriodMonth: input.taxPeriodMonth,
              workflowId: started.workflowId,
              runId: started.runId,
              status: 'started',
              jurisdiction: 'TZ',
              entityTin: input.returnPayload.entityTin,
              ownerCount: 0,
              startedAt: ctx.clock().toISOString(),
            },
          };
        },
      });
    },
  };
}
