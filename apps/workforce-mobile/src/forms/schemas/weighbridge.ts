import { z } from 'zod'

export const weighbridgeFormSchema = z.object({
  plate: z
    .string()
    .trim()
    .min(4)
    .max(15)
    .regex(/^[A-Z0-9 -]+$/u),
  driverName: z.string().trim().min(2).max(80)
})

export type WeighbridgeForm = z.infer<typeof weighbridgeFormSchema>

export interface WeighbridgePayload {
  plate: string
  driverName: string
  photo: { uri: string; capturedAt: number; mimeType: string } | null
  video: { uri: string; capturedAt: number; mimeType: string } | null
  submittedAt: number
}
