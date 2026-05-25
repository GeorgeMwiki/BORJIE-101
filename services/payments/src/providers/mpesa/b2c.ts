/**
 * M-Pesa B2C (Business to Customer) - refunds and disbursements
 */
import { ValidationError } from '../../common/errors';
import { logger } from '../../common/logger';
import { withRetry } from '../../common/retry';
import type { Money } from '../../common/types';
import { getMpesaAccessToken } from './auth';
import { generateSecurityCredential } from './security-credential';
import type { MpesaConfig } from './types';

const B2C_PATH = '/mpesa/b2c/v1/paymentrequest';

/**
 * Accept either a pre-built credential or a plaintext password.
 * Heuristic: base64 ciphertext is ≥ 172 chars with no whitespace for a
 * 2048-bit RSA key. Anything shorter is the password.
 */
function buildCredential(
  input: string | undefined,
  config: MpesaConfig
): string {
  const pwd =
    input && (input.length < 160 || /\s/.test(input))
      ? input
      : undefined;
  if (input && !pwd) return input;
  const password = pwd ?? process.env.MPESA_INITIATOR_PASSWORD?.trim();
  if (!password) {
    throw new ValidationError(
      'M-Pesa B2C requires an initiator password (MPESA_INITIATOR_PASSWORD) ' +
        'or a pre-built SecurityCredential.',
      'mpesa'
    );
  }
  return generateSecurityCredential(
    password,
    (config.environment ?? 'sandbox') as 'sandbox' | 'production'
  );
}

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

export interface B2CParams {
  amount: Money;
  phone: string;
  remarks?: string;
  occasion?: string;
  initiatorName?: string;
}

export interface B2CResult {
  conversationId: string;
  originatorConversationId: string;
  status: 'PENDING';
  message: string;
}

export async function initiateB2C(
  config: MpesaConfig,
  params: B2CParams,
  // Accept either a pre-built credential (for back-compat with callers
  // that build their own) OR the plaintext initiator password which we
  // RSA-encrypt here. This is the path production should take; passing
  // a pre-built credential is an escape hatch for testing.
  credentialOrPassword?: string
): Promise<B2CResult> {
  // If the caller supplied a string that already looks like base64
  // ciphertext (long + no whitespace) use it directly; otherwise treat
  // it as the plaintext initiator password and encrypt now.
  const securityCredential = buildCredential(credentialOrPassword, config);
  if (params.amount.currency !== 'KES') {
    throw new ValidationError('M-Pesa B2C only supports KES', 'mpesa');
  }

  const amountMajor = Math.round(params.amount.amountMinorUnits / 100);
  if (amountMajor < 10 || amountMajor > 150000) {
    throw new ValidationError(
      'M-Pesa B2C amount must be between 10 and 150,000 KES',
      'mpesa'
    );
  }

  const phoneNumber = normalizePhone(params.phone);
  if (phoneNumber.length !== 12) {
    throw new ValidationError('Invalid phone number for B2C', 'mpesa');
  }

  const accessToken = await getMpesaAccessToken(config);

  const baseUrl =
    config.environment === 'production'
      ? 'https://api.safaricom.co.ke'
      : 'https://sandbox.safaricom.co.ke';

  const body = {
    InitiatorName: params.initiatorName ?? 'BORJIE',
    SecurityCredential: securityCredential,
    CommandID: 'BusinessPayment' as const,
    Amount: amountMajor,
    PartyA: config.shortCode,
    PartyB: phoneNumber,
    Remarks: (params.remarks ?? 'Refund').substring(0, 100),
    QueueTimeOutURL: `${config.callbackBaseUrl}/webhooks/mpesa/b2c/timeout`,
    ResultURL: `${config.callbackBaseUrl}/webhooks/mpesa/b2c/result`,
    Occasion: (params.occasion ?? '').substring(0, 100),
  };

  const doRequest = async () => {
    const response = await fetch(`${baseUrl}${B2C_PATH}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = (await response.json()) as {
      ConversationID?: string;
      OriginatorConversationID?: string;
      ResponseCode?: string;
      ResponseDescription?: string;
    };

    if (!response.ok || data.ResponseCode !== '0') {
      throw new ValidationError(
        `M-Pesa B2C failed: ${data.ResponseDescription}`,
        'mpesa'
      );
    }

    return {
      conversationId: data.ConversationID!,
      originatorConversationId: data.OriginatorConversationID!,
      status: 'PENDING' as const,
      message: 'B2C request submitted. Status via callback.',
    };
  };

  try {
    const result = await withRetry(doRequest);
    logger.info(
      {
        conversationId: result.conversationId,
        amount: amountMajor,
        provider: 'mpesa',
      },
      'M-Pesa B2C initiated'
    );
    return result;
  } catch (err) {
    logger.error(
      { err, amount: amountMajor, provider: 'mpesa' },
      'M-Pesa B2C failed'
    );
    throw err;
  }
}
