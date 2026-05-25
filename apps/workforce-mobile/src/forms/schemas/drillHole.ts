import { z } from 'zod'

export const drillKindSchema = z.enum(['diamond', 'rc', 'auger'])
export type DrillKind = z.infer<typeof drillKindSchema>

export const drillLayerSchema = z.object({
  id: z.string(),
  type: z.string().trim().min(1).max(60),
  fromMeters: z.number().min(0),
  toMeters: z.number().min(0)
}).refine((layer) => layer.toMeters > layer.fromMeters, {
  message: 'invalid_range'
})

export type DrillLayerInput = z.input<typeof drillLayerSchema>
export type DrillLayer = z.infer<typeof drillLayerSchema>

export const drillHoleFormSchema = z.object({
  holeId: z.string().trim().min(3).max(40),
  kind: drillKindSchema,
  depth: z.string().trim().regex(/^\d+(\.\d+)?$/u),
  sampleTag: z.string().trim().max(40).optional().default('')
})

export type DrillHoleForm = z.infer<typeof drillHoleFormSchema>

export interface DrillHolePayload {
  holeId: string
  kind: DrillKind
  depthMeters: number
  sampleTag: string
  layers: ReadonlyArray<DrillLayer>
  gps: {
    latitude: number
    longitude: number
    accuracy: number | null
    capturedAt: number
  } | null
  fence: {
    siteId: string
    siteName: string
    insideFence: boolean
    distanceMeters: number
  } | null
  submittedAt: number
}

/**
 * Generate a hole id of the form DH-YYYY-NNNN where the numeric suffix is the
 * day-of-year plus a 2-char random suffix. Deterministic enough that the
 * field worker can read it back, random enough to avoid same-shift collision.
 */
export function generateHoleId(now: Date = new Date()): string {
  const year = now.getFullYear()
  const startOfYear = new Date(Date.UTC(year, 0, 0))
  const diffMs = now.getTime() - startOfYear.getTime()
  const dayOfYear = Math.floor(diffMs / (24 * 60 * 60 * 1000))
  const suffix = Math.random().toString(36).slice(2, 4).toUpperCase()
  const dayPart = String(dayOfYear).padStart(3, '0')
  return `DH-${year}-${dayPart}${suffix}`
}
