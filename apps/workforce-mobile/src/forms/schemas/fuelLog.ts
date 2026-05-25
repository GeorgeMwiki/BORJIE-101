import { z } from 'zod'

export const fuelLogFormSchema = z.object({
  assetId: z.string().min(1),
  litres: z
    .string()
    .trim()
    .regex(/^\d+(\.\d+)?$/u)
    .refine((value) => Number(value) > 0, { message: 'positive' })
})

export type FuelLogForm = z.infer<typeof fuelLogFormSchema>

export interface FuelLogPayload {
  assetId: string
  litres: number
  meterPhoto: {
    uri: string
    capturedAt: number
    mimeType: string
  } | null
  submittedAt: number
}
