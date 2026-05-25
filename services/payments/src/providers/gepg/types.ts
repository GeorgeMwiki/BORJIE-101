/**
 * GePG (Government e-Payment Gateway) types
 *
 * GePG is the Tanzanian government payment gateway that generates
 * "Control Numbers" for invoice payments via any supported bank or PSP.
 * See Docs/analysis/RESEARCH_ANSWERS.md Q2 for the PSP shortcut approach.
 */

export type GepgEnvironment = 'sandbox' | 'production';

export interface GepgConfig {
  readonly sp: string;              // Service Provider code (GePG SpCode)
  readonly spSysId: string;         // Service Provider System ID
  readonly pkcs12Path?: string;     // Path to GePG signing cert (production only)
  readonly pkcs12Password?: string; // Cert password
  readonly environment: GepgEnvironment;
  readonly baseUrl: string;         // GePG endpoint base URL
  readonly callbackBaseUrl: string; // Our callback endpoint base URL
  readonly pspMode?: boolean;       // True = use PSP shortcut (via MNO/bank), false = direct GePG
}

export interface GepgControlNumberRequest {
  readonly tenantId: string;
  readonly invoiceId: string;
  readonly billId: string;          // GePG BillId (our invoice reference)
  readonly amount: number;          // Minor units (e.g. cents)
  readonly currency: 'TZS' | 'USD';
  readonly payerName: string;
  readonly payerPhone?: string;
  readonly payerEmail?: string;
  readonly description: string;
  readonly expiresAt?: Date;
}

export interface GepgControlNumberResponse {
  readonly controlNumber: string;   // 12-digit PayCn
  readonly billId: string;
  readonly status: 'issued' | 'rejected' | 'pending';
  readonly expiresAt?: Date;
  readonly rawResponse: Record<string, unknown>;
}

export interface GepgStatusQuery {
  readonly controlNumber: string;
  readonly billId: string;
}

export type GepgPaymentStatus =
  | 'pending'
  | 'paid'
  | 'partial'
  | 'cancelled'
  | 'expired'
  | 'reconciled';

export interface GepgStatusResult {
  readonly controlNumber: string;
  readonly billId: string;
  readonly status: GepgPaymentStatus;
  readonly paidAmount: number;
  readonly paidAt?: Date;
  readonly pspReceiptNumber?: string;
  readonly rawResponse: Record<string, unknown>;
}

export interface GepgCallbackPayload {
  readonly controlNumber: string;
  readonly billId: string;
  readonly paidAmount: number;
  readonly currency: string;
  readonly paidAt: string;           // ISO timestamp
  readonly pspReceiptNumber: string;
  readonly pspChannel: string;       // mpesa, airtel, crdb, nmb, etc.
  readonly payerName?: string;
  readonly payerPhone?: string;
  readonly signature: string;        // GePG XML-DSig signature
  readonly rawBody: string;          // Original XML/JSON for signature verification
}

export interface GepgCallbackResult {
  readonly accepted: boolean;
  readonly controlNumber: string;
  readonly billId: string;
  readonly reason?: string;
}

export interface GepgSignatureVerification {
  readonly valid: boolean;
  readonly reason?: string;
  readonly signedBy?: string;
}
