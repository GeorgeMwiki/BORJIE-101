/**
 * M-Pesa STK Push (Lipa Na M-Pesa) payment initiation
 */
import { ValidationError } from '../../common/errors';
import { logger } from '../../common/logger';
import { withRetry } from '../../common/retry';
import type { Money } from '../../common/types';
import { getMpesaAccessToken } from './auth';
import type { MpesaConfig } from './types';

const STK_PUSH_PATH = '/mpesa/stkpush/v1/processrequest';

function normalizePhone(phone: string): string {
  let cleaned = phone.replace(/\D/g, '');
  if (cleaned.startsWith('0')) {
    cleaned = '254' + cleaned.substring(1);
  }
  if (!cleaned.startsWith('254')) {
    cleaned = '254' + cleaned;
  }
  return cleaned;
}

function generatePassword(shortCode: string, passKey: string): {
  password: string;
  timestamp: string;
} {
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:T.Z]/g, '')
    .substring(0, 14);
  const password = Buffer.from(`${shortCode}${passKey}${timestamp}`).toString(
    'base64'
  );
  return { password, timestamp };
}

export interface StkPushResult {
  checkoutRequestId: string;
  merchantRequestId: string;
  status: 'PENDING';
  message: string;
}

export async function initiateStkPush(
  config: MpesaConfig,
  params: {
    amount: Money;
    phone: string;
    reference: string;
    description?: string;
  }
): Promise<StkPushResult> {
  if (params.amount.currency !== 'KES') {
    throw new ValidationError('M-Pesa only supports KES', 'mpesa');
  }

  const amountMajor = Math.round(params.amount.amountMinorUnits / 100);
  if (amountMajor < 1 || amountMajor > 150000) {
    throw new ValidationError(
      'M-Pesa amount must be between 1 and 150,000 KES',
      'mpesa'
    );
  }

  const phoneNumber = normalizePhone(params.phone);
  if (phoneNumber.length !== 12) {
    throw new ValidationError('Invalid phone number format', 'mpesa');
  }

  const accessToken = await getMpesaAccessToken(config);
  const { password, timestamp } = generatePassword(config.shortCode, config.passKey);

  const baseUrl =
    config.environment === 'production'
      ? 'https://api.safaricom.co.ke'
      : 'https://sandbox.safaricom.co.ke';

  const body = {
    BusinessShortCode: config.shortCode,
    Password: password,
    Timestamp: timestamp,
    TransactionType: 'CustomerPayBillOnline' as const,
    Amount: amountMajor,
    PartyA: phoneNumber,
    PartyB: config.shortCode,
    PhoneNumber: phoneNumber,
    CallBackURL: `${config.callbackBaseUrl}/webhooks/mpesa/stk`,
    AccountReference: params.reference.substring(0, 12),
    TransactionDesc: (params.description || 'Payment').substring(0, 13),
  };

  const doRequest = async () => {
    const response = await fetch(`${baseUrl}${STK_PUSH_PATH}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = (await response.json()) as {
      MerchantRequestID?: string;
      CheckoutRequestID?: string;
      ResponseCode?: string;
      ResponseDescription?: string;
      CustomerMessage?: string;
      errorMessage?: string;
    };

    if (!response.ok || data.ResponseCode !== '0') {
      const msg = data.errorMessage || data.ResponseDescription || response.statusText;
      throw new ValidationError(`M-Pesa STK Push failed: ${msg}`, 'mpesa');
    }

    return {
      checkoutRequestId: data.CheckoutRequestID!,
      merchantRequestId: data.MerchantRequestID!,
      status: 'PENDING' as const,
      message: data.CustomerMessage || 'Enter PIN on your phone',
    };
  };

  try {
    const result = await withRetry(doRequest);
    logger.info(
      {
        checkoutRequestId: result.checkoutRequestId,
        reference: params.reference,
        amount: amountMajor,
      },
      'M-Pesa STK push initiated'
    );
    return result;
  } catch (err) {
    logger.error(
      { err, reference: params.reference, provider: 'mpesa' },
      'M-Pesa STK push failed'
    );
    throw err;
  }
}
