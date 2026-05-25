/**
 * Tigo Pesa (Tanzania) API types
 * Uses XML over HTTP - W2A (Wallet to Account) collection
 */
export interface TigoPesaConfig {
  apiKey: string;
  apiSecret: string;
  companyName: string;
  billerCode: string;
  environment: 'sandbox' | 'production';
  callbackBaseUrl: string;
}

export const TIGO_SANDBOX_URL = 'https://securesandbox.tigo.com/test';
export const TIGO_PROD_URL = 'https://secure.tigo.com/production';
