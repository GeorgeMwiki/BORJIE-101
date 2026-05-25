/**
 * M-Pesa OAuth token management with caching and retry
 */
import { ProviderAuthError } from '../../common/errors';
import { logger } from '../../common/logger';
import { withRetry } from '../../common/retry';
import type { MpesaConfig } from './types';

interface TokenCache {
  accessToken: string;
  expiresAt: Date;
}

let tokenCache: TokenCache | null = null;

function getBaseUrl(environment: 'sandbox' | 'production'): string {
  return environment === 'production'
    ? 'https://api.safaricom.co.ke'
    : 'https://sandbox.safaricom.co.ke';
}

export async function getMpesaAccessToken(config: MpesaConfig): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > new Date()) {
    return tokenCache.accessToken;
  }

  const auth = Buffer.from(
    `${config.consumerKey}:${config.consumerSecret}`
  ).toString('base64');
  const baseUrl = getBaseUrl(config.environment);

  const fetchToken = async () => {
    const response = await fetch(
      `${baseUrl}/oauth/v1/generate?grant_type=client_credentials`,
      {
        method: 'GET',
        headers: { Authorization: `Basic ${auth}` },
      }
    );

    if (!response.ok) {
      throw new ProviderAuthError(
        `M-Pesa auth failed: ${response.status} ${response.statusText}`,
        'mpesa'
      );
    }

    const data = (await response.json()) as {
      access_token: string;
      expires_in: string;
    };

    if (!data.access_token) {
      throw new ProviderAuthError('M-Pesa auth: no access token in response', 'mpesa');
    }

    const expiresIn = parseInt(data.expires_in, 10) || 3599;
    tokenCache = {
      accessToken: data.access_token,
      expiresAt: new Date(Date.now() + expiresIn * 1000 - 60000),
    };

    logger.info({ provider: 'mpesa' }, 'M-Pesa access token refreshed');
    return tokenCache.accessToken;
  };

  try {
    return await withRetry(fetchToken, { maxAttempts: 2 });
  } catch (err) {
    logger.error({ err, provider: 'mpesa' }, 'M-Pesa token refresh failed');
    throw err;
  }
}

export function clearMpesaTokenCache(): void {
  tokenCache = null;
}
