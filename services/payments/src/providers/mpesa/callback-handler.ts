/**
 * M-Pesa STK Push and B2C callback processing
 */
import { createHmac, timingSafeEqual } from 'crypto';
import { CallbackError } from '../../common/errors';
import { logger } from '../../common/logger';
import type { PaymentStatus } from '../../common/types';
import type {
  StkCallbackPayload,
  StkCallbackMetadataItem,
  B2CCallbackResult,
} from './types';

export interface StkCallbackResult {
  checkoutRequestId: string;
  merchantRequestId: string;
  status: PaymentStatus;
  mpesaReceiptNumber?: string;
  amount?: number;
  phoneNumber?: string;
  transactionDate?: string;
}

export interface B2CCallbackResultParsed {
  conversationId: string;
  transactionId?: string;
  status: PaymentStatus;
  amount?: number;
  recipientPhone?: string;
}

function getMetadataItem(
  items: StkCallbackMetadataItem[],
  name: string
): string | number | undefined {
  const item = items.find((i) => i.Name === name);
  return item?.Value;
}

export function parseStkCallback(payload: unknown): StkCallbackResult {
  const body = payload as StkCallbackPayload;

  if (!body?.Body?.stkCallback) {
    throw new CallbackError('Invalid STK callback structure', 'mpesa');
  }

  const cb = body.Body.stkCallback;
  const checkoutRequestId = cb.CheckoutRequestID;
  const merchantRequestId = cb.MerchantRequestID;

  if (cb.ResultCode === 0 && cb.CallbackMetadata?.Item) {
    const items = cb.CallbackMetadata.Item;
    const mpesaReceipt = String(getMetadataItem(items, 'MpesaReceiptNumber') ?? '');
    const amount = Number(getMetadataItem(items, 'Amount') ?? 0);
    const phone = String(getMetadataItem(items, 'PhoneNumber') ?? '');
    const date = String(getMetadataItem(items, 'TransactionDate') ?? '');

    logger.info(
      {
        checkoutRequestId,
        mpesaReceipt,
        amount,
        provider: 'mpesa',
      },
      'M-Pesa STK callback: payment succeeded'
    );

    return {
      checkoutRequestId,
      merchantRequestId,
      status: 'SUCCEEDED',
      mpesaReceiptNumber: mpesaReceipt,
      amount,
      phoneNumber: phone,
      transactionDate: date,
    };
  }

  const status: PaymentStatus =
    cb.ResultCode === 1032 ? 'CANCELLED' : 'FAILED';

  logger.info(
    {
      checkoutRequestId,
      resultCode: cb.ResultCode,
      resultDesc: cb.ResultDesc,
      provider: 'mpesa',
    },
    `M-Pesa STK callback: ${status}`
  );

  return {
    checkoutRequestId,
    merchantRequestId,
    status,
  };
}

export function parseB2CCallback(payload: unknown): B2CCallbackResultParsed {
  const data = payload as B2CCallbackResult;

  if (!data?.Result) {
    throw new CallbackError('Invalid B2C callback structure', 'mpesa');
  }

  const result = data.Result;
  const conversationId = result.ConversationID;

  if (result.ResultCode === 0 && result.ResultParameters?.ResultParameter) {
    const params = result.ResultParameters.ResultParameter;
    const getParam = (key: string) =>
      params.find((p) => p.Key === key)?.Value;

    logger.info(
      {
        conversationId,
        transactionId: result.TransactionID,
        provider: 'mpesa',
      },
      'M-Pesa B2C callback: transfer succeeded'
    );

    return {
      conversationId,
      transactionId: result.TransactionID,
      status: 'SUCCEEDED',
      amount: Number(getParam('TransactionAmount')),
      recipientPhone: String(getParam('ReceiverParty')),
    };
  }

  logger.warn(
    {
      conversationId,
      resultCode: result.ResultCode,
      resultDesc: result.ResultDesc,
      provider: 'mpesa',
    },
    'M-Pesa B2C callback: transfer failed'
  );

  return {
    conversationId,
    status: 'FAILED',
  };
}

export function verifyMpesaCallbackSignature(
  rawBody: string,
  signature: string | undefined,
  secret: string
): boolean {
  if (!secret) return true;
  if (!signature) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const candidates = [signature, signature.replace(/^sha256=/, '')];
  const expBuf = Buffer.from(expected);
  for (const candidate of candidates) {
    const sigBuf = Buffer.from(candidate);
    if (sigBuf.length === expBuf.length && timingSafeEqual(sigBuf, expBuf)) {
      return true;
    }
  }
  return false;
}
