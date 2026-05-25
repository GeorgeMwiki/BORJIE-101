/**
 * Airtel Money payment initiation
 */
import { v4 as uuidv4 } from 'uuid';
import { ValidationError } from '../../common/errors';
import { logger } from '../../common/logger';
import { withRetry } from '../../common/retry';
import type { Money } from '../../common/types';
import type { AirtelConfig } from './types';

const SANDBOX_URL = 'https://sandbox.airtel.africa';
const PROD_URL = 'https://openapi.airtel.africa';

function getBaseUrl(environment: 'sandbox' | 'production'): string {
  return environment === 'production' ? PROD_URL : SANDBOX_URL;
}

function normalizePhone(phone: string, country: string): string {
  let cleaned = phone.replace(/\D/g, '');
  const prefixes: Record<string, string> = {
    TZ: '255',
    UG: '256',
    KE: '254',
  };
  const prefix = prefixes[country] ?? '255';
  if (cleaned.startsWith('0')) {
    cleaned = prefix + cleaned.substring(1);
  }
  if (!cleaned.startsWith(prefix)) {
    cleaned = prefix + cleaned;
  }
  return cleaned;
}

function getCurrency(country: string): string {
  const map: Record<string, string> = {
    TZ: 'TZS',
    UG: 'UGX',
    KE: 'KES',
  };
  return map[country] ?? 'TZS';
}

export interface AirtelPaymentResult {
  transactionId: string;
  reference: string;
  status: 'PENDING';
  message: string;
}

async function getAirtelToken(config: AirtelConfig): Promise<string> {
  const baseUrl = getBaseUrl(config.environment);
  const auth = Buffer.from(
    `${config.clientId}:${config.clientSecret}`
  ).toString('base64');

  const response = await fetch(`${baseUrl}/merchant/v1/auth/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ grant_type: 'client_credentials' }),
  });

  if (!response.ok) {
    throw new ValidationError(
      `Airtel auth failed: ${response.status}`,
      'airtel'
    );
  }

  const data = (await response.json()) as { access_token: string };
  return data.access_token;
}

export async function initiateAirtelPayment(
  config: AirtelConfig,
  params: {
    amount: Money;
    phone: string;
    reference: string;
    description?: string;
  }
): Promise<AirtelPaymentResult> {
  const currency = getCurrency(config.country);
  if (params.amount.currency !== currency) {
    throw new ValidationError(
      `Airtel Money ${config.country} requires ${currency}`,
      'airtel'
    );
  }

  const amountMajor = Math.round(params.amount.amountMinorUnits / 100);
  if (amountMajor < 500 || amountMajor > 5000000) {
    throw new ValidationError(
      `Airtel amount must be between 500 and 5,000,000 (minor units)`,
      'airtel'
    );
  }

  const phoneNumber = normalizePhone(params.phone, config.country);
  const baseUrl = getBaseUrl(config.environment);
  const token = await getAirtelToken(config);

  const transactionId = `airtel_${uuidv4()}`;
  const body = {
    reference: params.reference,
    subscriber: {
      country: config.country,
      currency,
      msisdn: phoneNumber,
    },
    transaction: {
      amount: String(amountMajor),
      country: config.country,
      currency,
      id: transactionId,
    },
  };

  const doRequest = async () => {
    const response = await fetch(
      `${baseUrl}/merchant/v1/payments`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      }
    );

    const data = (await response.json()) as {
      status?: { code?: string; message?: string; result_code?: string };
      transaction?: { id: string; status: string };
    };

    if (!response.ok) {
      const msg = data.status?.message || response.statusText;
      throw new ValidationError(`Airtel payment failed: ${msg}`, 'airtel');
    }

    if (data.status?.result_code !== 'TS') {
      throw new ValidationError(
        `Airtel payment rejected: ${data.status?.message}`,
        'airtel'
      );
    }

    return {
      transactionId: data.transaction?.id ?? transactionId,
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
        provider: 'airtel',
      },
      'Airtel Money payment initiated'
    );
    return result;
  } catch (err) {
    logger.error(
      { err, reference: params.reference, provider: 'airtel' },
      'Airtel Money payment failed'
    );
    throw err;
  }
}
