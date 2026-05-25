/**
 * Financial Profile hooks.
 *
 * Endpoints:
 *   POST /financial-profile/statements                        → submit
 *   POST /financial-profile/statements/:id/bank-ref           → verify bank ref
 *   POST /financial-profile/litigation                        → record litigation
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ApiClientError } from '../client';
import { queryKeys } from './query-keys';
import {
  client,
  defaultMutationRetry,
  type DefaultMutationOptions,
  type TenantScopeArg,
} from './shared';

export type IncomeKind =
  | 'salary'
  | 'self_employment'
  | 'rental'
  | 'investments'
  | 'government'
  | 'other';

export interface IncomeSource {
  readonly kind: IncomeKind;
  readonly monthlyAmount: number;
  readonly description: string;
  readonly verified: boolean;
}

export interface FinancialStatement {
  readonly id: string;
  readonly tenantId: string;
  readonly customerId: string;
  readonly monthlyGrossIncome: number;
  readonly monthlyNetIncome: number;
  readonly incomeCurrency: string;
  readonly incomeSources: ReadonlyArray<IncomeSource>;
  readonly monthlyExpenses: number;
  readonly monthlyDebtService: number;
  readonly submittedAt: string;
  readonly verifiedAt?: string;
  readonly consentGiven: true;
}

export interface SubmitStatementInput {
  readonly customerId: string;
  readonly monthlyGrossIncome: number;
  readonly monthlyNetIncome: number;
  readonly otherIncome?: number;
  readonly incomeCurrency: string;
  readonly incomeSources: ReadonlyArray<IncomeSource>;
  readonly monthlyExpenses: number;
  readonly monthlyDebtService: number;
  readonly existingArrears?: number;
  readonly employmentStatus?: string;
  readonly employerName?: string;
  readonly employmentStartDate?: string;
  readonly supportingDocumentIds?: ReadonlyArray<string>;
  readonly consentGiven: true;
}

export interface VerifyBankRefInput {
  readonly id: string;
  readonly bankAccountLast4?: string;
  readonly bankName?: string;
}

export interface LitigationRecordInput {
  readonly customerId: string;
  readonly kind:
    | 'eviction'
    | 'judgment'
    | 'lawsuit_as_plaintiff'
    | 'lawsuit_as_defendant'
    | 'bankruptcy'
    | 'other';
  readonly outcome?: 'pending' | 'won' | 'lost' | 'settled' | 'dismissed' | 'withdrawn';
  readonly caseNumber?: string;
  readonly court?: string;
  readonly jurisdiction?: string;
  readonly filedAt?: string;
  readonly resolvedAt?: string;
  readonly amountInvolved?: number;
  readonly currency?: string;
  readonly summary?: string;
  readonly disclosedBySelf?: boolean;
  readonly evidenceDocumentIds?: ReadonlyArray<string>;
}

export interface LitigationRecord {
  readonly id: string;
  readonly tenantId: string;
  readonly customerId: string;
  readonly kind: LitigationRecordInput['kind'];
  readonly recordedAt: string;
}

const BASE = '/financial-profile';

export function useSubmitFinancialStatement(
  scope: TenantScopeArg,
  options?: DefaultMutationOptions<FinancialStatement, SubmitStatementInput>,
) {
  const qc = useQueryClient();
  return useMutation<FinancialStatement, ApiClientError, SubmitStatementInput>({
    mutationFn: async (input) => {
      const res = await client().post<FinancialStatement>(
        `${BASE}/statements`,
        input,
      );
      return res.data;
    },
    onSuccess: (data, variables, context) => {
      qc.invalidateQueries({ queryKey: queryKeys.financialProfile.all(scope) });
      options?.onSuccess?.(data, variables, undefined, context as never);
    },
    ...defaultMutationRetry,
    ...options,
  });
}

export function useVerifyBankReference(
  scope: TenantScopeArg,
  options?: DefaultMutationOptions<FinancialStatement, VerifyBankRefInput>,
) {
  const qc = useQueryClient();
  return useMutation<FinancialStatement, ApiClientError, VerifyBankRefInput>({
    mutationFn: async ({ id, ...body }) => {
      const res = await client().post<FinancialStatement>(
        `${BASE}/statements/${id}/bank-ref`,
        body,
      );
      return res.data;
    },
    onSuccess: (data, variables, context) => {
      qc.invalidateQueries({
        queryKey: queryKeys.financialProfile.statement(scope, variables.id),
      });
      options?.onSuccess?.(data, variables, undefined, context as never);
    },
    ...defaultMutationRetry,
    ...options,
  });
}

export function useRecordLitigation(
  scope: TenantScopeArg,
  options?: DefaultMutationOptions<LitigationRecord, LitigationRecordInput>,
) {
  const qc = useQueryClient();
  return useMutation<LitigationRecord, ApiClientError, LitigationRecordInput>({
    mutationFn: async (input) => {
      const res = await client().post<LitigationRecord>(`${BASE}/litigation`, input);
      return res.data;
    },
    onSuccess: (data, variables, context) => {
      qc.invalidateQueries({ queryKey: queryKeys.financialProfile.all(scope) });
      options?.onSuccess?.(data, variables, undefined, context as never);
    },
    ...defaultMutationRetry,
    ...options,
  });
}
