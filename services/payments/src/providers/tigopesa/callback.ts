/**
 * Tigo Pesa callback handling
 */
import { CallbackError } from '../../common/errors';
import { logger } from '../../common/logger';
import type { PaymentStatus } from '../../common/types';

export interface TigoPesaCallbackResult {
  transactionId: string;
  reference?: string | undefined;
  status: PaymentStatus;
  amount?: number | undefined;
}

function parseXmlValue(xml: string, tag: string): string | undefined {
  const match = xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`, 'i'));
  return match?.[1]?.trim();
}

export function parseTigoPesaCallback(payload: string): TigoPesaCallbackResult {
  if (!payload || typeof payload !== 'string') {
    throw new CallbackError('Invalid Tigo Pesa callback: empty payload', 'tigopesa');
  }

  const transactionId =
    parseXmlValue(payload, 'TXNID') ??
    parseXmlValue(payload, 'TRANSACTIONID') ??
    'unknown';

  const statusStr = (
    parseXmlValue(payload, 'STATUS') ??
    parseXmlValue(payload, 'RESULTCODE') ??
    ''
  ).toUpperCase();

  let status: PaymentStatus = 'PENDING';
  if (statusStr === 'SUCCESS' || statusStr === '0') {
    status = 'SUCCEEDED';
  } else if (statusStr === 'FAIL' || statusStr === 'FAILED') {
    status = 'FAILED';
  }

  const amountStr = parseXmlValue(payload, 'AMOUNT');
  const amount = amountStr ? parseInt(amountStr, 10) : undefined;

  const reference = parseXmlValue(payload, 'CUSTOMERREFERENCEID');

  logger.info(
    {
      transactionId,
      status,
      rawStatus: statusStr,
      provider: 'tigopesa',
    },
    'Tigo Pesa callback processed'
  );

  return {
    transactionId,
    reference,
    status,
    amount: amount ? amount * 100 : undefined,
  };
}
