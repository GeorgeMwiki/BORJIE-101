/**
 * GePG provider — implements the standard provider interface for the
 * Tanzanian Government e-Payment Gateway.
 *
 * Design: GePG is deterministic (no LLM in the critical path). Control
 * numbers are assigned by GePG and referenced by payments. Our matcher
 * joins payments to invoices via the control-number field.
 */
import { CallbackError, ValidationError } from '../../common/errors';
import { logger } from '../../common/logger';
import {
  requestControlNumberHttp,
  queryControlNumberHttp,
} from './gepg-client';
import {
  verifyGepgSignature,
  type GepgSignatureConfig,
} from './gepg-signature';
import type {
  GepgCallbackPayload,
  GepgCallbackResult,
  GepgConfig,
  GepgControlNumberRequest,
  GepgControlNumberResponse,
  GepgStatusQuery,
  GepgStatusResult,
} from './types';

export interface GepgProvider {
  readonly name: 'gepg';
  requestControlNumber(
    req: GepgControlNumberRequest
  ): Promise<GepgControlNumberResponse>;
  queryStatus(q: GepgStatusQuery): Promise<GepgStatusResult>;
  handleCallback(
    rawBody: string,
    signature: string | undefined,
    parsed: Omit<GepgCallbackPayload, 'rawBody' | 'signature'>
  ): Promise<GepgCallbackResult>;
}

export interface GepgProviderDeps {
  readonly config: GepgConfig;
  readonly signatureConfig: GepgSignatureConfig;
  readonly onControlNumberIssued?: (
    response: GepgControlNumberResponse,
    req: GepgControlNumberRequest
  ) => Promise<void>;
  readonly onPaymentReceived?: (
    payload: GepgCallbackPayload
  ) => Promise<void>;
}

export function createGepgProvider(deps: GepgProviderDeps): GepgProvider {
  const { config, signatureConfig } = deps;

  return {
    name: 'gepg' as const,

    async requestControlNumber(req) {
      if (!req.tenantId || !req.invoiceId || !req.billId) {
        throw new ValidationError(
          'GePG requestControlNumber requires tenantId, invoiceId, billId',
          'gepg'
        );
      }

      const response = await requestControlNumberHttp(config, req);

      logger.info(
        {
          provider: 'gepg',
          tenantId: req.tenantId,
          invoiceId: req.invoiceId,
          billId: req.billId,
          controlNumber: response.controlNumber,
          status: response.status,
        },
        'GePG control number issued'
      );

      if (deps.onControlNumberIssued) {
        try {
          await deps.onControlNumberIssued(response, req);
        } catch (err) {
          logger.error(
            { err, provider: 'gepg' },
            'onControlNumberIssued hook failed'
          );
        }
      }

      return response;
    },

    async queryStatus(q) {
      if (!q.controlNumber || !q.billId) {
        throw new ValidationError(
          'GePG queryStatus requires controlNumber and billId',
          'gepg'
        );
      }
      return queryControlNumberHttp(config, q);
    },

    async handleCallback(rawBody, signature, parsed) {
      const verification = verifyGepgSignature(
        rawBody,
        signature,
        signatureConfig
      );

      if (!verification.valid) {
        logger.warn(
          { provider: 'gepg', reason: verification.reason },
          'GePG callback signature rejected'
        );
        throw new CallbackError(
          `GePG signature invalid: ${verification.reason ?? 'unknown'}`,
          'gepg'
        );
      }

      if (!parsed.controlNumber || !parsed.billId) {
        throw new CallbackError(
          'GePG callback missing controlNumber or billId',
          'gepg'
        );
      }

      const payload: GepgCallbackPayload = {
        ...parsed,
        signature: signature as string,
        rawBody,
      };

      logger.info(
        {
          provider: 'gepg',
          controlNumber: payload.controlNumber,
          billId: payload.billId,
          paidAmount: payload.paidAmount,
          pspChannel: payload.pspChannel,
        },
        'GePG callback accepted'
      );

      if (deps.onPaymentReceived) {
        try {
          await deps.onPaymentReceived(payload);
        } catch (err) {
          logger.error(
            { err, provider: 'gepg' },
            'onPaymentReceived hook failed'
          );
          // Still accept: idempotent reconciliation will retry.
        }
      }

      return {
        accepted: true,
        controlNumber: payload.controlNumber,
        billId: payload.billId,
      };
    },
  };
}
