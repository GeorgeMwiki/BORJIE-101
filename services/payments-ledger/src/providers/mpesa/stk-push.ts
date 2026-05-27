/**
 * M-Pesa STK Push initiation adapter.
 *
 * Validates amount / currency / phone and delegates to an
 * {@link IMpesaClient} (live or mock). NO LEDGER WRITE happens here —
 * the ledger entry posts on the webhook callback path, after Safaricom
 * confirms the customer entered the PIN. This file is the request side.
 *
 * Hard rule (CLAUDE.md): the only writer to the immutable money ledger
 * is {@link LedgerService.postJournalEntry}. This module never touches
 * it.
 */
import { z } from 'zod';
import type { IMpesaClient, StkPushResponse } from './client';

// E.164 with the leading `+` optional. Daraja expects digits-only with
// the country prefix, so we normalise in `normalisePhone`.
const PHONE_REGEX = /^\+?[0-9]{9,15}$/;

export const StkPushInputSchema = z
  .object({
    amount: z.number().positive().int(),
    currency: z.literal('KES'),
    phoneNumber: z.string().regex(PHONE_REGEX, 'phone must be E.164'),
    accountReference: z.string().min(1).max(12),
    transactionDesc: z.string().min(1).max(13),
    callbackUrl: z.string().url(),
    businessShortCode: z.string().regex(/^[0-9]{4,7}$/),
  })
  .strict();

export type StkPushInput = z.infer<typeof StkPushInputSchema>;

export function normalisePhone(raw: string): string {
  const digits = raw.replace(/[^0-9]/g, '');
  if (digits.startsWith('254')) return digits;
  if (digits.startsWith('0')) return `254${digits.slice(1)}`;
  if (digits.startsWith('7') || digits.startsWith('1')) return `254${digits}`;
  return digits;
}

export interface InitiateStkPushDeps {
  readonly client: IMpesaClient;
}

export interface InitiateStkPushResult {
  readonly merchantRequestId: string;
  readonly checkoutRequestId: string;
  readonly customerMessage: string;
  readonly mode: 'live' | 'mock';
}

/**
 * Initiate an STK push. Throws on validation failure or provider error.
 * Returns the Daraja correlation ids so callers can persist a payment
 * intent against them.
 */
export async function initiateStkPush(
  rawInput: unknown,
  deps: InitiateStkPushDeps,
): Promise<InitiateStkPushResult> {
  const parsed = StkPushInputSchema.safeParse(rawInput);
  if (!parsed.success) {
    throw new Error(
      `Invalid STK push input: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
    );
  }
  const phone = normalisePhone(parsed.data.phoneNumber);
  const resp: StkPushResponse = await deps.client.stkPush({
    businessShortCode: parsed.data.businessShortCode,
    amount: parsed.data.amount,
    phoneNumber: phone,
    accountReference: parsed.data.accountReference,
    transactionDesc: parsed.data.transactionDesc,
    callbackUrl: parsed.data.callbackUrl,
  });
  return {
    merchantRequestId: resp.merchantRequestId,
    checkoutRequestId: resp.checkoutRequestId,
    customerMessage: resp.customerMessage,
    mode: deps.client.mode,
  };
}
