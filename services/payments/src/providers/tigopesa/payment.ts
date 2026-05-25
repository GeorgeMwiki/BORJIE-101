/**
 * Tigo Pesa payment initiation (W2A - Wallet to Account)
 */
import { v4 as uuidv4 } from 'uuid';
import { ValidationError } from '../../common/errors';
import { logger } from '../../common/logger';
import { withRetry } from '../../common/retry';
import type { Money } from '../../common/types';
import type { TigoPesaConfig } from './types';
import { TIGO_SANDBOX_URL, TIGO_PROD_URL } from './types';

function normalizePhone(phone: string): string {
  let cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('0')) {
    cleaned = '255' + cleaned.substring(1);
  }
  if (!cleaned.startsWith('255')) {
    cleaned = '255' + cleaned;
  }
  return cleaned;
}

function buildPaymentXml(
  config: TigoPesaConfig,
  txnId: string,
  msisdn: string,
  amount: number,
  reference: string
): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<COMMAND>
  <TYPE>COMMAND</TYPE>
  <TXNID>${txnId}</TXNID>
  <MSISDN>${msisdn}</MSISDN>
  <AMOUNT>${amount}</AMOUNT>
  <COMPANYNAME>${config.companyName}</COMPANYNAME>
  <BILLERCODE>${config.billerCode}</BILLERCODE>
  <CUSTOMERREFERENCEID>${reference}</CUSTOMERREFERENCEID>
</COMMAND>`;
}

export interface TigoPesaPaymentResult {
  transactionId: string;
  reference: string;
  status: 'PENDING';
  message: string;
}

export async function initiateTigoPesaPayment(
  config: TigoPesaConfig,
  params: {
    amount: Money;
    phone: string;
    reference: string;
    description?: string;
  }
): Promise<TigoPesaPaymentResult> {
  if (params.amount.currency !== 'TZS') {
    throw new ValidationError('Tigo Pesa only supports TZS', 'tigopesa');
  }

  const amountMajor = Math.round(params.amount.amountMinorUnits / 100);
  if (amountMajor < 1000 || amountMajor > 10000000) {
    throw new ValidationError(
      'Tigo Pesa amount must be between 1,000 and 10,000,000 TZS',
      'tigopesa'
    );
  }

  const phoneNumber = normalizePhone(params.phone);
  if (phoneNumber.length !== 12) {
    throw new ValidationError('Invalid phone number for Tigo Pesa', 'tigopesa');
  }

  const baseUrl =
    config.environment === 'production' ? TIGO_PROD_URL : TIGO_SANDBOX_URL;

  const transactionId = `tigo_${uuidv4()}`;
  const xml = buildPaymentXml(
    config,
    transactionId,
    phoneNumber,
    amountMajor,
    params.reference.substring(0, 50)
  );

  const auth = Buffer.from(
    `${config.apiKey}:${config.apiSecret}`
  ).toString('base64');

  const doRequest = async () => {
    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/xml',
      },
      body: xml,
    });

    const text = await response.text();

    if (!response.ok) {
      throw new ValidationError(
        `Tigo Pesa request failed: ${response.status}`,
        'tigopesa'
      );
    }

    const statusMatch = text.match(/<STATUS>([^<]+)<\/STATUS>/i);
    const status = statusMatch?.[1]?.toUpperCase() ?? '';

    if (status !== 'SUCCESS' && status !== 'PENDING') {
      const msgMatch = text.match(/<MESSAGE>([^<]*)<\/MESSAGE>/i);
      throw new ValidationError(
        `Tigo Pesa rejected: ${msgMatch?.[1] || status}`,
        'tigopesa'
      );
    }

    return {
      transactionId,
      reference: params.reference,
      status: 'PENDING' as const,
      message: 'USSD push sent. Awaiting customer confirmation.',
    };
  };

  try {
    const result = await withRetry(doRequest);
    logger.info(
      {
        transactionId: result.transactionId,
        reference: params.reference,
        amount: amountMajor,
        provider: 'tigopesa',
      },
      'Tigo Pesa payment initiated'
    );
    return result;
  } catch (err) {
    logger.error(
      { err, reference: params.reference, provider: 'tigopesa' },
      'Tigo Pesa payment failed'
    );
    throw err;
  }
}
