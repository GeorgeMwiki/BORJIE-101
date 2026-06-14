import { z } from 'zod'

/**
 * KI-007 — "Ask the seller" inquiry message form. Mirrors the gateway
 * `raiseInquirySchema` bounds (message 1..2000) so the client rejects an
 * over-long / empty message before the POST.
 */
export const raiseInquirySchema = z.object({
  message: z.string().trim().min(1, 'required').max(2000, 'too_long')
})

export type RaiseInquiryFormInput = z.input<typeof raiseInquirySchema>
export type RaiseInquiryFormValues = z.output<typeof raiseInquirySchema>
