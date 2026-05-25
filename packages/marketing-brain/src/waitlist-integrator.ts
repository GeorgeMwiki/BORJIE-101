/**
 * Waitlist Integrator — signs up a marketing prospect to the Wave-8 waitlist.
 *
 * Presents the port between the anonymous marketing session and the
 * authenticated waitlist domain. The actual persistence happens in the
 * api-gateway's waitlist router; this module builds the structured payload
 * and validates the input client-side so the router receives clean data.
 */

import { z } from 'zod';

export const WaitlistSignupSchema = z.object({
  sessionId: z.string().min(1),
  contactName: z.string().min(1).max(200),
  contactMethod: z.enum(['email', 'phone', 'whatsapp']),
  contactValue: z.string().min(3).max(200),
  country: z.enum(['KE', 'TZ', 'UG', 'other']).default('other'),
  role: z.enum(['owner', 'tenant', 'manager', 'station_master', 'unknown']).default('unknown'),
  portfolioSize: z.enum(['micro', 'small', 'mid', 'large']).optional(),
  notes: z.string().max(2000).optional(),
});
export type WaitlistSignupInput = z.infer<typeof WaitlistSignupSchema>;

export interface WaitlistSignupPayload {
  readonly source: 'marketing_chat';
  readonly sessionId: string;
  readonly contact: {
    readonly name: string;
    readonly method: 'email' | 'phone' | 'whatsapp';
    readonly value: string;
  };
  readonly country: 'KE' | 'TZ' | 'UG' | 'other';
  readonly role: 'owner' | 'tenant' | 'manager' | 'station_master' | 'unknown';
  readonly portfolioSize?: 'micro' | 'small' | 'mid' | 'large';
  readonly notes?: string;
  readonly submittedAt: string;
}

export function buildWaitlistSignup(
  input: WaitlistSignupInput,
  now: Date = new Date()
): WaitlistSignupPayload {
  const parsed = WaitlistSignupSchema.parse(input);

  if (parsed.contactMethod === 'email' && !parsed.contactValue.includes('@')) {
    throw new Error('contactValue must be an email address when contactMethod is email');
  }

  if (
    (parsed.contactMethod === 'phone' || parsed.contactMethod === 'whatsapp') &&
    !/^\+?[0-9\s-]{7,20}$/.test(parsed.contactValue)
  ) {
    throw new Error('contactValue must be a phone number when contactMethod is phone or whatsapp');
  }

  return {
    source: 'marketing_chat',
    sessionId: parsed.sessionId,
    contact: {
      name: parsed.contactName.trim(),
      method: parsed.contactMethod,
      value: parsed.contactValue.trim(),
    },
    country: parsed.country,
    role: parsed.role,
    ...(parsed.portfolioSize !== undefined ? { portfolioSize: parsed.portfolioSize } : {}),
    ...(parsed.notes !== undefined ? { notes: parsed.notes } : {}),
    submittedAt: now.toISOString(),
  };
}
