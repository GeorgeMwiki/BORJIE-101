/**
 * M-Pesa Daraja API types
 */
export interface MpesaConfig {
  consumerKey: string;
  consumerSecret: string;
  shortCode: string;
  passKey: string;
  environment: 'sandbox' | 'production';
  callbackBaseUrl: string;
}

export interface MpesaTokenResponse {
  access_token: string;
  expires_in: string;
}

export interface StkPushRequest {
  BusinessShortCode: string;
  Password: string;
  Timestamp: string;
  TransactionType: 'CustomerPayBillOnline';
  Amount: number;
  PartyA: string;
  PartyB: string;
  PhoneNumber: string;
  CallBackURL: string;
  AccountReference: string;
  TransactionDesc: string;
}

export interface StkPushResponse {
  MerchantRequestID: string;
  CheckoutRequestID: string;
  ResponseCode: string;
  ResponseDescription: string;
  CustomerMessage: string;
  errorMessage?: string;
}

export interface StkCallbackMetadataItem {
  Name: string;
  Value: string | number;
}

export interface StkCallbackBody {
  stkCallback: {
    MerchantRequestID: string;
    CheckoutRequestID: string;
    ResultCode: number;
    ResultDesc: string;
    CallbackMetadata?: {
      Item: StkCallbackMetadataItem[];
    };
  };
}

export interface StkCallbackPayload {
  Body: StkCallbackBody;
}

export interface StkQueryRequest {
  BusinessShortCode: string;
  Password: string;
  Timestamp: string;
  CheckoutRequestID: string;
}

export interface StkQueryResponse {
  ResponseCode: string;
  ResponseDescription: string;
  MerchantRequestID: string;
  CheckoutRequestID: string;
  ResultCode?: string;
  ResultDesc?: string;
}

export interface B2CRequest {
  InitiatorName: string;
  SecurityCredential: string;
  CommandID: 'BusinessPayment' | 'SalaryPayment';
  Amount: number;
  PartyA: string;
  PartyB: string;
  Remarks: string;
  QueueTimeOutURL: string;
  ResultURL: string;
  Occasion: string;
}

export interface B2CResponse {
  ConversationID: string;
  OriginatorConversationID: string;
  ResponseCode: string;
  ResponseDescription: string;
}

export interface B2CCallbackResult {
  Result: {
    ResultType: number;
    ResultCode: number;
    ResultDesc: string;
    OriginatorConversationID: string;
    ConversationID: string;
    TransactionID: string;
    ResultParameters?: {
      ResultParameter: Array<{ Key: string; Value: string | number }>;
    };
    ReferenceData?: {
      ReferenceItem: Array<{ Key: string; Value: string }>;
    };
  };
}
