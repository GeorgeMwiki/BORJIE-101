import { z } from 'zod'

const numericString = z
  .string()
  .trim()
  .min(1)
  .regex(/^\d+(\.\d+)?$/u)

const positiveDecimal = numericString.refine((value) => Number(value) > 0, {
  message: 'positive'
})

const positiveInteger = numericString
  .regex(/^\d+$/u)
  .refine((value) => Number(value) > 0, { message: 'positive' })

export const shiftReportStep1Schema = z.object({
  siteId: z.string().trim().min(2).max(60),
  workersCount: positiveInteger,
  hoursPerWorker: positiveDecimal
})

export const shiftReportStep2Schema = z.object({
  fuelLitres: positiveDecimal,
  equipmentNotes: z.string().trim().max(400).optional().default('')
})

export const shiftReportStep3Schema = z.object({
  blockers: z.string().trim().max(800).optional().default('')
})

export const shiftReportFullSchema = shiftReportStep1Schema
  .merge(shiftReportStep2Schema)
  .merge(shiftReportStep3Schema)

export type ShiftReportStep1 = z.infer<typeof shiftReportStep1Schema>
export type ShiftReportStep2 = z.infer<typeof shiftReportStep2Schema>
export type ShiftReportStep3 = z.infer<typeof shiftReportStep3Schema>
export type ShiftReportFullForm = z.infer<typeof shiftReportFullSchema>

export interface ShiftReportPayload {
  siteId: string
  workersCount: number
  hoursPerWorker: number
  fuelLitres: number
  equipmentNotes: string
  blockers: string
  photos: ReadonlyArray<{ uri: string; capturedAt: number; mimeType: string }>
  voiceNote: { uri: string; durationMs: number; recordedAt: number } | null
  submittedAt: number
}
