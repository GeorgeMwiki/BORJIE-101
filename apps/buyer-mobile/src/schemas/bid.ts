import { z } from 'zod'

export const placeBidSchema = z.object({
  bidPrice: z
    .string()
    .min(1, 'required')
    .regex(/^\d+(?:[.,]\d+)?$/, 'numeric'),
  paymentTerms: z.enum(['instant', '30d', '60d']),
  notes: z.string().max(500).optional().default(''),
  termsAccepted: z.boolean().refine((val) => val === true, { message: 'required' })
})

export type PlaceBidFormInput = z.input<typeof placeBidSchema>
export type PlaceBidFormValues = z.output<typeof placeBidSchema>

export function parseBidPrice(raw: string): number {
  return Number(raw.replace(',', '.'))
}
