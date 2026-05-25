/**
 * M-Pesa Daraja 3.0 — type definitions and Zod schemas.
 *
 * Per `.audit/litfin-sota-2026-05-23/15-cross-tool-stitching.md` §EA-1: the
 * single most valuable EA connector. This module is the typed surface for
 * the rent-collection STK Push flow + the `stkCallback` webhook (Daraja's
 * server-to-server callback after the customer confirms on their handset).
 *
 * Idempotency contract: every `stkCallback` carries an `MpesaReceiptNumber`
 * inside `CallbackMetadata.Item[]` on success. We dedupe on that field. On
 * failure (`ResultCode !== 0`) there is no receipt — we dedupe on
 * `CheckoutRequestID` instead. Both are exposed by `stkCallbackReceiptKey`
 * so callers do not need to reach into the metadata array.
 */

import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────
// Environment + base URLs
// ─────────────────────────────────────────────────────────────────────

/** Daraja deployment environment. */
export type MpesaEnv = 'sandbox' | 'production';

/** Frozen mapping env → base URL. Sandbox is the default. */
export const MPESA_BASE_URLS: Readonly<Record<MpesaEnv, string>> = Object.freeze({
  sandbox: 'https://sandbox.safaricom.co.ke',
  production: 'https://api.safaricom.co.ke',
});

// ─────────────────────────────────────────────────────────────────────
// MSISDN — Kenyan mobile, accepts +254 / 254 / 0 prefixes
// ─────────────────────────────────────────────────────────────────────

/** Permissive Kenyan MSISDN regex. Normalised to `254XXXXXXXXX` by helper. */
export const E164_OR_LOCAL = /^(?:\+?254|0)?[17]\d{8}$/;

// ─────────────────────────────────────────────────────────────────────
// Credentials — every field sourced from environment variables
// ─────────────────────────────────────────────────────────────────────

/**
 * Daraja credentials. ALL fields MUST be sourced from environment variables
 * in production (`MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`,
 * `MPESA_SHORTCODE`, `MPESA_PASSKEY`, `MPESA_CALLBACK_BASE_URL`, `MPESA_ENV`).
 * Never hard-code.
 */
export interface MpesaCredentials {
  readonly consumerKey: string;
  readonly consumerSecret: string;
  /** Paybill or Till number (Daraja `BusinessShortCode`). */
  readonly shortCode: string;
  /** Lipa-na-M-Pesa pass-key. Required for STK Push. */
  readonly passKey: string;
  /**
   * Base URL the property-management API exposes for Daraja callbacks.
   * The STK Push request appends a per-flow path, e.g.
   * `${callbackBaseUrl}/webhooks/mpesa/stk`.
   */
  readonly callbackBaseUrl: string;
}

// ─────────────────────────────────────────────────────────────────────
// STK Push — request + response schemas
// ─────────────────────────────────────────────────────────────────────

export const StkPushInputSchema = z.object({
  /** Integer KES amount. Daraja rejects decimals. */
  amount: z.number().int().positive(),
  /** Payer phone. Accepts `+254...`, `254...`, or `07XX...`. Normalised. */
  msisdn: z.string().regex(E164_OR_LOCAL),
  /** Tenant-facing reference (lease id / receipt code). Max 12 chars Daraja. */
  accountReference: z.string().min(1).max(12),
  /** Short human label shown on the prompt. Max 13 chars Daraja. */
  transactionDesc: z.string().min(1).max(13),
  /**
   * Absolute HTTPS callback URL. Daraja POSTs `stkCallback` here.
   * Optional — defaults to `${callbackBaseUrl}/webhooks/mpesa/stk`.
   */
  callbackUrl: z.string().url().optional(),
});
export type StkPushInput = z.infer<typeof StkPushInputSchema>;

export const StkPushOutputSchema = z.object({
  MerchantRequestID: z.string(),
  CheckoutRequestID: z.string(),
  ResponseCode: z.string(),
  ResponseDescription: z.string(),
  CustomerMessage: z.string().optional(),
});
export type StkPushOutput = z.infer<typeof StkPushOutputSchema>;

// ─────────────────────────────────────────────────────────────────────
// STK Callback — Daraja → us webhook
// ─────────────────────────────────────────────────────────────────────

/** One item inside Daraja's `CallbackMetadata.Item[]`. */
export const StkCallbackItemSchema = z.object({
  Name: z.string(),
  Value: z.union([z.string(), z.number()]).optional(),
});
export type StkCallbackItem = z.infer<typeof StkCallbackItemSchema>;

export const StkCallbackMetadataSchema = z.object({
  Item: z.array(StkCallbackItemSchema),
});

/** Daraja STK callback envelope. `Body.stkCallback` is the actionable bit. */
export const StkCallbackEnvelopeSchema = z.object({
  Body: z.object({
    stkCallback: z.object({
      MerchantRequestID: z.string(),
      CheckoutRequestID: z.string(),
      ResultCode: z.number().int(),
      ResultDesc: z.string(),
      /** Present only on success (`ResultCode === 0`). */
      CallbackMetadata: StkCallbackMetadataSchema.optional(),
    }),
  }),
});
export type StkCallbackEnvelope = z.infer<typeof StkCallbackEnvelopeSchema>;

/**
 * Decoded STK callback — normalised view extracted from
 * `CallbackMetadata.Item[]`. All fields optional because Daraja omits
 * the metadata block entirely when `ResultCode !== 0`.
 */
export interface StkCallbackDecoded {
  readonly merchantRequestId: string;
  readonly checkoutRequestId: string;
  readonly resultCode: number;
  readonly resultDesc: string;
  readonly success: boolean;
  /** Receipt number — present on success. The idempotency key. */
  readonly mpesaReceiptNumber?: string;
  readonly amount?: number;
  readonly transactionDate?: string;
  readonly phoneNumber?: string;
}
