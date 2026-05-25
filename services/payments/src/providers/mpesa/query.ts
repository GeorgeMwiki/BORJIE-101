/**
 * M-Pesa transaction status query (STK Push Query)
 */
import { logger } from '../../common/logger';
import { withRetry } from '../../common/retry';
import type { Money } from '../../common/types';
import { getMpesaAccessToken } from './auth';
import type { MpesaConfig } from './types';

const QUERY_PATH = '/mpesa/stkpushquery/v1/query';

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

export interface StkQueryResult {
  checkoutRequestId: string;
  status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED';
  amount?: Money | undefined;
  mpesaReceiptNumber?: string | undefined;
  transactionDate?: string | undefined;
}

export async function queryStkStatus(
  config: MpesaConfig,
  checkoutRequestId: string
): Promise<StkQueryResult> {
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
    CheckoutRequestID: checkoutRequestId,
  };

  const doQuery = async () => {
    const response = await fetch(`${baseUrl}${QUERY_PATH}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = (await response.json()) as {
      ResponseCode?: string;
      ResponseDescription?: string;
      MerchantRequestID?: string;
      CheckoutRequestID?: string;
      ResultCode?: string;
      ResultDesc?: string;
      ResultParameters?: {
        ResultParameter: Array<{ Key: string; Value: string | number }>;
      };
    };

    if (!response.ok) {
      throw new Error(
        data.ResponseDescription || `Query failed: ${response.status}`
      );
    }

    const resultCode = data.ResultCode ?? '';
    let status: StkQueryResult['status'] = 'PENDING';

    if (resultCode === '0') {
      status = 'SUCCEEDED';
    } else if (resultCode === '1032') {
      status = 'CANCELLED';
    } else if (resultCode) {
      status = 'FAILED';
    }

    const getParam = (key: string) =>
      data.ResultParameters?.ResultParameter?.find((p) => p.Key === key)?.Value;

    const amount =
      typeof getParam('Amount') === 'number'
        ? { amountMinorUnits: (getParam('Amount') as number) * 100, currency: 'KES' as const }
        : undefined;

    return {
      checkoutRequestId: data.CheckoutRequestID ?? checkoutRequestId,
      status,
      amount,
      mpesaReceiptNumber: getParam('MpesaReceiptNumber') as string | undefined,
      transactionDate: getParam('TransactionDate') as string | undefined,
    };
  };

  try {
    const result = await withRetry(doQuery);
    logger.info(
      {
        checkoutRequestId,
        status: result.status,
        provider: 'mpesa',
      },
      'M-Pesa STK query completed'
    );
    return result;
  } catch (err) {
    logger.error(
      { err, checkoutRequestId, provider: 'mpesa' },
      'M-Pesa STK query failed'
    );
    throw err;
  }
}
