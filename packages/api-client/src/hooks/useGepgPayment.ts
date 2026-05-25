/**
 * GePG Payment hooks.
 *
 * Endpoints:
 *   POST /gepg/control-numbers                              → request
 *   GET  /gepg/control-numbers/:controlNumber?billId=...    → status
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { ApiClientError } from '../client';
import { queryKeys } from './query-keys';
import {
  client,
  defaultMutationRetry,
  defaultQueryRetry,
  type DefaultMutationOptions,
  type DefaultQueryOptions,
  type TenantScopeArg,
} from './shared';

/**
 * GePG is a Tanzania-only payment rail; TZS is the canonical settlement
 * currency, USD is supported for cross-border invoices. The value is
 * sourced from getJurisdictionalRules('TZ').defaultCurrency at the call
 * site — this alias kept narrow for typed UI hooks only.
 */
export type GepgCurrency = string; // ISO 4217 code; runtime constrained to TZS|USD by GePG provider

export interface GepgControlNumber {
  readonly controlNumber: string;
  readonly billId: string;
  readonly tenantId: string;
  readonly amountMinorUnits: number;
  readonly currency: GepgCurrency;
  readonly status: 'issued' | 'paid' | 'expired' | 'cancelled';
  readonly issuedAt: string;
  readonly expiresAt?: string;
}

export interface GepgStatus {
  readonly controlNumber: string;
  readonly billId: string;
  readonly status: 'issued' | 'paid' | 'expired' | 'cancelled';
  readonly paidAmount?: number;
  readonly paidAt?: string;
  readonly pspReceiptNumber?: string;
}

export interface RequestControlNumberInput {
  readonly invoiceId: string;
  readonly billId: string;
  readonly amountMinorUnits: number;
  readonly currency: GepgCurrency;
  readonly payerName: string;
  readonly payerPhone?: string;
  readonly payerEmail?: string;
  readonly description: string;
  readonly expiresAt?: string;
}

const BASE = '/gepg';

export function useGepgStatus(
  scope: TenantScopeArg,
  controlNumber: string,
  billId: string,
  options?: DefaultQueryOptions<GepgStatus>,
) {
  return useQuery<GepgStatus, ApiClientError>({
    queryKey: queryKeys.gepg.controlNumber(scope, controlNumber, billId),
    queryFn: async () => {
      const res = await client().get<GepgStatus>(
        `${BASE}/control-numbers/${controlNumber}`,
        { params: { billId } },
      );
      return res.data;
    },
    enabled: Boolean(controlNumber && billId),
    ...defaultQueryRetry,
    ...options,
  });
}

export function useRequestGepgControlNumber(
  scope: TenantScopeArg,
  options?: DefaultMutationOptions<GepgControlNumber, RequestControlNumberInput>,
) {
  const qc = useQueryClient();
  return useMutation<GepgControlNumber, ApiClientError, RequestControlNumberInput>({
    mutationFn: async (input) => {
      const res = await client().post<GepgControlNumber>(
        `${BASE}/control-numbers`,
        input,
      );
      return res.data;
    },
    onSuccess: (data, variables, context) => {
      qc.invalidateQueries({ queryKey: queryKeys.gepg.all(scope) });
      options?.onSuccess?.(data, variables, undefined, context as never);
    },
    ...defaultMutationRetry,
    ...options,
  });
}
