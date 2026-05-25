/**
 * Airtel Money API types
 * Supports East Africa (TZ, UG, etc.)
 */
export interface AirtelConfig {
  clientId: string;
  clientSecret: string;
  environment: 'sandbox' | 'production';
  callbackBaseUrl: string;
  country: 'TZ' | 'UG' | 'KE';
}

export interface AirtelTokenResponse {
  access_token: string;
  expires_in: number;
  token_type: string;
}

export interface AirtelPaymentRequest {
  reference: string;
  subscriber: {
    country: string;
    currency: string;
    msisdn: string;
  };
  transaction: {
    amount: string;
    country: string;
    currency: string;
    id: string;
  };
}

export interface AirtelPaymentResponse {
  status: {
    code: string;
    message: string;
    result_code: string;
  };
  transaction?: {
    id: string;
    status: string;
  };
}

export interface AirtelCallbackPayload {
  transaction?: {
    id: string;
    status: string;
    status_reason?: string;
    reference?: string;
  };
  transaction_id?: string;
  status?: string;
}
